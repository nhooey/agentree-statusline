// The band's tree of threads above the prompt.
//
// agents/plans/one-panel-port.md, "The band's tree", has the design.  🎮
// the session is the root, its label the workspace; 🧵 the main thread is
// its child, and under 🧵 come 🎤, the main thread's turn, first, then
// each subagent under the thread that started it, in the order they
// started.  🎤 is a leaf and counts against no cap;
// where 🧵 is not drawn, 🎤 and the subagents hang from 🎮.  Every row
// is a row of the one grid (grid.ts): the hierarchy is in the label
// alone, as `├─` `╰─` `│` lines three columns a level, so every figure
// keeps its column on every row.
//
// Under 🧵 main, after its agents, `✅ N done` sums the subagents that
// finished in the turn.  Past the cap, the later siblings under one parent
// are summed on that parent's `… N more`, and every shown row's parents
// stay.  A row with children draws ⊟ in its tree line, or ⊞ where it is
// folded, and a folded agent counts every agent hidden under it with 👶🏻.
// Each row's fold is kept under its key (ROOT_FOLD, MAIN_FOLD, an agent's
// id, groupFold): the two grouped rows start folded, every other row
// opened.
//
// The spans carry what a press on them does (Press): a fold mark toggles
// its row's fold, an agent's label switches the transcript to it, and 🧵
// main's and 🎤 turn's to the main conversation, and on 🎮's label 📦 🌿 🔀 link to the
// repository on GitHub, where its address is known.
//
// Stamped (TreeInput's `stamped`), the same tree is the turn's receipt
// (receipt.ts): every agent the turn ran, each under the agent that
// started it, ended or not, with no cap, no grouped rows, no folds and no
// presses, and 🏁 on the turn and on each agent that had ended.
//
// Pure: the rows' figures come in built (band.ts), and the agents as the
// document's prepared tasks (subagent_tasks.ts).
import {
  E_FOLD_OPEN, E_FOLD_SHUT, E_MODE_DONE, E_MORE, E_PHASE_DONE,
  E_PHASE_END, E_SESS,
  E_THREAD, E_TREE_BAR, E_TREE_DASH, E_TREE_LAST,
  E_TREE_MID, E_TURN, E_WEEK, E_SESSION, E_EFF_HIGH, E_IDLE, MAG_DUR_S,
} from "./spec.ts";
import { durFmt, magDim, padVal } from "./formatting.ts";
import type { Settings } from "./formatting.ts";
import { pressed, span, spans } from "./spans.ts";
import type { Press, Span } from "./spans.ts";
import { pyFormatF } from "./py.ts";
import type { Dict } from "./py.ts";
import { squash } from "./claude_records.ts";
import { renderCost, renderTokens } from "./claude_render.ts";
import type { Limits } from "./claude_sources.ts";
import {
  agentCells, agentElapsed, agentLabel, inheritedEtas,
  parked, renderAgentCache, renderAgentDiff, renderAgentLimit, renderAgentRate,
  renderAgentSplit, renderInbox, runningParents, treeShape,
} from "./claude_subagent_render.ts";
import type { Eta } from "./claude_subagent_render.ts";
import { workspacePieces } from "./cells.ts";
import type { Workspace } from "./cells.ts";
import { preparedOf } from "./subagent_tasks.ts";
import type { TreeTask } from "./subagent_tasks.ts";
import { hidden } from "./grid.ts";
import type { Piece, Row } from "./grid.ts";

/** The subagents the tree draws: the document's prepared tasks, the plan
 * reading their shares are drawn under, the clock, and when the turn
 * opened, which `✅ N done` counts finishes from (null: no turn running,
 * and no `✅ N done`). */
export type TreeAgents = {
  readonly tasks: readonly TreeTask[];
  readonly limits: Limits;
  readonly now: number;
  readonly turnStart: number | null;
};

/** What the tree is drawn from.  The rows `session`, `main` and `turn` are
 * the band's, null where the place or the phase leaves one out; their
 * labels are drawn here again.  `mainPhase` and `turnPhase` are their
 * state circles, `mainInbox` the messages queued for the main thread,
 * `mainProgress` the first line of the last text it wrote, and
 * `turnPrompt` the prompt typed last, drawn after 🎤's name.  `cap` is the most subagent rows drawn, and `folds` the folds
 * kept, by key.  `repo` is the repository's address on GitHub, which 📦 🌿
 * 🔀 link to; null or absent, they link nowhere.  `stamped` draws the
 * tree as the turn's receipt stamps it: the agents as stampedNodes picks
 * them, every row opened, no fold marks, `cap`, `folds` and `repo` not
 * read, and nothing pressing. */
export type TreeInput = {
  readonly session: Row | null;
  readonly main: Row | null;
  readonly turn: Row | null;
  readonly workspace: Workspace | null;
  readonly mainPhase: string;
  readonly mainInbox: number;
  readonly mainProgress: string;
  readonly turnPhase: string;
  readonly turnPrompt?: string;
  readonly agents: TreeAgents | null;
  readonly cap: number;
  readonly folds?: Folds;
  readonly repo?: string | null;
  readonly stamped?: boolean;
};

/** The folds the person left, by key: true folded, false opened.  A key
 * absent is its row's default (foldShut). */
export type Folds = { readonly [key: string]: boolean };

/** The fold keys of 🎮 and 🧵 main, which no agent id can be. */
export const ROOT_FOLD = "session";
export const MAIN_FOLD = "main";

/** The fold key of a grouped row, `… N more` ("more") or `✅ N done`
 * ("done"): its parent's key, an agent's id or MAIN_FOLD, then its
 * kind. */
export function groupFold(parent: string, kind: "more" | "done"): string {
  return parent + "/" + kind;
}

/** Whether the row kept under `key` is folded: as `folds` keeps it, else
 * `shut`, its default. */
export function foldShut(folds: Folds, key: string, shut: boolean): boolean {
  return Object.hasOwn(folds, key) ? folds[key] : shut;
}

/** The statuses of an agent that has ended. */
const ENDED: ReadonlySet<string> = new Set(["completed", "failed", "killed"]);

/** `folds` less the fold of every agent that has ended, and its grouped
 * rows': an agent `tasks` no longer has, or has completed, failed or
 * killed.  🎮's, 🧵's and 🧵's grouped rows' stay.  `folds` itself where
 * nothing is dropped. */
export function pruneFolds(folds: Folds,
  tasks: readonly { readonly id?: unknown; readonly status?: unknown }[]):
  Folds {
  const live = new Set(tasks.filter((t) =>
    !ENDED.has(String(t.status ?? ""))).map((t) => String(t.id)));
  const keep = (key: string): boolean => {
    const owner = key.includes("/") ? key.slice(0, key.lastIndexOf("/"))
      : key;
    return owner === ROOT_FOLD || owner === MAIN_FOLD || live.has(owner);
  };
  const kept = Object.entries(folds).filter(([k]) => keep(k));
  return kept.length === Object.keys(folds).length ? folds
    : Object.fromEntries(kept);
}

/** A row's fold: the key it is kept under and whether the row starts
 * folded. */
type Fold = { readonly key: string; readonly shut: boolean };

/** A row of the tree before its line is drawn: its row with the label
 * after the line, its children, whether they are folded under it, and the
 * fold its mark toggles, for a row that can fold. */
type Node = {
  readonly row: Row;
  readonly kids: readonly Node[];
  readonly folded: boolean;
  readonly fold?: Fold;
};

/** `pieces` with every span pressing `press`. */
function pressingAll(pieces: readonly Piece[], press: Press): Piece[] {
  return pieces.map((p) => ({ ...p,
    spans: p.spans.map((s) => pressed(s, press)) }));
}

/** A thread's text after its name: two blanks then the text, dimmed,
 * under `path`, `chat.progress` by default; none for no text. */
function progressPiece(text: string, path = "chat.progress"): Piece[] {
  const t = squash(text).trim();
  return t ? [{ path,
    spans: [span("  "), span(t, null, true)], drop: 0 }] : [];
}

/** A thread's head, its kind glyph and its state circle in two columns,
 * then a blank, under `name.kind`. */
function headPiece(st: Settings, kind: string, phase: string): Piece {
  return { path: "name.kind",
    spans: [span(kind), span(padVal(st, 2, phase, true)), span(" ")],
    drop: 0 };
}

/** The tree's line before a row, dim: for each level above it a bar, or
 * blanks under a last child, then its branch, `├` or `╰` and `─`, or ⊟ or
 * ⊞ for a row with children, opened or folded; the root's ⊟ alone.
 * `lasts` says, for each level from the root's children down to the row's
 * own, whether that level's row is the last of its siblings.  The mark,
 * and it alone, presses the toggle of `fold`. */
function treeLine(lasts: readonly boolean[], kids: boolean,
  folded: boolean, fold: Fold | undefined): Span[] {
  if (!lasts.length && !kids) return [];
  const mark = kids ? (folded ? E_FOLD_SHUT : E_FOLD_OPEN) : E_TREE_DASH;
  const bars = lasts.slice(0, -1).map((l) => l ? "   " : E_TREE_BAR + "  ");
  const head = lasts.length
    ? bars.join("") + (lasts.at(-1) ? E_TREE_LAST : E_TREE_MID) : "";
  const line = span(head + mark + " ", null, true);
  const at = Array.from(head).length;
  return [kids && fold
    ? pressed(line, { kind: "fold", ...fold, at: [at, at + 1] }) : line];
}

/** The rows of `nodes`, top to bottom, each with its tree line as the
 * first piece of its label, under the path `tree`, dim; `marks` false
 * draws no fold mark. */
function walk(nodes: readonly Node[], lasts: readonly boolean[],
  out: Row[], marks: boolean): void {
  nodes.forEach((n, i) => drawNode(n, [...lasts, i === nodes.length - 1],
    out, marks));
}

/** `n`'s row with its tree line, `lasts` as treeLine reads it, then its
 * children's where they are not folded under it.  `marks` false draws no
 * fold mark: a row with children is drawn as one without. */
function drawNode(n: Node, lasts: readonly boolean[], out: Row[],
  marks = true): void {
  const line = treeLine(lasts, marks && (n.kids.length > 0 || n.folded),
    n.folded, n.fold);
  out.push({ ...n.row, left: true, label: [
    ...(line.length ? [{ path: "tree", spans: line, drop: 0 }] : []),
    ...n.row.label] });
  if (!n.folded) walk(n.kids, lasts, out, marks);
}

/** The tree's rows, top to bottom, under `hide`: 🎮, then 🧵 and under
 * it 🎤, its subagents, `… N more` and `✅ N done`.  Without 🎮 its
 * children stand at the top; without 🧵, 🎤 and the subagents hang from
 * the root.  Stamped, as TreeInput's `stamped` says. */
export function treeRows(st: Settings, inp: TreeInput,
  hide: readonly string[]): Row[] {
  const stamped = inp.stamped ?? false;
  const folds = stamped ? {} : inp.folds ?? {};
  const pressing = (pieces: readonly Piece[], press: Press): Piece[] =>
    stamped ? [...pieces] : pressingAll(pieces, press);
  const agents = inp.agents === null || hidden(hide, "agent") ? []
    : stamped ? stampedNodes(st, inp.agents)
    : agentNodes(st, inp.agents, inp.cap, folds);
  const turn: Node[] = inp.turn ? [{ folded: false, kids: [],
    row: { ...inp.turn, label: pressing([
      headPiece(st, E_TURN, inp.turnPhase),
      { path: "name.label", spans: [span("turn", "F_BLU")], drop: 0 },
      ...progressPiece(inp.turnPrompt ?? "", "chat.prompt")],
    { kind: "view", agent: null, row: "turn" }) } }]
    : [];
  const top: Node[] = [];
  if (inp.main) {
    const kids = [...turn, ...agents];
    const fold = { key: MAIN_FOLD, shut: false };
    const folded = kids.length > 0 && foldShut(folds, fold.key, fold.shut);
    top.push({ folded, kids: folded ? [] : kids, fold,
      row: { ...inp.main, label: pressing([
        headPiece(st, E_THREAD, inp.mainPhase),
        ...(inp.mainInbox ? [{ path: "state.inbox",
          spans: [...renderInbox(inp.mainInbox), span(" ")], drop: 0 }]
          : []),
        { path: "name.label", spans: [span("main", "F_BLU")], drop: 0 },
        ...progressPiece(inp.mainProgress)],
      { kind: "view", agent: null }) } });
  } else top.push(...turn, ...agents);
  const out: Row[] = [];
  if (inp.session) {
    const ws = workspacePieces(inp.workspace).filter((p) =>
      ["workspace.project", "workspace.branch", "workspace.pr"]
        .includes(p.path));
    const fold = { key: ROOT_FOLD, shut: false };
    const folded = top.length > 0 && foldShut(folds, fold.key, fold.shut);
    drawNode({ folded, kids: folded ? [] : top, fold,
      row: { ...inp.session, label: [
        { path: "name.label", spans: [span(E_SESSION + " ")], drop: 0 },
        ...linked(ws, stamped ? null : inp.repo ?? null,
          inp.workspace)] } }, [], out, !stamped);
  } else {
    for (const n of top) drawNode(n, [], out, !stamped);
  }
  return out;
}

/** Where on GitHub each of 🎮's workspace pieces links, by its path, under
 * the repository's address `repo`: 📦 the repository, 🌿 its branch, 🔀
 * its pull request.  None without `repo`. */
export function workspaceLinks(repo: string | null,
  ws: Workspace | null): { readonly [path: string]: string } {
  if (!repo || !ws) return {};
  const out: { [path: string]: string } = { "workspace.project": repo };
  if (ws.branch) {
    out["workspace.branch"] = repo + "/tree/" +
      ws.branch.split("/").map(encodeURIComponent).join("/");
  }
  if (/^[0-9]+$/.test(ws.pr)) out["workspace.pr"] = repo + "/pull/" + ws.pr;
  return out;
}

/** The workspace pieces, each linking where workspaceLinks says: its text
 * presses the link, and the blanks after it press nothing. */
function linked(pieces: readonly Piece[], repo: string | null,
  ws: Workspace | null): Piece[] {
  const links = workspaceLinks(repo, ws);
  return pieces.map((p) => {
    const href = links[p.path];
    if (!href) return p;
    return { ...p, spans: p.spans.map((s) => pressed(s, { kind: "link",
      href, at: [0, Array.from(s.text.trimEnd()).length] })) };
  });
}

/** Whether a task has ended: failed, killed, or completed and waiting on
 * nothing (parked says what a completed agent can still wait on).  A
 * waiting one has not: it is paused. */
function ended(t: Dict, u: Dict, busy: ReadonlySet<string>): boolean {
  const s = String(t.status ?? "");
  if (s === "failed" || s === "killed") return true;
  return s === "completed" && !parked(s, u.eta, busy.has(String(t.id)),
    u.background);
}

/** The subagents as the tree's nodes under 🧵 main: each live agent under
 * the agent that started it (treeShape, which steps over a finished
 * ancestor), in the order they started; an ended agent only where a live
 * one hangs under it.  At most `cap` agent rows, in the tree's order: the
 * siblings past it are summed on their parent's `… N more`.  Then `✅ N
 * done`, the agents that ended since the turn opened. */
function agentNodes(st: Settings, a: TreeAgents, cap: number,
  folds: Folds): Node[] {
  const prepared = preparedOf(a.tasks);
  const shape = treeShape(prepared);
  const busy = runningParents(prepared);
  const etas = inheritedEtas(prepared);
  const byId = new Map(a.tasks.map((t) => [String(t.task.id), t]));
  const kidsOf = new Map<string, string[]>();
  for (const [id, [parent]] of shape) {
    if (!kidsOf.has(parent)) kidsOf.set(parent, []);
    kidsOf.get(parent)!.push(id);
  }
  const start = (id: string): number =>
    Number(byId.get(id)!.task.startTime ?? Infinity);
  for (const ids of kidsOf.values()) {
    ids.sort((x, y) => start(x) - start(y) || (x < y ? -1 : x > y ? 1 : 0));
  }
  const isEnded = (id: string): boolean => {
    const t = byId.get(id)!;
    return ended(t.task, t.usage, busy);
  };
  const liveMemo = new Map<string, boolean>();
  const live = (id: string): boolean => {
    if (!liveMemo.has(id)) {
      liveMemo.set(id, false);
      liveMemo.set(id, !isEnded(id) ||
        (kidsOf.get(id) ?? []).some((k) => live(k)));
    }
    return liveMemo.get(id)!;
  };
  const shownKids = (id: string): string[] =>
    (kidsOf.get(id) ?? []).filter(live);
  const under = (id: string): string[] =>
    shownKids(id).flatMap((k) => [k, ...under(k)]);
  const shut = (id: string): boolean => shownKids(id).length > 0 &&
    foldShut(folds, id, false);
  const agentRow = (id: string): Row => {
    const t = byId.get(id)!;
    const waitingOn = busy.has(id);
    const eta: Eta | false = etas.has(id) ? etas.get(id)! : false;
    // 👶🏻 on a folded row: every agent hidden under it.
    return { scope: "agent",
      label: pressingAll([...agentLabel(st, t.task, t.usage, t.meta,
        waitingOn, shut(id) ? under(id).length : 0, 0, null, true),
      ...progressPiece(t.progress)],
      { kind: "view", agent: id }),
      cells: agentCells(st, t.task, t.usage, t.meta, t.shares, a.limits,
        a.now, eta, waitingOn) };
  };
  // `capped`: the rows count against the cap.  The rows an opened `… N
  // more` lists are past it, and drawn whole.
  let budget = cap;
  const agentNode = (id: string, capped: boolean): Node => {
    const folded = shut(id);
    return { row: agentRow(id), folded, fold: { key: id, shut: false },
      kids: folded ? [] : place(id, capped) };
  };
  const place = (parent: string, capped = true): Node[] => {
    const ids = shownKids(parent);
    const out: Node[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (capped && budget <= 0) {
        const rest = ids.slice(i).flatMap((k) => [k, ...under(k)]);
        const fold = { key: groupFold(parent || MAIN_FOLD, "more"),
          shut: true };
        const folded = foldShut(folds, fold.key, fold.shut);
        out.push(groupNode(st, a, rest.map((k) => byId.get(k)!),
          E_MORE + " " + rest.length + " more", "more", fold, folded,
          folded ? [] : ids.slice(i).map((k) => agentNode(k, false))));
        break;
      }
      if (capped) budget -= 1;
      out.push(agentNode(ids[i], capped));
    }
    return out;
  };
  const nodes = place("");
  if (a.turnStart !== null) {
    const done = [...byId.keys()].filter((id) => !live(id) && (() => {
      const u = byId.get(id)!.usage;
      const end = (u.last_seen ?? u.last_epoch) as number | null;
      return end !== null && end >= a.turnStart!;
    })());
    if (done.length) {
      // Opened, its agents one under another, in the order they started.
      done.sort((x, y) => start(x) - start(y) ||
        (x < y ? -1 : x > y ? 1 : 0));
      const fold = { key: groupFold(MAIN_FOLD, "done"), shut: true };
      const folded = foldShut(folds, fold.key, fold.shut);
      nodes.push(groupNode(st, a, done.map((k) => byId.get(k)!),
        E_MODE_DONE + " " + done.length + " done", "done", fold, folded,
        folded ? [] : done.map((k) => ({ row: agentRow(k), folded: false,
          kids: [] }))));
    }
  }
  return nodes;
}

/** The subagents as the stamped tree's nodes under 🧵 main: every agent
 * the turn ran, one that started since `a.turnStart` or whose last record
 * is since then, or one with no record yet (every agent, with no
 * turnStart), each under the nearest
 * agent above it that the turn ran too, else under 🧵, in the order they
 * started.  Every row opened, none pressing, no cap and no grouped rows;
 * an agent that had ended draws 🏁 in place of its ⚫. */
function stampedNodes(st: Settings, a: TreeAgents): Node[] {
  const prepared = preparedOf(a.tasks);
  const busy = runningParents(prepared);
  const etas = inheritedEtas(prepared);
  const ran = (t: TreeTask): boolean => {
    const end = t.usage.last_seen ?? t.usage.last_epoch;
    const begun = typeof t.task.startTime === "number";
    if (a.turnStart === null || (!begun && typeof end !== "number")) {
      return true;
    }
    return (begun && (t.task.startTime as number) / 1000 >= a.turnStart) ||
      (typeof end === "number" && end >= a.turnStart);
  };
  const all = new Map(a.tasks.map((t) => [String(t.task.id), t]));
  const byId = new Map(a.tasks.filter(ran).map((t) =>
    [String(t.task.id), t]));
  // The nearest agent above `id` that the turn ran, through the ones it
  // did not; "" for 🧵.
  const parentOf = (id: string): string => {
    const seen = new Set([id]);
    let p = String(all.get(id)!.meta.parentAgentId ?? "");
    while (p && !byId.has(p) && all.has(p) && !seen.has(p)) {
      seen.add(p);
      p = String(all.get(p)!.meta.parentAgentId ?? "");
    }
    return byId.has(p) && !seen.has(p) ? p : "";
  };
  const kidsOf = new Map<string, string[]>();
  for (const id of byId.keys()) {
    const p = parentOf(id);
    if (!kidsOf.has(p)) kidsOf.set(p, []);
    kidsOf.get(p)!.push(id);
  }
  const start = (id: string): number =>
    Number(byId.get(id)!.task.startTime ?? Infinity);
  for (const ids of kidsOf.values()) {
    ids.sort((x, y) => start(x) - start(y) || (x < y ? -1 : x > y ? 1 : 0));
  }
  const row = (id: string): Row => {
    const t = byId.get(id)!;
    const waitingOn = busy.has(id);
    const eta: Eta | false = etas.has(id) ? etas.get(id)! : false;
    const done = ended(t.task, t.usage, busy);
    const label = agentLabel(st, t.task, t.usage, t.meta, waitingOn, 0, 0,
      null, true).map((p) => done && p.path === "name.kind"
      ? { ...p, spans: p.spans.map((s) => ({ ...s,
        text: s.text.replace(E_PHASE_END, E_PHASE_DONE) })) } : p);
    return { scope: "agent",
      label: [...label, ...progressPiece(t.progress)], cells: agentCells(st, t.task, t.usage, t.meta, t.shares, a.limits,
        a.now, eta, waitingOn) };
  };
  // Agents whose parents run in a cycle are left out, as no thread
  // started them.
  return (kidsOf.get("") ?? []).map(function node(id: string): Node {
    return { row: row(id), folded: false,
      kids: (kidsOf.get(id) ?? []).map(node) };
  });
}

/** A grouped row that sums `tasks`, kept under `fold`, folded or opened
 * over `kids`: `… N more` past the cap, or `✅ N done`.  Its 🛫 column says 🏃 and how many of them run, or ✅ and how
 * long since the last of them ended; 💰 🧩 💾 and the plan's shares are
 * their sums, 🎯 their cache rates weighed by their ▴, ⌛ their ages
 * summed and 🤖 🔧 🚦 their split of it, as proportions of themselves, as
 * 🎮's agent-seconds are.  No model, 🧠 or ⛳: they are each agent's
 * own. */
function groupNode(st: Settings, a: TreeAgents, tasks: readonly TreeTask[],
  name: string, kind: "more" | "done", fold: Fold, folded: boolean,
  kids: readonly Node[]): Node {
  const num = (v: unknown): number => typeof v === "number" ? v : 0;
  const billed = tasks.filter((t) => (t.usage.parts as unknown[]).length);
  const sum = (f: (t: TreeTask) => number, of = tasks): number =>
    of.reduce((n, t) => n + f(t), 0);
  const cells: { [key: string]: Span[] } = {};
  if (kind === "more") {
    cells.rate = renderAgentRate(st, tasks.filter((t) =>
      t.task.status === "running").length, E_EFF_HIGH);
  } else {
    const ends = tasks.map((t) => num(t.usage.last_seen ?? t.usage.last_epoch))
      .filter((e) => e);
    if (ends.length) {
      const secs = Math.max(0, a.now - Math.max(...ends));
      cells.rate = [span(E_MODE_DONE + " "),
        span(padVal(st, 4, durFmt(st, secs)), "F_PRW")];
    }
  }
  if (billed.length) {
    cells.cost = renderCost(st, pyFormatF(sum((t) => num(t.usage.cost),
      billed), 4));
    const up = sum((t) => num(t.usage.tok_up), billed);
    cells.tok = renderTokens(st, up, sum((t) => num(t.usage.tok_down),
      billed));
    const weighed = billed.filter((t) => num(t.usage.cache_pct) >= 0);
    const w = sum((t) => num(t.usage.tok_up), weighed);
    if (w > 0) {
      cells.cache = renderAgentCache(st, Math.trunc(sum((t) =>
        num(t.usage.cache_pct) * num(t.usage.tok_up), weighed) / w));
    }
    const diff = renderAgentDiff(st, {
      lines_added: sum((t) => num(t.usage.lines_added), billed),
      lines_removed: sum((t) => num(t.usage.lines_removed), billed) });
    if (diff.length) cells.diff = diff;
    const share = (k: "sess" | "week"): number | null =>
      billed.some((t) => t.shares[k] === null) ? null
        : sum((t) => t.shares[k] ?? 0, billed);
    cells.five = renderAgentLimit(st, E_SESS, a.limits.session_pct,
      share("sess"), "F_LIM_SESS");
    cells.week = renderAgentLimit(st, E_WEEK, a.limits.weekly_pct,
      share("week"), "F_LIM_WEEK", true, false, 4);
  }
  const ages = tasks.map((t) => {
    const u = t.usage;
    const work = u.work as [number, number][];
    const firsts = [...work.slice(0, 1).map((w) => w[0]),
      ...(u.open_at !== null ? [u.open_at as number] : [])];
    const live = t.task.status === "running" ||
      t.task.status === "waiting";
    const end = live ? null : (u.last_epoch ?? (work.length
      ? Math.max(...work.map((w) => w[1])) : null)) as number | null;
    return agentElapsed(t.task.startTime, a.now, end,
      firsts.length ? Math.min(...firsts) : null);
  }).filter((x): x is number => x !== null);
  if (ages.length) {
    const age = ages.reduce((n, x) => n + x, 0);
    cells.clock = [span(E_IDLE), span(padVal(st, 4, durFmt(st, age)),
      "F_PRW", magDim(age, MAG_DUR_S))];
    const timed = tasks.filter((t) => t.usage.model_s !== null);
    if (timed.length) {
      cells.split = renderAgentSplit(age, sum((t) => num(t.usage.model_s),
        timed), sum((t) => num(t.usage.tool_s), timed));
    }
  }
  for (const k of Object.keys(cells)) if (!cells[k].length) delete cells[k];
  return { folded, kids, fold, row: { scope: "agent", cells,
    label: [{ path: "name.label", spans: spans(span(name, "F_BLU")),
      drop: 0 }] } };
}

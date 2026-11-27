// The band's tree of threads above the prompt.
//
// docs/layout.md, "The tree", has the design.  🎮
// the session is the root, its label the workspace; 🧵 the main thread is
// its child, and under 🧵 come 🎤, the main thread's turn, first, then
// each subagent under the thread that started it, in the order they
// started.  🎤 is a leaf; where 🧵 is not drawn, 🎤 and the subagents hang from 🎮.  Every row
// is a row of the one grid (grid.ts): the hierarchy is in the label
// alone, as `├─` `╰─` `│` lines three columns a level, so every figure
// keeps its column on every row.  Only the lines and each row's kind
// glyph move with its depth: the state circles stand in one column, a
// blank past the deepest kind glyph drawn, and the names three columns
// further on, so names and what follows them line up on every row
// (alignHeads).
//
// After a thread's agents come its open background shells (💻) and
// Monitors (📡), in the order they opened, each a leaf row laid out as an
// agent's: its call's description or its command short (shell_words.ts)
// in the names' column, after 📂 and a folder its command changes to, the
// last line of its output in the text's, and how long it has run.  A row
// that finishes, an agent that ends
// or a shell or Monitor that closes, stays where it stood, ⚫, for
// `finished-within` seconds after it finished, its parents with it, and
// then goes.  Every row is drawn: the person scrolls the band, or folds a
// row to hide its subtree.  A row with children draws ⊟ in its tree
// line, or ⊞ where it is folded; a folded thread counts every agent
// hidden under it with 👶🏻 and its own hidden shells and Monitors with
// 💻 📡, which an opened one leaves to the rows.
// Each row's fold is kept under its key (ROOT_FOLD, MAIN_FOLD, an agent's
// id), and every row starts opened.
//
// The spans carry what a press on them does (Press): a fold mark toggles
// its row's fold, an agent's label switches the transcript to it, and 🧵
// main's and 🎤 turn's to the main conversation, a shell's or a Monitor's
// shows what the band knows of it as a toast, and on 🎮's label 📦 🌿 🔀 link to the
// repository on GitHub, where its address is known.
//
// Stamped (TreeInput's `stamped`), the same tree is the turn's receipt
// (receipt.ts): every agent the turn ran, each under the agent that
// started it, ended or not, with no folds and no presses, and 🏁 on the turn and on each agent that had ended.
//
// Pure: the rows' figures come in built (band.ts), and the agents as the
// document's prepared tasks (subagent_tasks.ts).
import {
  E_BG_DIR, E_FOLD_OPEN, E_FOLD_SHUT, E_MODE_MONITOR, E_MODE_SHELL,
  E_PHASE_DONE, E_PHASE_END, E_PHASE_FAILED, E_PHASE_RUN,
  E_THREAD, E_TREE_BAR, E_TREE_DASH, E_TREE_LAST,
  E_TREE_MID, E_TURN, E_SESSION, E_IDLE,
} from "./spec.ts";
import { durFmt, grade, padVal, visWidth } from "./formatting.ts";
import type { Settings } from "./formatting.ts";
import { paint, pressed, span, width } from "./spans.ts";
import type { Press, Span } from "./spans.ts";
import { isDict } from "./py.ts";
import type { Dict } from "./py.ts";
import {
  BG_COMMAND_MAX, BG_LABEL_MAX, BG_NEWLINE, squash,
} from "./claude_records.ts";
import type { BgTask } from "./claude_records.ts";
import { folderChip, shortCommand } from "./shell_words.ts";
import type { Limits } from "./claude_sources.ts";
import {
  A_STATE_W, agentCells, agentLabel, inheritedEtas, parked,
  runningParents,
} from "./agent_row.ts";
import type { Eta } from "./agent_row.ts";
import {
  CELLS, renderBackground, renderInbox, sessionNamePieces, workspacePieces,
} from "./cells.ts";
import { PAYER_GLYPHS, partsSince } from "./spending.ts";
import type { Payer } from "./spending.ts";
import type { Workspace } from "./cells.ts";
import { preparedOf } from "./subagent_tasks.ts";
import type { TreeTask } from "./subagent_tasks.ts";
import { hidden } from "./grid.ts";
import type { Piece, Row } from "./grid.ts";

/** The subagents the tree draws: the document's prepared tasks, the plan
 * reading their shares are drawn under, the clock, and when the turn
 * opened, which the receipt counts the agents it ran from (stampedSplit;
 * null: no turn running).  `mainBackground` is the main thread's open
 * background shells and Monitors, in the order they opened; each agent's
 * are its task's `bgTasks`. */
export type TreeAgents = {
  readonly tasks: readonly TreeTask[];
  readonly limits: Limits;
  readonly now: number;
  readonly turnStart: number | null;
  readonly mainBackground?: readonly BgTask[];
  /** The main thread's background tasks that closed, each with its end;
   * each agent's are its task's `bgEnded`. */
  readonly mainEnded?: readonly BgTask[];
  /** How many seconds after it finished a row stays drawn as it was
   * (`finished-within`): an agent that ended, and a shell or Monitor that
   * closed, before it goes.  None where absent or 0. */
  readonly linger?: number;
  /** The home folder, the document's `agents.home`, which a background
   * task's toast draws as `~` in its output file (bgPath), and its row in
   * its command; none where absent. */
  readonly home?: string;
  /** The main thread's working directory, the document's `agents.cwd`,
   * which its background tasks' rows draw a folder apart from
   * (folderChip); each agent's is its usage's `cwd`.  None where absent. */
  readonly cwd?: string;
  /** The agents an earlier receipt left out while they were still at
   * work, by id: the stamped tree owes each its row once it has ended
   * (stampedSplit). */
  readonly owed?: readonly string[];
  /** The pool paying other than the plan, and since when (spending.ts):
   * each agent's row bills its own parts from `since` on in the column
   * after 💰.  None while the plan pays, and on the receipt. */
  readonly spending?: { readonly kind: Payer; readonly since: number | null }
    | null;
};

/** What the tree is drawn from.  The rows `session`, `main` and `turn` are
 * the band's, null where the place or the phase leaves one out; their
 * labels are drawn here again.  `mainPhase` and `turnPhase` are their
 * state circles, `mainInbox` the messages queued for the main thread,
 * `mainProgress` the first line of the last text it wrote, and
 * `turnPrompt` the prompt typed last, drawn after 🎤's name.  `folds` are the folds kept,
 * by key.  `repo` is the repository's address on GitHub, which 📦 🌿
 * 🔀 link to; null or absent, they link nowhere.  `sessionName` and
 * `sessionColour` are the session's name and Claude Code's colour for it,
 * drawn on 🎮's label in the names' column, before 📦
 * (sessionNamePieces); absent, none.
 * `stamped` draws the tree as the turn's receipt stamps it: the agents as
 * stampedNodes picks them, every row opened, no fold marks,
 * `folds` and `repo` not read, and nothing pressing. */
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
  readonly folds?: Folds;
  readonly repo?: string | null;
  readonly stamped?: boolean;
  readonly sessionName?: string;
  readonly sessionColour?: string;
};

/** The folds the person left, by key: true folded, false opened.  A key
 * absent is its row's default (foldShut). */
export type Folds = { readonly [key: string]: boolean };

/** The fold keys of 🎮 and 🧵 main, which no agent id can be. */
export const ROOT_FOLD = "session";
export const MAIN_FOLD = "main";

/** Whether the row kept under `key` is folded: as `folds` keeps it, else
 * `shut`, its default. */
export function foldShut(folds: Folds, key: string, shut: boolean): boolean {
  return Object.hasOwn(folds, key) ? folds[key] : shut;
}

/** `folds` less the fold of every agent row the tree no longer draws:
 * each key that is not in `drawn` (drawnAgents), so no later row takes a
 * fold it never had.  🎮's and 🧵's stay.  `folds` itself where nothing
 * is dropped. */
export function pruneFolds(folds: Folds, drawn: ReadonlySet<string>):
  Folds {
  const keep = (key: string): boolean =>
    key === ROOT_FOLD || key === MAIN_FOLD || drawn.has(key);
  const kept = Object.entries(folds).filter(([k]) => keep(k));
  return kept.length === Object.keys(folds).length ? folds
    : Object.fromEntries(kept);
}

/** The `$.store` key a conversation's folds are kept under, by its
 * session id, the transcript file's name, which a restart, a `--resume`
 * and a `--continue` of it go on under. */
export function foldsKey(session: string): string {
  return FOLDS_PREFIX + session;
}

export const FOLDS_PREFIX = "folds:";

/** How long a conversation's folds are kept after they last changed, by a
 * press or a prune: 31 days, as the store's other per-session entries
 * are, so the store, one JSON file for every session, stays small. */
export const FOLDS_KEEP_S = 31 * 86400;

/** `value`'s folds where every one is a boolean, else null. */
function boolFolds(value: unknown): Folds | null {
  if (!isDict(value)) return null;
  const folds = Object.entries(value);
  return folds.every(([, v]) => typeof v === "boolean")
    ? Object.fromEntries(folds) as Folds : null;
}

/** A store entry, `{session, folds, saved_at}`, read back: its folds where
 * it is `session`'s and every fold a boolean, else null, so a value of
 * another shape, or none, is a load with nothing kept. */
export function keptFolds(value: unknown, session: string): Folds | null {
  return isDict(value) && value.session === session
    ? boolFolds(value.folds) : null;
}

/** The folds `$.state` holds, and the session they are of. */
export type HeldFolds = { readonly session: string; readonly folds: Folds };

/** `$.state`'s folds read back: `{session, folds}` as this version keeps
 * them; a plain Folds, as an earlier version kept them, of no session
 * (""); and anything else, none. */
export function heldFolds(value: unknown): HeldFolds {
  if (isDict(value) && typeof value.session === "string") {
    return { session: value.session, folds: boolFolds(value.folds) ?? {} };
  }
  return { session: "", folds: boolFolds(value) ?? {} };
}

/** Whether a store entry of folds is past keeping at `now`: saved more
 * than FOLDS_KEEP_S ago, or of no shape that says when. */
export function foldsStale(value: unknown, now: number): boolean {
  const at = isDict(value) ? value.saved_at : null;
  return typeof at !== "number" || !Number.isFinite(at) ||
    now - at > FOLDS_KEEP_S;
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

/** 💻 and 📡, how many of `bg` are shells and how many Monitors, as a
 * folded thread's label counts them, under `state.shells` and
 * `state.monitors`, each only where it has one. */
function bgCounts(bg: readonly BgTask[]): Piece[] {
  return ([["state.shells", E_MODE_SHELL, "bash"],
    ["state.monitors", E_MODE_MONITOR, "monitor"]] as const)
    .map(([path, mark, kind]): Piece => ({ path, drop: 0,
      spans: renderBackground(mark, bg.filter((b) => b.kind === kind)
        .length) }))
    .filter((p) => p.spans.length)
    .map((p) => ({ ...p, spans: [...p.spans, span(" ")] }));
}

/** The ⌛ cell of a row that has run `age` seconds. */
function ageCell(st: Settings, age: number): Span[] {
  const fig = durFmt(st, age);
  return [span(E_IDLE),
    paint(grade("duration", "F_PRW", fig, st.colourMode), padVal(st, 4, fig))];
}

/** How long background task `b` has run at `now`: to its end, for one
 * that has closed; null where its start is not known. */
function bgAge(b: BgTask, now: number): number | null {
  return b.start === null ? null
    : Math.max(0, (b.end ?? now) - b.start);
}

/** The longest output path a task's toast draws whole; a longer one keeps
 * its first two folders and its file name (bgPath). */
export const BG_PATH_MAX = 80;

/** What a task's toast puts before its output file: drawn only in the
 * toast, never on a row, so it is no mark of the spec's. */
const TOAST_OUTPUT = "⤷";

/** Output file `path` as a task's toast draws it: `home`, where given and
 * the path is under it, as `~`, and where still longer than BG_PATH_MAX,
 * its first two folders, `…` and its file name. */
export function bgPath(path: string, home = ""): string {
  const p = home && (path === home || path.startsWith(home + "/"))
    ? "~" + path.slice(home.length) : path;
  if (Array.from(p).length <= BG_PATH_MAX) return p;
  const segs = p.split("/");
  const lead = p.startsWith("/") ? 3 : 2;
  return segs.length > lead + 1
    ? [...segs.slice(0, lead), "…", segs.at(-1)].join("/") : p;
}

/** Whether background task `b`'s label is its command's first line, cut
 * as backgroundLabel cuts it, its call having no description. */
function labelIsCommand(b: BgTask): boolean {
  const cmd = b.command ?? "";
  return Boolean(cmd && b.label) && Array.from(cmd.split(BG_NEWLINE)[0])
    .slice(0, BG_LABEL_MAX).join("") === b.label;
}

/** Whether background task `b`'s command is kept whole, not cut to
 * BG_COMMAND_MAX characters (backgroundCommand). */
function commandWhole(b: BgTask): boolean {
  const cmd = b.command ?? "";
  return Array.from(cmd).length < BG_COMMAND_MAX || !cmd.includes("…");
}

/** Its state circle: 🟢 running, ⚫ closed, and 🔴 closed with a non-zero
 * exit code. */
function bgPhase(b: BgTask): string {
  return b.end === undefined ? E_PHASE_RUN
    : b.exit !== undefined && b.exit !== 0 ? E_PHASE_FAILED : E_PHASE_END;
}

/** What a press on a background task's row shows, one line: its glyph
 * and kind, 🟢 running, ⚫ ended, or 🔴 ended and its exit code where that
 * is not 0, ⌛ how long it has run, or ran, where
 * its start is known; `label`, its call's description, else its
 * command's first line (backgroundLabel), left out where it is that
 * first line, cut as backgroundLabel cuts it; `$` and its command on one line (backgroundCommand),
 * where known; and ⤷ the file its output is written to (bgPath), where
 * known. */
export function bgText(st: Settings, b: BgTask, label: string,
  now: number, home = ""): string {
  const shell = b.kind === "bash";
  const age = bgAge(b, now);
  const cmd = b.command ?? "";
  const out = b.output ?? "";
  const phase = bgPhase(b);
  return [shell ? E_MODE_SHELL + " shell" : E_MODE_MONITOR + " Monitor",
    phase === E_PHASE_RUN ? phase + " running"
      : phase + " ended" + (phase === E_PHASE_FAILED ? ", exit " + b.exit
        : ""),
    ...(age === null ? [] : [E_IDLE + " " + durFmt(st, age).trim()]),
    ...(labelIsCommand(b) ? [] : [label]),
    ...(cmd ? ["$ " + cmd] : []),
    ...(out ? [TOAST_OUTPUT + " " + bgPath(out, home)] : [])].join(" · ");
}

/** The name and folder chip a background task's row draws: its call's
 * description, else its command short (shortCommand), else its label as
 * backgroundLabel cut it, else its kind; and the folder its command's
 * leading `cd`s change to where that is not `cwd`, its thread's
 * (folderChip), else "". */
export function bgName(b: BgTask, cwd: string, home: string):
  { readonly name: string; readonly chip: string } {
  const short = commandWhole(b) ? shortCommand(b.command ?? "", home) : null;
  const name = squash(labelIsCommand(b) && short ? short.text : b.label)
    .trim() || (b.kind === "bash" ? "shell" : "monitor");
  return { name, chip: short ? folderChip(short.dirs, cwd, home) : "" };
}

/** The row of a background task, laid out as an agent's: 💻 for a shell,
 * 📡 for a Monitor, with 🟢 as every running thread has, or ⚫ once it has
 * closed, 🔴 with a non-zero exit code (bgPhase); in the names' column 📂
 * and its folder where its command changes to one apart from `cwd`, its
 * thread's, and its name (bgName); in the text's, dim, the last line of
 * its output, a shell's log's or a Monitor's latest event's; ⌛ how long
 * it has run, or ran, where its start is known.  A leaf, as it has no
 * transcript to switch to: a shell's label opens its log band, and a
 * Monitor's shows bgText as a toast. */
function bgNode(st: Settings, b: BgTask, now: number, home: string,
  cwd: string): Node {
  const shell = b.kind === "bash";
  const label = squash(b.label).trim() || (shell ? "shell" : "monitor");
  const { name, chip } = bgName(b, cwd, home);
  const age = bgAge(b, now);
  return { folded: false, kids: [], row: { scope: "agent",
    label: pressingAll([headPiece(st, shell ? E_MODE_SHELL : E_MODE_MONITOR,
      bgPhase(b)),
    { path: "name.label", spans: [
      ...chip ? [span(E_BG_DIR + chip, "F_BLU"), span(" ")] : [],
      span(name)], drop: 0 },
    ...progressPiece(b.last ?? "")],
    shell ? { kind: "log", row: b.id, output: b.output ?? "",
      command: b.command ?? "" }
      : { kind: "task", row: b.id, text: bgText(st, b, label, now, home) }),
    cells: age === null ? {} : { clock: ageCell(st, age) } } };
}

/** Whether a row that finished at `end` is still drawn at `now`, `linger`
 * seconds after it finished: never where `end` is not known. */
export function lingers(end: number | null | undefined, now: number,
  linger: number): boolean {
  return linger > 0 && typeof end === "number" && now - end < linger;
}

/** The background rows a thread draws at `now`: its open tasks `open`,
 * and those of its closed tasks `gone` that still linger (lingers), each
 * where it stood, in the order they opened. */
export function bgRows(open: readonly BgTask[], gone: readonly BgTask[],
  now: number, linger: number): readonly BgTask[] {
  const ids = new Set(open.map((b) => b.id));
  const still = gone.filter((b) => !ids.has(b.id) &&
    lingers(b.end, now, linger));
  if (!still.length) return open;
  const at = (b: BgTask): number => b.start ?? Infinity;
  return [...open, ...still].sort((x, y) =>
    at(x) === at(y) ? 0 : at(x) < at(y) ? -1 : 1);
}

/** A thread's head, its kind glyph and its state circle in two columns,
 * then a blank, under `name.kind`; alignHeads sets the circle in its
 * column. */
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
  out.push({ ...n.row, label: [
    ...(line.length ? [{ path: "tree", spans: line, drop: 0 }] : []),
    ...n.row.label] });
  if (!n.folded) walk(n.kids, lasts, out, marks);
}

/** The tree's rows, top to bottom, under `hide`: 🎮, then 🧵 and under
 * it 🎤 and its subagents.  Without 🎮 its
 * children stand at the top; without 🧵, 🎤 and the subagents hang from
 * the root.  Stamped, as TreeInput's `stamped` says. */
export function treeRows(st: Settings, inp: TreeInput,
  hide: readonly string[]): Row[] {
  const stamped = inp.stamped ?? false;
  const folds = stamped ? {} : inp.folds ?? {};
  const pressing = (pieces: readonly Piece[], press: Press): Piece[] =>
    stamped ? [...pieces] : pressingAll(pieces, press);
  const shown = inp.agents !== null && !hidden(hide, "agent");
  const agents = !shown ? []
    : stamped ? stampedNodes(st, inp.agents!)
    : agentNodes(st, inp.agents!, folds);
  // The stamped receipt lists the turn's agents alone, no open shells.
  const mainBg = shown && !stamped ? inp.agents!.mainBackground ?? [] : [];
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
        ...(folded ? bgCounts(mainBg) : []),
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
        { path: "name.label", spans: [span(E_SESSION)], drop: 0 },
        ...sessionNamePieces(inp.sessionName ?? "", inp.sessionColour ?? ""),
        ...linked(ws, stamped ? null : inp.repo ?? null,
          inp.workspace)] } }, [], out, !stamped);
  } else {
    for (const n of top) drawNode(n, [], out, !stamped);
  }
  return alignHeads(st, out);
}

/** The blank between the deepest kind glyph and the state circles. */
const LIGHT_GAP = 1;

/** The tree's rows with their heads set in columns: every state circle
 * in the one column LIGHT_GAP past the end of the deepest kind glyph
 * drawn, so it moves as a deeper row comes or goes, and every name
 * A_STATE_W and a blank after it.  A row's kind glyph is the first span
 * after its tree line; a row whose head is a `name.kind` piece has a
 * circle after it, and the rest, 🎮, sets what
 * follows its glyph in the names' column.  The blanks press what the
 * glyph presses, so a row's click covers its head whole. */
function alignHeads(st: Settings, rows: readonly Row[]): Row[] {
  const heads = rows.map((r) => {
    const at = r.label[0]?.path === "tree" ? 1 : 0;
    const head = r.label[at];
    if (!head?.spans.length) return null;
    return { at, lit: head.path === "name.kind",
      end: width(r.label.slice(0, at).flatMap((p) => p.spans), st.widths) +
        visWidth(head.spans[0].text, st.widths) };
  });
  const ends = heads.flatMap((h) => h ? [h.end] : []);
  if (!ends.length) return [...rows];
  const light = Math.max(...ends) + LIGHT_GAP;
  return rows.map((r, i) => {
    const h = heads[i];
    if (!h) return r;
    const pad = (h.lit ? light : light + A_STATE_W + 1) - h.end;
    const head = r.label[h.at];
    const [glyph, ...rest] = head.spans;
    const blank = { ...span(" ".repeat(pad)),
      ...(glyph.press ? { press: glyph.press } : {}) };
    const label = [...r.label];
    label[h.at] = { ...head, spans: [glyph, blank, ...rest] };
    return { ...r, label };
  });
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

/** Whether a task has ended at `now`: failed, killed, or completed and
 * waiting on nothing (parked says what a completed agent can still wait
 * on).  A waiting one has not: it is paused. */
function ended(t: Dict, u: Dict, busy: ReadonlySet<string>,
  now: number): boolean {
  const s = String(t.status ?? "");
  if (s === "failed" || s === "killed") return true;
  return s === "completed" && !parked(s, u.eta, now, busy.has(String(t.id)),
    u.background);
}

/** The subagents as forestOf places them. */
type Forest = {
  readonly byId: ReadonlyMap<string, TreeTask>;
  readonly busy: ReadonlySet<string>;
  readonly shownKids: (id: string) => string[];
};

/** The subagents of `a` as the tree places them: each by its id, the ids
 * with an agent at work under them (runningParents), and the agents
 * drawn under each thread, by its id, "" for 🧵, in the order they
 * started.  An agent is drawn while at work, paused (parked) included;
 * once it has ended, for `a.linger` seconds after, or while one drawn
 * hangs under it. */
function forestOf(a: TreeAgents): Forest {
  const busy = runningParents(preparedOf(a.tasks));
  const byId = new Map(a.tasks.map((t) => [String(t.task.id), t]));
  // Each agent under the one that started it, else under "" for 🧵: an
  // agent drawn keeps every agent above it drawn (live).
  const kidsOf = new Map<string, string[]>();
  for (const [id, t] of byId) {
    const up = String(t.meta?.parentAgentId ?? "");
    const parent = up !== id && byId.has(up) ? up : "";
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
    return ended(t.task, t.usage, busy, a.now);
  };
  const linger = a.linger ?? 0;
  // When an agent ended: its last record.
  const endOf = (id: string): number | null => {
    const u = byId.get(id)!.usage;
    return (u.last_seen ?? u.last_epoch) as number | null;
  };
  // Drawn as a live one is: at work, ended under `linger` seconds ago, or
  // over a live agent.
  const liveMemo = new Map<string, boolean>();
  const live = (id: string): boolean => {
    if (!liveMemo.has(id)) {
      liveMemo.set(id, false);
      liveMemo.set(id, !isEnded(id) || lingers(endOf(id), a.now, linger) ||
        (kidsOf.get(id) ?? []).some((k) => live(k)));
    }
    return liveMemo.get(id)!;
  };
  const shownKids = (id: string): string[] =>
    (kidsOf.get(id) ?? []).filter(live);
  return { byId, busy, shownKids };
}

/** The ids of the agents the tree draws from `a` with every row opened
 * (forestOf): those whose folds pruneFolds keeps.  A row hidden under a
 * folded one is still drawn, so it keeps its fold for when that opens. */
export function drawnAgents(a: TreeAgents): ReadonlySet<string> {
  const { shownKids } = forestOf(a);
  const out = new Set<string>();
  const walkKids = (id: string): void => {
    for (const k of shownKids(id)) {
      if (out.has(k)) continue;
      out.add(k);
      walkKids(k);
    }
  };
  walkKids("");
  return out;
}

/** The subagents as the tree's nodes under 🧵 main: the agents forestOf
 * draws, each under the agent that started it, an ended one as it stood.
 * Folding a row hides its subtree.  After each thread's agents, its open
 * shells and Monitors (bgNode), and the closed ones that linger. */
function agentNodes(st: Settings, a: TreeAgents, folds: Folds): Node[] {
  const { byId, busy, shownKids } = forestOf(a);
  const etas = inheritedEtas(preparedOf(a.tasks));
  const linger = a.linger ?? 0;
  const under = (id: string): string[] =>
    shownKids(id).flatMap((k) => [k, ...under(k)]);
  // A thread's open shells and Monitors, the main thread's under "".
  const bgOf = (id: string): readonly BgTask[] => id === ""
    ? a.mainBackground ?? [] : byId.get(id)!.bgTasks ?? [];
  // Its rows: the open ones and the closed ones that linger.
  const bgDrawn = (id: string): readonly BgTask[] => bgRows(bgOf(id),
    id === "" ? a.mainEnded ?? [] : byId.get(id)!.bgEnded ?? [], a.now,
    linger);
  // Where a thread works, which its tasks' rows draw a folder apart from.
  const cwdOf = (id: string): string => {
    const own = id === "" ? a.cwd : byId.get(id)!.usage.cwd;
    return typeof own === "string" ? own : "";
  };
  const bgNodes = (id: string): Node[] =>
    bgDrawn(id).map((b) => bgNode(st, b, a.now, a.home ?? "", cwdOf(id)));
  const shut = (id: string): boolean =>
    (shownKids(id).length > 0 || bgDrawn(id).length > 0) &&
    foldShut(folds, id, false);
  const agentRow = (id: string): Row => {
    const t = byId.get(id)!;
    const waitingOn = busy.has(id);
    const eta: Eta | false = etas.has(id) ? etas.get(id)! : false;
    // 👶🏻 on a folded row: every agent hidden under it.  💻 📡 count its
    // own shells and Monitors wherever their rows are not drawn under it.
    const folded = shut(id);
    const drawn = !folded && bgOf(id).length > 0;
    const label = agentLabel(st, t.task, t.usage, t.meta, waitingOn,
      folded ? under(id).length : 0, 0, null, true, a.now)
      .filter((p) => !drawn ||
        (p.path !== "state.shells" && p.path !== "state.monitors"));
    return { scope: "agent", agentId: id,
      label: pressingAll([...label, ...progressPiece(t.progress)],
      { kind: "view", agent: id }),
      cells: spendOn(st, a, [t], agentCells(st, t.task, t.usage, t.meta,
        t.shares, a.limits, a.now, eta, waitingOn)) };
  };
  const agentNode = (id: string): Node => {
    const folded = shut(id);
    return { row: agentRow(id), folded, fold: { key: id, shut: false },
      kids: folded ? [] : [...place(id), ...bgNodes(id)] };
  };
  const place = (parent: string): Node[] =>
    shownKids(parent).map(agentNode);
  return [...place(""), ...bgNodes("")];
}

/** Which agents a turn's receipt stamps, by id, and which it owes a row
 * to later.  The turn ran an agent that started since `a.turnStart` or
 * whose last record is since then, one with no record yet, or, with no
 * turnStart, every agent; an earlier receipt's `a.owed` count as run too.
 * Of those, each that has ended (completed, failed or killed, with no
 * agent under it at work) is stamped, and each still running or paused
 * is owed, so the first receipt after it ends stamps it, whether or not
 * it wrote anything in that turn. */
export function stampedSplit(a: TreeAgents):
  { readonly stamp: ReadonlySet<string>; readonly owe: readonly string[] } {
  const busy = runningParents(preparedOf(a.tasks));
  const owed = new Set(a.owed ?? []);
  const ran = (t: TreeTask): boolean => {
    if (owed.has(String(t.task.id))) return true;
    const end = t.usage.last_seen ?? t.usage.last_epoch;
    const begun = typeof t.task.startTime === "number";
    if (a.turnStart === null || (!begun && typeof end !== "number")) {
      return true;
    }
    return (begun && (t.task.startTime as number) / 1000 >= a.turnStart) ||
      (typeof end === "number" && end >= a.turnStart);
  };
  const stamp = new Set<string>();
  const owe: string[] = [];
  for (const t of a.tasks.filter(ran)) {
    const id = String(t.task.id);
    if (ended(t.task, t.usage, busy, a.now)) stamp.add(id);
    else owe.push(id);
  }
  return { stamp, owe };
}

/** The subagents as the stamped tree's nodes under 🧵 main: the agents
 * stampedSplit stamps, each under the nearest agent above it stamped
 * too, else under 🧵, in the order they started.  Every row opened, none
 * pressing; each draws 🏁 in place of its
 * ⚫. */
function stampedNodes(st: Settings, a: TreeAgents): Node[] {
  const prepared = preparedOf(a.tasks);
  const busy = runningParents(prepared);
  const etas = inheritedEtas(prepared);
  const { stamp } = stampedSplit(a);
  const all = new Map(a.tasks.map((t) => [String(t.task.id), t]));
  const byId = new Map(a.tasks.filter((t) => stamp.has(String(t.task.id)))
    .map((t) => [String(t.task.id), t]));
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
    const label = agentLabel(st, t.task, t.usage, t.meta, waitingOn, 0, 0,
      null, true, a.now).map((p) => p.path === "name.kind"
      ? { ...p, spans: p.spans.map((s) => ({ ...s,
        text: s.text.replace(E_PHASE_END, E_PHASE_DONE) })) } : p);
    return { scope: "agent",
      label: [...label, ...progressPiece(t.progress)],
      cells: spendOn(st, a, [t], agentCells(st, t.task, t.usage, t.meta,
        t.shares, a.limits, a.now, eta, waitingOn)) };
  };
  // Agents whose parents run in a cycle are left out, as no thread
  // started them.
  return (kidsOf.get("") ?? []).map(function node(id: string): Node {
    return { row: row(id), folded: false,
      kids: (kidsOf.get(id) ?? []).map(node) };
  });
}

/** `cells` with the column after 💰 for the billed `tasks`, summed: their
 * parts from the paying pool's `since` on, under its glyph.  As they are
 * while the plan pays, or where none of them billed. */
function spendOn<C extends { readonly [key: string]: readonly Span[] }>(
  st: Settings, a: TreeAgents, tasks: readonly TreeTask[], cells: C):
  C | (C & { spend: Span[] }) {
  const pay = a.spending;
  if (!pay) return cells;
  // A usage is read by key with a default, as an agent's cells read it:
  // none, or one without parts, bills nothing.
  const parts = tasks.flatMap((t) =>
    (t.usage?.parts ?? []) as [number | null, number][]);
  if (!parts.length) return cells;
  return { ...cells, spend: CELLS.spend(st, PAYER_GLYPHS[pay.kind],
    partsSince(parts, pay.since)) };
}

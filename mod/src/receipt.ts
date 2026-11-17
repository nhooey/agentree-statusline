// The receipt a turn ends with, and the start line under its prompt, from
// the figures documents.
//
// agents/plans/closed/redesign.md has the design ("The receipt"):
// live, then stamped.  While a turn runs the band draws its 🎤 and 🎮 rows; once the
// turn's records are in the transcript, the mod stamps them there frozen, a
// `$.ui.log` line each: a head, 🔺🔖 the turn's tag, the account's limits
// and when it was stamped, and over it the same two rows, from the cost document
// (`costFigures`), dim so history reads apart from the live band.  As
// a turn starts, the mod draws the same tag under the prompt, 🔻 pointing
// down at the turn it opens, from the status document.  The rows are drawn
// on the band's fixed grid (band.ts), so the receipt's columns are the
// band's and the panel's.  Each row is drawn as the band's tree
// (band_tree.ts) draws it, stamped: 🎤🏁 `turn` and the prompt it
// answered.  A turn that ran subagents stamps them too: 🧵 the parent, 🎤
// under it first, then every agent the turn ran, 🏁 on each that ended.
//
// Pure, as band.ts is: the clock is drawn in the TZ the edge sets.
import {
  E_PHASE_DONE, E_PHASE_END, E_TURN_AHEAD, E_TURN_PAST,
} from "./spec.ts";
import type { Settings } from "./formatting.ts";
import { span } from "./spans.ts";
import type { Span } from "./spans.ts";
import type { Turn } from "./claude_records.ts";
import { turnShares } from "./claude_calib.ts";
import type { Accounting } from "./claude_calib.ts";
import {
  decodeLimits, decodeTranscript, decodeTurn, readAccounting,
} from "./figures.ts";
import {
  CELLS, cacheRate, hms, sessionLabel, turnLabel, turnLine, ymd,
} from "./cells.ts";
import { draw, hidden } from "./grid.ts";
import type { Row } from "./grid.ts";
import {
  ROW_NAMES, accountingSplit, fixedKeys, scopesOf, shareCells, turnCache,
  turnTokens,
} from "./band.ts";
import type { RowName } from "./band.ts";
import { treeRows } from "./band_tree.ts";
import type { TreeAgents } from "./band_tree.ts";
import type { TreeTask } from "./subagent_tasks.ts";
import { pyFloat } from "./sources.ts";
import type { Dict } from "./py.ts";

type Cells = { [key: string]: Span[] };

/** The turn the receipt bills: the last with calls that is neither a
 * compaction nor an agent's, else the last; -1 with none. */
export function receiptTurn(turns: readonly Turn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.calls && !t.compact && !t.agent) return i;
  }
  return turns.length - 1;
}

/** Whether `t` is an automatic compaction, which lands inside whatever
 * turn was running: the fold gives it a turn of its own, named as
 * turnsOf names it, and files the running turn's records after it there,
 * with no promptId. */
function inTurnCompaction(t: Turn): boolean {
  return t.compact && !t.agent && t.text === "/compact (auto)";
}

/** Sums `a` and `b` where either is a number, else null. */
function addOrNull(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : a + b;
}

/** `t` with the compaction `c` that landed inside it, and the records
 * after it, as one turn: its own tag and prompt, everything billed summed,
 * the compaction's dollars and tokens with it, since the turn spent them.
 * 🧠 adds up: each turn's growth is over the reading before it. */
function absorb(t: Turn, c: Turn): Turn {
  return { ...t,
    fresh: t.fresh + c.fresh, cache_write: t.cache_write + c.cache_write,
    cache_read: t.cache_read + c.cache_read, out: t.out + c.out,
    ctx: c.ctx || t.ctx, calls: t.calls + c.calls, dur_s: t.dur_s + c.dur_s,
    dctx: addOrNull(t.dctx, c.dctx), usd_in: t.usd_in + c.usd_in,
    usd_out: t.usd_out + c.usd_out, usd_cr: t.usd_cr + c.usd_cr,
    usd_cw: t.usd_cw + c.usd_cw, reported: c.reported,
    parts: [...t.parts, ...c.parts], agent_calls: t.agent_calls + c.agent_calls,
    agent_ids: [...t.agent_ids, ...c.agent_ids],
    tool_s: t.tool_s + c.tool_s, blocked_s: t.blocked_s + c.blocked_s,
    agent_model_s: t.agent_model_s + c.agent_model_s,
    agent_tool_s: t.agent_tool_s + c.agent_tool_s,
    lines_added: t.lines_added + c.lines_added,
    lines_removed: t.lines_removed + c.lines_removed,
    eta: c.eta.length ? c.eta : t.eta };
}

/** absorb's, for the two turns' accountings: the window shares add up, as
 * the dollars do; the cache shares are worked out again over `merged`. */
function absorbAccounting(a: Accounting, c: Accounting, merged: Turn):
  Accounting {
  const [read_share, write_share] = turnShares(merged);
  return { ...a, cost_usd: a.cost_usd + c.cost_usd,
    sess_share: addOrNull(a.sess_share, c.sess_share),
    week_share: addOrNull(a.week_share, c.week_share), read_share,
    write_share, model_s: a.model_s + c.model_s, tool_s: a.tool_s + c.tool_s,
    blocked_s: a.blocked_s + c.blocked_s,
    lines_added: a.lines_added + c.lines_added,
    lines_removed: a.lines_removed + c.lines_removed };
}

/** `turns` as the receipt bills them: each automatic compaction folded
 * into the turn it landed in, with `acc`, the turns' accountings, folded
 * alike.  The fold splits such a turn in two at the compaction: its prompt
 * with what it billed before, and a compaction with no promptId holding
 * the rest, which the receipt would pass over, billing the turn before
 * instead, or nothing. */
export function inTurns<A extends Accounting | null>(turns: readonly Turn[],
  acc: readonly A[]): [Turn[], A[]] {
  const out: Turn[] = [];
  const outAcc: A[] = [];
  for (let i = 0; i < turns.length; i++) {
    const head = out.length - 1;
    const prev = head >= 0 ? out[head] : null;
    if (prev && !prev.compact && !prev.agent &&
      inTurnCompaction(turns[i])) {
      out[head] = absorb(prev, turns[i]);
      const a = outAcc[head];
      const c = acc[i];
      if (a && c) outAcc[head] = absorbAccounting(a, c, out[head]) as A;
      continue;
    }
    out.push(turns[i]);
    outAcc.push(acc[i]);
  }
  return [out, outAcc];
}

/** inTurns over a cost figures document: its turns and their accountings
 * as the receipt bills them.  A document already folded comes back as it
 * was. */
export function billedFig(fig: Dict): Dict {
  const raw = fig.turns as Dict[];
  const acc = fig.accounting as Dict;
  const accTurns = (acc.turns as Dict[]).map(readAccounting);
  const [turns, accs] = inTurns(raw.map(decodeTurn), accTurns);
  if (turns.length === raw.length) return fig;
  return { ...fig, turns, accounting: { ...acc, turns: accs } };
}

/** Whether the billed turn is the turn that opened with `prompt`, its
 * promptId, or with none given, the newest of the main thread's turns.
 * One before it is the turn before's, read before this turn's records were
 * written: Claude Code writes a turn's assistant records only after its
 * Stop hooks have run, and its prompt's record as it opens, so until then
 * the newest prompt bills nothing and receiptTurn falls back past it.
 * With `prompt`, a turn opened after it does not count: a task
 * notification delivered as the turn ends is written as a turn of its own
 * that may never run, and the turn it follows is billed all the same.  A
 * turn an automatic compaction landed in is read as one (inTurns). */
export function newestBilled(all: readonly Turn[], prompt = ""): boolean {
  const [turns] = inTurns(all, []);
  const i = receiptTurn(turns);
  if (i < 0 || !turns[i].calls || turns[i].compact || turns[i].agent) {
    return false;
  }
  if (prompt) return turns[i].prompt_id === prompt;
  for (let j = turns.length - 1; j > i; j--) {
    if (!turns[j].agent && !turns[j].compact) return false;
  }
  return true;
}

/** How a turn ended, as its turn.complete says: `reason`, and `usage`,
 * whether the engine counted any of its requests. */
export interface TurnEnd {
  readonly reason: string;
  readonly usage: boolean;
}

/** Why the turn that opened with `prompt` billed nothing, where that is
 * known, else "": it may yet bill.  A turn the fold shows billed is never
 * one.  Ended by an interrupt or an API error with no request counted
 * (`end`), it is "interrupted" or "an API error"; a prompt sent before it
 * was finished is rewound so, before any reply.
 * Or "replaced": no call of its own and a later prompt in the same turn
 * slot, its turnPosition's turnIndex, as the full prompt that replaced
 * that one was written ~2 min on. */
export function billedNothing(all: readonly Turn[], prompt: string,
  end: TurnEnd | null = null): string {
  const [turns] = inTurns(all, []);
  const at = prompt ? turns.findIndex((t) => t.prompt_id === prompt) : -1;
  const own = at >= 0 ? turns[at] : null;
  if (own && own.calls) return "";
  if (end && !end.usage) {
    if (end.reason === "aborted") return "interrupted";
    if (end.reason === "error") return "an API error";
  }
  if (own && own.turn_index !== null && turns.slice(at + 1).some((t) =>
    !t.agent && !t.compact && t.prompt_id && t.prompt_id !== prompt &&
    t.turn_index === own.turn_index)) return "replaced";
  return "";
}

/** The billed turn, as one key: its tag, its first stamp and how many
 * calls it has billed, so the same turn read again is the same key and a
 * turn that went on is not; "" with none. */
export function turnKey(all: readonly Turn[]): string {
  const [turns] = inTurns(all, []);
  const i = receiptTurn(turns);
  if (i < 0) return "";
  const t = turns[i];
  return JSON.stringify([t.prompt_id, t.turn_index, t.ts, t.calls]);
}

/** The plan reading's percentage as the plan cells take it, "" for
 * none. */
function planPct(plan: unknown, key: string): string {
  const v = plan && typeof plan === "object"
    ? (plan as Dict)[key] : null;
  return v === null || v === undefined ? "" : String(v);
}

/** 🎤: the turn the receipt bills, `turns[i]` with
 * `accounting.turns[i]`.  🧠 its growth, `dctx` over `context_window`;
 * 🧩 🎯 weighed from its tokens; ⌛ its `dur_s`; ⛳ the last ETA it
 * reported, `eta` (decision 6), read at `clock.now`, when it ended, so a
 * turn that ran past its estimate reads late; none for one signed off
 * at zero. */
function turnRow(st: Settings, t: Turn, acc: Accounting, win: number,
  now: number, sessPct: string, weekPct: string): Row {
  const [up, down] = turnTokens(t);
  const cells: Cells = {
    cost: CELLS.cost(st, acc.cost_usd),
    ctx: CELLS.growth(st, t.dctx, win),
    tok: CELLS.tok(st, up, down),
    cache: CELLS.cache(st, turnCache(t)),
    clock: CELLS.clock(st, t.dur_s),
    // A turn signed off at zero ended on time: its overrun is only the
    // seconds between the sign-off and the turn's last record, so no ⛳.
    eta: t.eta.length > 0 && t.eta[1] === 0 ? []
      : CELLS.eta(st, t.eta, null, now),
    split: accountingSplit(st, acc),
    ...shareCells(st, acc, sessPct, weekPct),
    diff: CELLS.diff(st, acc.lines_added, acc.lines_removed),
  };
  return { scope: "turn", label: turnLabel(), cells };
}

/** sum() of floats, left to right, as the receipt's totals add up. */
function addUp(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** 🎮: the session, `accounting.session`, its 🧩 🎯 every turn summed
 * as costTotalsGroup sums them, ⌛ its age from `start_s` (decision 5),
 * and its mark alone on the label, as the band's 🎮 is. */
function sessionRow(st: Settings, turns: readonly Turn[], acc: Accounting,
  now: number, sessPct: string, weekPct: string): Row {
  const tokens = turns.map(turnTokens);
  const cells: Cells = {
    cost: CELLS.cost(st, acc.cost_usd),
    tok: CELLS.tok(st, addUp(tokens.map(([u]) => u)),
      addUp(tokens.map(([, d]) => d))),
    cache: CELLS.cache(st, cacheRate(addUp(turns.map((t) => t.cache_read)),
      addUp(turns.map((t) => t.fresh + t.cache_write + t.cache_read)))),
    split: accountingSplit(st, acc),
    ...shareCells(st, acc, sessPct, weekPct),
    diff: CELLS.diff(st, acc.lines_added, acc.lines_removed),
  };
  if (acc.start_s !== null && acc.start_s !== undefined) {
    cells.clock = CELLS.clock(st, now - acc.start_s);
  }
  return { scope: "session", label: sessionLabel(), cells };
}

/** The receipt's rows from a cost figures document: 🎤, or null with no
 * turn to bill, and 🎮, and the prompt the billed turn opened with, ""
 * with none.  They have no 📊 of their own: the band has no
 * 🎤 or 🎮 once a turn ends, so they read
 * apart by being dim. */
export function receiptRows(st: Settings, all: Dict):
  { turn: Row | null; session: Row; prompt: string } {
  const fig = billedFig(all);
  const now = (fig.clock as Dict).now as number;
  const turns = (fig.turns as Dict[]).map(decodeTurn);
  const acc = fig.accounting as Dict;
  const plan = (fig.usage as Dict).plan;
  const [sp, wp] = [planPct(plan, "session_pct"), planPct(plan, "weekly_pct")];
  const i = receiptTurn(turns);
  const win = Math.trunc(fig.context_window as number);
  return {
    turn: i < 0 ? null : turnRow(st, turns[i],
      readAccounting((acc.turns as Dict[])[i]), win, now, sp, wp),
    session: sessionRow(st, turns, readAccounting(acc.session as Dict),
      now, sp, wp),
    prompt: i < 0 ? "" : turns[i].text,
  };
}

/** `fig` with the billed turn timed by the engine's own duration.  The
 * transcript's turn_duration record, which dur_s takes when it is there,
 * lands late, after turn.complete, so until then dur_s is the span from the
 * turn's first record to its last, short of what Claude Code's closing
 * line prints.  The seconds added are the model's: they are the
 * answer streaming after its last record, in no tool and no wait. */
export function withEngineDuration(all: Dict, durationMs: number): Dict {
  const fig = billedFig(all);
  const turns = fig.turns as Dict[];
  const i = receiptTurn(turns.map(decodeTurn));
  if (i < 0 || !(durationMs > 0)) return fig;
  const dur = durationMs / 1000;
  const gain = dur - (turns[i].dur_s as number);
  if (!(gain > 0)) return fig;
  const acc = fig.accounting as Dict;
  const accTurns = [...(acc.turns as Dict[])];
  const a = accTurns[i];
  accTurns[i] = { ...a, model_s: (a.model_s as number) + gain };
  const t = [...turns];
  t[i] = { ...turns[i], dur_s: dur };
  return { ...fig, turns: t, accounting: { ...acc, turns: accTurns } };
}

/** A share of a plan window as a figures document gives it, a number or
 * its text, or null for none. */
function pctOf(v: unknown): number | null {
  const f = pyFloat(v ?? null);
  return f === null || Number.isNaN(f) ? null : f;
}

/** The receipt's tag line, drawn as the start line is, at no indent, so the
 * two stack: "🔺🔖 8f37748e #12  💳 🔋  15٪  🪫  87٪  📅 2026-10-19  🕐
 * 13:06:02", the billed turn's tag, the account's windows as the cost
 * document read them when the receipt was stamped, `usage.plan.session_pct`
 * and `weekly_pct` (turnLine), and `clock.now`, when it was stamped; none
 * under the hide path `name.tag`. */
export function receiptHead(st: Settings, all: Dict,
  hide: readonly string[]): Span[] {
  if (tagsHidden(hide)) return [];
  const fig = billedFig(all);
  const now = (fig.clock as Dict).now as number;
  const turns = (fig.turns as Dict[]).map(decodeTurn);
  const i = receiptTurn(turns);
  const t = i < 0 ? null : turns[i];
  const plan = ((fig.usage as Dict | undefined)?.plan ?? {}) as Dict;
  return turnLine(st, E_TURN_PAST, t ? t.prompt_id : "",
    t ? t.turn_index : null, pctOf(plan.session_pct),
    pctOf(plan.weekly_pct), ymd(now), hms(now), hide);
}

/** The subagents the receipt stamps, as the band's last status document
 * has them (stampedOf): its tasks, the plan reading, its clock and when
 * the turn opened, and the main thread's last text, 🧵's in the tree. */
export type Stamped = {
  readonly agents: TreeAgents;
  readonly mainProgress: string;
};

/** What the receipt stamps of the subagents from a status document `fig`,
 * the band's last: its `agents` as the tree reads them, the turn opened at
 * `transcript.turn_s`, and `owed`, the agents an earlier receipt left out
 * while they were at work (stampedSplit); null where it has none. */
export function stampedOf(fig: Dict | null,
  owed: readonly string[] = []): Stamped | null {
  const doc = fig?.agents as Dict | undefined;
  if (!fig || !doc) return null;
  const tr = decodeTranscript(fig.transcript);
  return {
    agents: { tasks: (doc.tasks ?? []) as TreeTask[],
      limits: decodeLimits(fig.limits),
      now: (fig.clock as Dict).now as number,
      turnStart: tr.turn_s || null, owed },
    mainProgress: typeof doc.main_progress === "string"
      ? doc.main_progress : "",
  };
}

/** The receipt as drawn at `cols` under `hide`: its rows as the band's
 * tree draws them, stamped (receiptTree), on the band's fixed grid,
 * `inset` columns in (the mod's is hint-inset, where the band's rows
 * start), then the tag line (receiptHead) under them.  A hidden scope's
 * row is left out, and so is a row not `stamped` (RowName: the rows whose
 * `rows.<row>.transcript` is true), and the tag line without `tags`
 * (`rows.tag.transcript`).  `dim` draws every span dim, as the stamped
 * receipt is drawn, its colours kept.  `main` is the band's 🧵 row,
 * where the caller has it, and `agents` the subagents the turn ran. */
export function receiptLines(st: Settings, fig: Dict, cols: number,
  hide: readonly string[], dim = false, main: Row | null = null,
  stamped: readonly RowName[] = ROW_NAMES, inset = 0, tags = true,
  agents: Stamped | null = null): Span[][] {
  return receiptScoped(st, fig, cols, hide, dim, main, stamped, inset,
    tags, agents).map((l) => l.spans);
}

/** The receipt's rows as the band's tree, stamped (treeRows): 🎮 where
 * it is `kept`, as the root, and under it 🎤 where it is kept, 🏁 `turn`
 * and the prompt it bills.  Where `agents` holds an agent the turn ran,
 * 🧵 `main` stands over 🎤 whatever `kept` says, as the agents' parent,
 * with every agent the turn ran under it; else 🧵 where it is kept. */
function receiptTree(st: Settings, turn: Row | null, session: Row,
  main: Row | null, prompt: string, agents: Stamped | null,
  kept: readonly string[], hide: readonly string[]): Row[] {
  const shown = (r: Row | null): Row | null =>
    r !== null && kept.includes(r.scope) && !hidden(hide, r.scope) ? r
      : null;
  const tree = (parent: Row | null, ran: Stamped | null): Row[] =>
    treeRows(st, {
      session: shown(session),
      main: parent !== null && !hidden(hide, parent.scope) ? parent : null,
      turn: shown(turn), workspace: null,
      mainPhase: E_PHASE_END, mainInbox: 0,
      mainProgress: ran?.mainProgress ?? "",
      turnPhase: E_PHASE_DONE, turnPrompt: prompt,
      agents: ran?.agents ?? null, cap: Infinity, stamped: true,
    }, hide);
  const ran = main && agents ? tree(main, agents) : [];
  return ran.some((r) => r.scope === "agent") ? ran
    : tree(shown(main), null);
}

/** receiptLines, each line with its scope (`turn` for 🎤, `main` for 🧵,
 * `session` for 🎮, `agent` for a subagent's, `blank` and `tag` for the
 * tag line and the row above it), so a caller can tell the rows apart. */
export function receiptScoped(st: Settings, fig: Dict, cols: number,
  hide: readonly string[], dim = false, main: Row | null = null,
  stamped: readonly RowName[] = ROW_NAMES, inset = 0, tags = true,
  agents: Stamped | null = null): { scope: string; spans: Span[] }[] {
  const { turn, session, prompt } = receiptRows(st, fig);
  const rows = receiptTree(st, turn, session, main, prompt, agents,
    scopesOf(stamped), hide);
  // `inset` columns in, led by as many blanks and that much narrower, on
  // the columns laid out at `cols`, so they stack on the band's rows,
  // which start that far in and keep the same columns; the tag line stays
  // at no indent, under the prompt's.
  const lines = drawRows(st, rows, cols, hide, inset)
    .map((l, i) => ({ scope: rows[i].scope,
      spans: inset ? [span(" ".repeat(inset)), ...l] : l }));
  // A blank row before the tag line: a space, since Ink
  // measures an empty Text as no row at all.
  const head = tags ? receiptHead(st, fig, hide) : [];
  if (head.length) {
    lines.push({ scope: "blank", spans: [span(" ")] },
      { scope: "tag", spans: head });
  }
  return dim ? lines.map((l) => ({ ...l, spans: dimmed(l.spans) })) : lines;
}

/** `spans`, each drawn dim. */
export function dimmed(spans: readonly Span[]): Span[] {
  return spans.map((s) => ({ ...s, dim: true }));
}

/** Rows drawn on the band's fixed grid at `cols` under `hide`, a hidden
 * scope's left out, each `inset` columns narrower on the columns laid out
 * at `cols`, as the band's rows under the footer line are. */
export function drawRows(st: Settings, rows: readonly Row[], cols: number,
  hide: readonly string[], inset = 0): Span[][] {
  const keys = fixedKeys(st, cols, hide);
  return rows.filter((r) => !hidden(hide, r.scope))
    .map((r) => draw(st, r, keys, cols - inset, hide));
}

/** Whether `hide` hides the turn's tag lines, the start line's 🔻🔖 and
 * the receipt's 🔺🔖, with the blank rows that set them apart: the hide
 * path `name.tag`. */
export function tagsHidden(hide: readonly string[]): boolean {
  return hidden(hide, "name.tag");
}

/** The line under the prompt as its turn starts, dim, from a status
 * document: 🔻🔖, the tag of the turn opened last, `transcript.prompt_id`
 * and `turn_index`, the account's windows as the document read them,
 * `limits.session_pct` and `weekly_pct` (turnLine), where it has them, and
 * when its prompt was stamped, `transcript.turn_s`; nothing with neither a
 * tag nor a stamp, or under the hide path `name.tag` (startTag draws it
 * whatever that path says). */
export function startLine(st: Settings, fig: Dict,
  hide: readonly string[] = []): Span[] {
  return tagsHidden(hide) ? [] : startTag(st, fig, hide);
}

/** startLine, drawn under the hide path `name.tag` too: the mod files it
 * as the turn starts and asks the options again as it draws it. */
export function startTag(st: Settings, fig: Dict,
  hide: readonly string[] = []): Span[] {
  const tr = decodeTranscript(fig.transcript);
  const lim = decodeLimits(fig.limits);
  const at = tr.turn_s || null;
  return dimmed(turnLine(st, E_TURN_AHEAD, tr.prompt_id, tr.turn_index,
    pctOf(lim.session_pct), pctOf(lim.weekly_pct),
    at === null ? null : ymd(at), at === null ? null : hms(at), hide));
}

/** What the engine draws to close the turn that took `durationMs`.
 * `hidden`: whether it leaves its closing line out of the transcript, so
 * the receipt has no TurnDuration to draw under; `answer`: the turn's last
 * text block, the AssistantMessage drawn last before that line ("" with
 * none).  null while `records` hold no turn_duration of that duration.
 *
 * Claude Code drops a turn_duration whose pending background agents or
 * dynamic workflows are more than none and as many as the previous
 * turn_duration's, with no prompt the person sent in between: the line
 * would only say again `Waiting for 1 background agent to finish`.  So a
 * turn a task notification or an agent's hand-back opens while an agent
 * still runs ends with no closing line.  It drops none with a token
 * budget or messages hidden by /focus, and none in the ctrl+o transcript
 * or under --verbose.  A prompt the person sent is a user record that is
 * no meta, tool result or compact summary, of no origin or a human one,
 * or a queued_command of theirs.  `records` are read in order, the counts
 * starting at none where they start. */
export function closingLine(records: readonly unknown[], durationMs: number):
  { hidden: boolean; answer: string } | null {
  let agents = 0;
  let flows = 0;
  let answer = "";
  let found: { hidden: boolean; answer: string } | null = null;
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (r.isSidechain === true) continue;
    if (r.type === "system" && r.subtype === "turn_duration") {
      const a = Number(r.pendingBackgroundAgentCount) || 0;
      const f = Number(r.pendingWorkflowCount) || 0;
      const hidden = (a > 0 || f > 0) && a === agents && f === flows &&
        r.budgetLimit === undefined && !Number(r.briefHiddenCount);
      agents = a;
      flows = f;
      if (r.durationMs === durationMs) found = { hidden, answer };
      answer = "";
    } else if (r.type === "user") {
      if (sentByPerson(r)) [agents, flows] = [0, 0];
    } else if (r.type === "attachment") {
      const at = r.attachment as Record<string, unknown> | undefined;
      if (at?.type === "queued_command" && at.isMeta !== true &&
        humanOrigin(at.origin ?? (at.commandMode === "task-notification"
          ? { kind: "task-notification" } : undefined))) {
        [agents, flows] = [0, 0];
      }
    } else if (r.type === "assistant") {
      const content = (r.message as Record<string, unknown> | undefined)
        ?.content;
      if (typeof content === "string" && content.trim()) answer = content;
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type === "text" && typeof b.text === "string" &&
          b.text.trim()) answer = b.text;
      }
    }
  }
  return found;
}

/** Whether a user record is a prompt the person sent, as the engine tells
 * one when it counts closing lines (closingLine). */
function sentByPerson(r: Record<string, unknown>): boolean {
  return r.isMeta !== true && r.toolUseResult === undefined &&
    r.isCompactSummary !== true && humanOrigin(r.origin);
}

/** Whether an origin is the person's: none, or `human`. */
function humanOrigin(origin: unknown): boolean {
  return origin === undefined || origin === null ||
    (typeof origin === "object" &&
      (origin as Record<string, unknown>).kind === "human");
}

/** An answer's text as its AssistantMessage row and its record are
 * matched: each run of whitespace one space, trimmed. */
export function answerText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

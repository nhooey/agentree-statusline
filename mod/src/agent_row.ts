// An agent's row on the band's tree: its state, its cells and its label,
// and the tree's shape over the prepared tasks.
//
// Preparation (sidecar lookup, usage parsing, limits and source selection)
// is subagent_tasks.ts's; this lays out the facts it is handed, and
// band_tree.ts hangs the rows on the tree.  The cells themselves are
// cells.ts's.
//
// A usage here is any value, read through `ua`: an own key's value, null
// included, else the default.  So a usage that is null, or holds only
// some fields, reads as one with the defaults.
import {
  E_GIT_OK, E_MODE_AGENTS, E_MODE_API_ERROR, E_MODE_DONE, E_MODE_ETA,
  E_MODE_FAILED, E_MODE_HELD, E_MODE_KILLED, E_MODE_MONITOR, E_MODE_QUEUED,
  E_MODE_SHELL, E_PHASE_END, E_PHASE_PAUSE, E_PHASE_RUN, E_TOOL, E_WAIT,
  E_WORK, MAG_SHARE_AGENT, QUIET_S, QUIET_WARN_S,
} from "./spec.ts";
import { durFmt, grade, padVal, seg, visWidth } from "./formatting.ts";
import type { Settings } from "./formatting.ts";
import { ink, paint, span, spans } from "./spans.ts";
import type { Span, SpanLike } from "./spans.ts";
import { isDict, pyGet, pyOr, pySlice, pyTruthy } from "./py.ts";
import type { Dict } from "./py.ts";
import { pyFloat, pyStr } from "./sources.ts";
import { WAITING_TOOLS, etaFinish, squash } from "./claude_records.ts";
import type { Limits } from "./claude_sources.ts";
import {
  A_RATE_W, CELLS, inheritEta, renderBackground, renderCompactions,
  renderInbox, renderKids, renderKind,
} from "./cells.ts";
import type { Piece } from "./grid.ts";

export const A_STATE_W = 2, A_TICK_S = 5.0;
// The 🤖 state trades its rate for how long the agent has been quiet; see
// renderDoing.
export const A_SILENT_S = QUIET_S, A_SILENT_WARN_S = QUIET_WARN_S;
// The blanks between the label's name, branch and activity.
export const A_LABEL_GAP = 2;

export const END_MARK: ReadonlyMap<string, string> = new Map([
  ["completed", E_MODE_DONE], ["failed", E_MODE_FAILED],
  ["killed", E_MODE_KILLED]]);
export const PAUSE_MARK: ReadonlyMap<string, string> = new Map([
  ["bash", E_MODE_SHELL], ["monitor", E_MODE_MONITOR]]);

// ════════════════════════════════════════════════════════════════════════════
// Reading the prepared records.
// ════════════════════════════════════════════════════════════════════════════

/** An ETA as the records carry it: [] for none yet, [epoch, seconds left]
 * off the last report, null for no transcript to report in. */
export type Eta = readonly number[] | null;

/** One prepared task: (task, usage, meta, shares), each as the caller
 * handed it, so a field of the wrong shape reads as the cases pin. */
export type Prepared = readonly [unknown, unknown, unknown, unknown];

/** A usage's field `k`, or `dflt`: see the header. */
export function ua(u: unknown, k: string, dflt: unknown = null): unknown {
  return pyGet(u, k, dflt);
}

/** A list field, empty for missing or false. */
function uaList(u: unknown, k: string): readonly any[] {
  const v = ua(u, k, []);
  return pyTruthy(v) ? (v as readonly any[]) : [];
}

/** `v` as a string, "" for a missing or false value. */
export function strOr(v: unknown): string {
  return pyTruthy(v) ? pyStr(v) : "";
}

/** A startTime in milliseconds as seconds, or null where pyFloat reads
 * none. */
function msToS(v: unknown): number | null {
  const f = v === null || v === undefined ? null : pyFloat(v);
  return f === null ? null : f / 1000.0;
}

/** The task dicts that draw a row: a dict with a true id. */
export function hasId(t: unknown): t is Dict {
  return isDict(t) && pyTruthy(t.id);
}

/** The largest of xs, the first of equals; xs not empty. */
export function firstMax(xs: readonly number[]): number {
  let m = xs[0];
  for (const x of xs.slice(1)) if (x > m) m = x;
  return m;
}

/** The smallest of xs, the first of equals; xs not empty. */
function firstMin(xs: readonly number[]): number {
  let m = xs[0];
  for (const x of xs.slice(1)) if (x < m) m = x;
  return m;
}

// ════════════════════════════════════════════════════════════════════════════
// The row's state.
// ════════════════════════════════════════════════════════════════════════════

/** Tokens a second over the task's samples, A_TICK_S apart; null unless
 * running with two samples pyFloat reads. */
export function tokenRate(samples: unknown, status: string): number | null {
  if (status !== "running" || !Array.isArray(samples) || samples.length < 2) {
    return null;
  }
  const first = pyFloat(samples[0]), last = pyFloat(samples.at(-1));
  if (first === null || last === null) return null;
  return Math.max(0.0, last - first) / (A_TICK_S * (samples.length - 1));
}

/** The row's two state marks, (phase, mode), at `now`, else at the
 * clock. */
export function agentState(status: string, usage: unknown = null,
  waitingOn = false, now: number | null = null): [string, string] {
  if (status === "running") {
    const names = uaList(usage, "pending").map((p) => p[1]);
    const mode = ua(usage, "eta") === null ? ""
      : names.some((n) => WAITING_TOOLS.has(n)) ? E_WAIT
      : names.length ? E_TOOL : E_WORK;
    return [E_PHASE_RUN, mode];
  }
  if (status === "pending") return [E_PHASE_PAUSE, E_MODE_QUEUED];
  const eta = ua(usage, "eta") as Eta;
  const bg = ua(usage, "background", []);
  const t = now === null ? Date.now() / 1000 : now;
  if (pyTruthy(ua(usage, "api_error", false)) &&
    (status === "completed" || status === "failed")) {
    // Claude Code calls an agent whose last request failed for good
    // completed; the mark says why it stopped.
    return [parked(status, eta, t, waitingOn, bg) ? E_PHASE_PAUSE
      : E_PHASE_END, E_MODE_API_ERROR];
  }
  if (parked(status, eta, t, waitingOn, bg)) {
    const kinds = uaList(usage, "background").map((b) => b[1]);
    const woke = (["bash", "monitor"] as const).find((k) => kinds.includes(k));
    return [E_PHASE_PAUSE, waitingOn ? E_MODE_AGENTS
      : woke !== undefined ? PAUSE_MARK.get(woke)!
      : status === "waiting" ? E_MODE_HELD : E_MODE_ETA];
  }
  const end = END_MARK.get(status);
  if (end !== undefined) return [E_PHASE_END, end];
  return status ? [pySlice(status, null, 2), ""] : ["", ""];
}

const PHASES: readonly string[] = [E_PHASE_RUN, E_PHASE_PAUSE, E_PHASE_END,
  ""];

/** The phase circle and the mode mark after it; see agentState. */
export function renderState(status: string, usage: unknown = null,
  waitingOn = false, now: number | null = null): Span[] {
  const [phase, mode] = agentState(status, usage, waitingOn, now);
  return spans([phaseSpan(phase), mode]);
}

/** The phase circle alone: the mode is the Doing cell's; see renderDoing. */
export function renderPhase(status: string, usage: unknown = null,
  waitingOn = false, now: number | null = null): Span[] {
  return spans(phaseSpan(agentState(status, usage, waitingOn, now)[0]));
}

/** The phase circle, or a status never seen in amber. */
function phaseSpan(phase: string): Span {
  return span(phase, PHASES.includes(phase) ? null : "F_AMB");
}

/** How many background tasks of `kind` the agent has not heard the end
 * of; 0 once it failed or was killed, whose tasks stop with it. */
export function backgroundCount(status: string, usage: unknown,
  kind: string): number {
  if (status === "failed" || status === "killed") return 0;
  return uaList(usage, "background").filter((b) => b[1] === kind).length;
}

/** Seconds from the earlier of `first` and startTime to now, or to `end`;
 * null with neither start. */
export function agentElapsed(startMs: unknown, now: number | null,
  end: number | null = null, first: number | null = null): number | null {
  const starts = first === null ? [] : [first];
  const s = msToS(startMs);
  if (s !== null) starts.push(s);
  if (!starts.length) return null;
  const t0 = firstMin(starts);
  let t = now === null ? Date.now() / 1000 : now;
  if (end !== null) t = Math.min(t, Math.max(end, t0));
  return Math.max(0.0, t - t0);
}

/** Whether a task is only waiting at `now`: one `$.agent.list()` calls
 * waiting, or one Claude Code calls completed with an agent under it, a
 * background task it started, or an ETA with time left at `now`.  The
 * ETA holds it only until the report's epoch plus the seconds it said
 * were left; past that, it has finished.  A report of 0s is the skill's
 * sign-off, and liveEta reads a SubagentHandback call as one: an agent
 * that has handed back, and has not been resumed since, has finished. */
export function parked(status: string, eta: unknown, now: number,
  waitingOn = false, background: unknown = []): boolean {
  return status === "waiting" || (status === "completed" &&
    (etaLeft(eta, now) || waitingOn || pyTruthy(background)));
}

/** Whether `eta`, a report as (epoch, seconds left), has time left at
 * `now`: some was left at the report, and its epoch plus that is later
 * than `now`. */
function etaLeft(eta: unknown, now: number): boolean {
  if (!Array.isArray(eta) || eta.length < 2) return false;
  const at = Number(eta[0]), left = Number(eta[1]);
  return left > 0 && at + left > now;
}

/** The ids with an agent running or not yet started anywhere under them. */
export function runningParents(prepared: readonly Prepared[]): Set<string> {
  const parent = new Map<string, string>();
  for (const [t, , m] of prepared) {
    if (hasId(t)) {
      parent.set(pyStr(t.id), strOr(pyGet(pyOr(m, {}), "parentAgentId")));
    }
  }
  const out = new Set<string>();
  for (const [t] of prepared) {
    if (hasId(t) && (t.status === "running" || t.status === "pending")) {
      let up = parent.get(pyStr(t.id)) ?? "";
      const seen = new Set<string>();
      while (up && !seen.has(up)) {
        seen.add(up);
        out.add(up);
        up = parent.get(up) ?? "";
      }
    }
  }
  return out;
}

/** The epoch the agent entered the state `mode` names, or null. */
export function stateSince(status: string, usage: unknown, phase: string,
  mode: string, task: unknown = null): number | null {
  const pending = uaList(usage, "pending");
  if (status === "running") {
    let starts: unknown[];
    if (mode === E_WAIT) {
      starts = pending.filter((p) => WAITING_TOOLS.has(p[1])).map((p) => p[0]);
    } else if (mode === E_TOOL) {
      starts = pending.filter((p) => !WAITING_TOOLS.has(p[1]))
        .map((p) => p[0]);
    } else if (mode === E_WORK) {
      starts = [ua(usage, "last_seen")];
    } else {
      starts = [];
    }
    const got = starts.filter((t): t is number => t !== null &&
      t !== undefined);
    return got.length ? firstMin(got) : null;
  }
  if (status === "pending") return msToS(pyGet(pyOr(task, {}), "startTime"));
  if (phase === E_PHASE_PAUSE || phase === E_PHASE_END) {
    return pyOr(ua(usage, "last_seen"), ua(usage, "last_epoch")) as
      number | null;
  }
  return null;
}

/** What the agent is doing, and for how long: the mode mark, then the
 * time since stateSince, or 🤖's rate while its records keep landing. */
export function renderDoing(st: Settings, status: string, usage: unknown,
  waitingOn = false, rate: number | null = null, now: number | null = null,
  task: unknown = null): Span[] {
  const t = now === null ? Date.now() / 1000 : now;
  const [phase, mode] = agentState(status, usage, waitingOn, t);
  if (!mode) return CELLS.rate(st, rate);
  const since = stateSince(status, usage, phase, mode, task);
  const secs = since === null ? null : Math.max(0.0, t - since);
  const figW = A_RATE_W - visWidth(mode, st.widths) - 1;
  if (mode === E_WORK && status === "running" && rate !== null &&
    (secs === null || secs < A_SILENT_S)) {
    return CELLS.rate(st, rate, mode);
  }
  if (secs === null) return [span(mode)];
  const fig = durFmt(st, secs);
  const style = mode === E_WORK && secs >= A_SILENT_WARN_S ? ink("F_AMB")
    : grade("duration", "F_PRW", fig, st.colourMode);
  return [span(mode + " "), paint(style, padVal(st, figW, fig))];
}

// ════════════════════════════════════════════════════════════════════════════
// The tree.
// ════════════════════════════════════════════════════════════════════════════

/** Each task's ETA, pushed out to the latest finish below it on the
 * tree. */
export function inheritedEtas(prepared: readonly Prepared[]):
  Map<string, Eta> {
  const rows = new Map<string, [Dict, unknown, unknown]>();
  for (const [t, u, m] of prepared) {
    if (hasId(t)) rows.set(pyStr(t.id), [t, u, pyOr(m, {})]);
  }
  const kids = new Map<string, string[]>();
  for (const [tid, [, , m]] of rows) {
    const p = strOr(pyGet(m, "parentAgentId"));
    if (rows.has(p)) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p)!.push(tid);
    }
  }
  const memo = new Map<string, number | null>();
  const finish = (tid: string,
    seen: readonly string[] = []): number | null => {
    if (memo.has(tid)) return memo.get(tid)!;
    const [t, u] = rows.get(tid)!;
    const st = strOr(t.status);
    const own = st !== "killed" && st !== "failed"
      ? etaFinish((pyOr(ua(u, "eta"), []) as readonly number[])) : null;
    const ends = [own, ...(kids.get(tid) ?? [])
      .filter((k) => !seen.includes(k))
      .map((k) => finish(k, [...seen, tid]))]
      .filter((e): e is number => e !== null);
    const got = ends.length ? firstMax(ends) : null;
    memo.set(tid, got);
    return got;
  };
  const out = new Map<string, Eta>();
  for (const [tid, [t, u]] of rows) {
    const start = msToS(t.startTime);
    out.set(tid, inheritEta(ua(u, "eta") as Eta,
      (kids.get(tid) ?? []).map((k) => finish(k)), start));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// The row.
// ════════════════════════════════════════════════════════════════════════════

/** The widest 📨, 🤏, 💻 and 📡 cells over the rows, each 0 where no row
 * draws one, so a count any row needs keeps its column on every row. */
export type PanelWidths = {
  readonly inbox: number;
  readonly compact: number;
  readonly shells: number;
  readonly monitors: number;
};

/** The row's figures by GRID_CELLS key, each only where it has one. */
export function agentCells(st: Settings, task: Dict, usage: unknown,
  meta: unknown, shares: unknown, limits: Limits, now: number | null = null,
  eta: Eta | false = false, waitingOn = false): { [key: string]: Span[] } {
  const status = strOr(task.status);
  const model = pyOr(pyOr(strOr(task.model), ua(usage, "model", "")),
    strOr(pyGet(meta, "model"))) as string;
  const week = pyGet(shares, "week");
  const light = week !== null && (week as number) < MAG_SHARE_AGENT;
  const billed = pyTruthy(ua(usage, "parts", []));
  const ownEta = ua(usage, "eta") as Eta;
  const t = now === null ? Date.now() / 1000 : now;
  const live = status === "running" ||
    parked(status, ownEta, t, waitingOn, ua(usage, "background", []));
  // A finished row stops at its last billed stamp, else at its last
  // working span; with neither, ⌛ is blank.
  const work = uaList(usage, "work");
  const end = live ? null : (pyOr(ua(usage, "last_epoch"),
    work.length ? firstMax(work.map((w) => w[1])) : null) as number | null);
  const clocked = live || end !== null;
  // Where its transcript starts: its first working span, or the one still
  // open when it has closed none.
  const firsts: number[] = work.slice(0, 1).map((w) => w[0]);
  const openAt = ua(usage, "open_at");
  if (openAt !== null) firsts.push(openAt as number);
  const first = firsts.length ? firstMin(firsts) : null;
  const shownEta = eta === false ? ownEta : eta;
  // Signed off: its own last report is zero and no descendant pushed the
  // finish past it.
  const signedOff = pyTruthy(ownEta) && ownEta![1] === 0 &&
    pyTruthy(shownEta) &&
    etaFinish(shownEta!)! <= etaFinish(ownEta!)! + 1e-6;
  // An agent that has ended has its ⛳ read at its end, as its ⌛ is; one
  // that signed off at zero draws none.
  const etaNow = end === null ? now : Math.min(t, end);
  const etaCell = !live && signedOff ? [] : CELLS.eta(st, shownEta,
    task.startTime, etaNow, status,
    ua(usage, "last_epoch") as number | null, signedOff);
  const elapsed = clocked ? agentElapsed(task.startTime, now, end, first)
    : null;
  const cells: [string, SpanLike][] = [
    // The model and effort, right before the 💰 they priced.
    ["model", CELLS.model(st, model,
      pyOr(strOr(task.effort), ua(usage, "effort", "")) as string)],
    // What it is doing and for how long, or its token rate.
    ["rate", renderDoing(st, status, usage, waitingOn,
      tokenRate(task.tokenSamples, status), now, task)],
    ["cost", billed
      ? CELLS.cost(st, ua(usage, "cost", 0) as number) : []],
    ["ctx", CELLS.ctx(st, ua(usage, "ctx_tokens", 0) as number,
      ua(usage, "ctx_window", 0) as number)],
    ["tok", CELLS.tok(st, ua(usage, "tok_up"), ua(usage, "tok_down", 0))],
    ["cache", CELLS.cache(st, ua(usage, "cache_pct", -1))],
    // ⌛ ⛳ 🤖 🔧 🚦, right before the 5h and 1w it spent.
    ["clock", CELLS.clock(st, elapsed)],
    ["eta", etaCell],
    ["split", CELLS.split(st, elapsed,
      ua(usage, "model_s") as number | null,
      ua(usage, "tool_s", 0.0) as number | null)],
    ["five", CELLS.five(st, limits.session_pct,
      pyGet(shares, "sess") as number | null, billed, light)],
    ["week", CELLS.week(st, limits.weekly_pct,
      week as number | null, billed, light)],
    ["diff", billed ? CELLS.diff(st, ua(usage, "lines_added", 0),
      ua(usage, "lines_removed", 0)) : []],
  ];
  const out: { [key: string]: Span[] } = {};
  for (const [k, v] of cells) {
    const s = spans(v);
    if (s.length) out[k] = s;
  }
  return out;
}

/** The row's label as grid pieces under the agent scope: the kind, the
 * counts, the name, the branch and the activity.  Each count is drawn at
 * its width in `widths0` (or `kidsW` for 👶🏻), and not at all at 0;
 * `packed` draws only the row's own counts, each at its own width, as the
 * band's tree does, where depth already moves each name.  The phase is
 * the one at `now`, else at the clock. */
export function agentLabel(st: Settings, task: Dict, usage: unknown,
  meta: unknown, waitingOn = false, kids = 0, kidsW = 0,
  widths0: PanelWidths | null = null, packed = false,
  now: number | null = null): Piece[] {
  const widths: Partial<PanelWidths> = widths0 ?? {};
  const status = strOr(task.status), kind = strOr(task.type);
  const head = spans([renderKind(strOr(pyGet(meta, "agentType")), kind),
    seg(st, A_STATE_W, renderPhase(status, usage, waitingOn, now)), " "]);
  const out: Piece[] = [{ path: "name.kind", spans: head, drop: 0 }];
  const counts: [string, number, Span[]][] = [
    ["state.kids", kidsW, renderKids(kids)],
    ["state.compact", widths.compact ?? 0,
      renderCompactions(ua(usage, "compactions", 0) as number)],
    ["state.shells", widths.shells ?? 0, renderBackground(E_MODE_SHELL,
      backgroundCount(status, usage, "bash"))],
    ["state.monitors", widths.monitors ?? 0, renderBackground(E_MODE_MONITOR,
      backgroundCount(status, usage, "monitor"))],
    ["state.inbox", widths.inbox ?? 0,
      renderInbox(ua(usage, "inbox", 0) as number)],
  ];
  for (const [path, w, cell] of counts) {
    if (packed) {
      if (cell.length) out.push({ path, spans: [...cell, span(" ")], drop: 0 });
    } else if (w) {
      out.push({ path, spans: [...seg(st, w, cell), span(" ")], drop: 0 });
    }
  }
  const desc = squash(strOr(task.description));
  const name = strOr(task.name) || desc;
  let act = squash(strOr(task.label));
  if (act === desc) act = "";
  const branch = strOr(ua(usage, "branch", ""));
  const words = ([
    ["name.label", name, "F_BLU"],
    ["workspace.branch",
      branch ? E_GIT_OK + branch : "", "F_GRN"],
    ["chat.doing", act, "F_CHAT_B"],
  ] as const).filter(([, t]) => t);
  words.forEach(([path, text, colour], i) => {
    const gap = i < words.length - 1 ? [span(" ".repeat(A_LABEL_GAP))] : [];
    out.push({ path, spans: [span(text, colour), ...gap], drop: 0 });
  });
  return out;
}

// The subagents' facts the band's tree draws, from what the plugin reads: each
// agent's entry in `$.agent.list()`, its `.meta.json` sidecar and the fold
// of its transcript (claude_records.ts's AgentFold), worked out as the
// tree's prepared tasks (agent_row.ts's Prepared):
// (task, usage, meta, shares), each task built from the agent list and the
// fold.
//
// Pure: the reads are the hooks' (hooks/subagents.ts), and `now` comes in.
import {
  W_CACHE_READ, W_CACHE_WRITE, _usd, closeAgentSpan, ETA_LINE,
  backgroundTasks, endedTasks, openToolSpans, threadClock,
} from "./claude_records.ts";
import type { AgentFold, BgTask, Span } from "./claude_records.ts";
import { _naiveTimestamp, _windowStarts } from "./claude_calib.ts";
import type { Calib, Snapshot } from "./claude_calib.ts";
import { isDict, pyGet, pyTruthy } from "./py.ts";
import type { Dict } from "./py.ts";
import type { Prepared } from "./agent_row.ts";

/** sum() of floats, left to right. */
function addUp(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** What an agent's fold comes to, as agentUsageOf reads it: its usage
 * deduped on requestId, first wins, summed and priced per record, and its
 * clock's spans as they stand, the open one closed on a copy so the fold
 * can go on.  The fields are AgentUsage's, the renderer reading them by
 * name; `inbox`, `ctx_window` and `branch` are the caller's, and
 * `model_s` and `tool_s` agentClock's. */
export function agentUsageOf(fold: AgentFold): Dict {
  const etaState = fold.etaState;
  const eta = etaState[1] ? [] : etaState[0].slice();
  // The open span runs on to now only while the model has the floor: a
  // tool still waiting on its result is tool time instead.
  const openAt = fold.pending.size ? null : fold.spanState[0];
  const work: Span[] = fold.work.slice();
  closeAgentSpan([fold.spanState[0], fold.spanState[1]], work);
  const seen = new Set<unknown>();
  let fresh = 0, cwrite = 0, cread = 0, down = 0, ctx = 0;
  const parts: [number | null, number][] = [];
  let model = "";
  let last: number | null = null;
  for (const [epoch, , m, f, cw, cr, o, k] of fold.recs) {
    if (seen.has(k)) continue;
    seen.add(k);
    if (!(f || cw || cr || o)) continue;
    fresh += f;
    cwrite += cw;
    cread += cr;
    down += o;
    if (f + cw + cr) ctx = f + cw + cr;
    const usd = addUp(_usd(m, f, cw, cr, o));
    parts.push([epoch, usd]);
    last = epoch !== null ? epoch : last;
    model = (typeof m === "string" && m) ? m : model;
  }
  const inAll = fresh + cwrite + cread;
  const signals: Dict = {
    eta, work, open_at: openAt, tools: fold.tools.slice(),
    waiting: fold.waiting.slice(),
    pending: [...fold.pending.values()].map(([t, n]) => [t, n]),
    background: [...fold.background.entries()],
    compactions: fold.compactions, last_seen: fold.lastSeen,
    api_error: fold.apiError, cwd: fold.cwd, blocks: fold.blocks,
    model_s: null, tool_s: 0.0, inbox: 0, ctx_window: 0, branch: "",
  };
  if (!parts.length) {
    return { tok_up: null, tok_down: 0, cache_pct: -1, ctx_tokens: 0,
      cost: 0.0, parts: [], model: "", effort: "", calls: 0,
      last_epoch: null, lines_added: 0, lines_removed: 0, ...signals };
  }
  return {
    tok_up: Math.trunc(fresh + W_CACHE_WRITE * cwrite + W_CACHE_READ * cread),
    tok_down: down,
    cache_pct: inAll > 0 ? Math.trunc(100 * cread / inAll) : -1,
    ctx_tokens: ctx, cost: addUp(parts.map(([, c]) => c)), parts, model,
    effort: typeof fold.effort === "string" ? fold.effort : "",
    calls: parts.length, last_epoch: last,
    lines_added: addUp(fold.recs.map((r) => r[9])) + fold.added,
    lines_removed: addUp(fold.recs.map((r) => r[10])) + fold.removed,
    ...signals,
  };
}

/** The agent's 🤖 and 🔧 seconds off its own transcript, as agentClock
 * reads them: a running agent's open span and every tool call still
 * waiting on its result run on to `now`; a finished one's stop where its
 * file does. */
export function agentClock(usage: Dict, running: boolean, now: number):
  [number, number] {
  const work = (usage.work as Span[]).slice();
  const tools = (usage.tools as Span[]).slice();
  const waiting = (usage.waiting as Span[]).slice();
  if (running) {
    if (usage.open_at !== null) work.push([usage.open_at as number, now]);
    const pending = new Map((usage.pending as [number, string][])
      .map((p, i) => [String(i), p] as const));
    openToolSpans(pending, now, tools, waiting);
  }
  const [busy, tool, wait] = threadClock(work, tools, waiting);
  return [Math.max(0.0, busy - tool - wait), tool];
}

/** The agent's share of each plan window, in percent: what it billed
 * since the window opened over the calibrated dollars a percent; null for
 * a window with no calibration, or an agent that billed nothing. */
export function agentShares(usage: Dict, calib: Calib | null,
  snap: Snapshot | null): { sess: number | null; week: number | null } {
  const out: { sess: number | null; week: number | null } =
    { sess: null, week: null };
  const parts = usage.parts as [number | null, number][];
  if (!parts.length || calib === null || snap === null) return out;
  const [ss, ws] = _windowStarts(snap);
  for (const [key, start] of [["sess", ss], ["week", ws]] as const) {
    const unit = pyGet(calib, key);
    if (!pyTruthy(unit) || typeof unit !== "number") continue;
    const edge = start !== null ? _naiveTimestamp(start) : null;
    out[key] = addUp(parts.filter(([e]) => edge === null || e === null ||
      e >= edge).map(([, c]) => c)) / unit;
  }
  return out;
}

/** An agent as `$.agent.list()` gives it, in the part read here. */
export type ListedAgent = {
  readonly id: string;
  readonly description?: string;
  readonly type?: string;
  readonly status?: string;
  readonly parentId?: string;
  readonly name?: string;
  readonly teammateId?: string;
};

/** The renderer's status for `$.agent.list()`'s AgentStatus: `waiting`
 * stays waiting, an agent that ended its turn on background work it owns,
 * a plan's approval or an Agent call, which the renderer draws paused
 * (parked); an idle teammate has finished its turn. */
export function taskStatus(status: string | undefined): string {
  if (status === "idle") return "completed";
  return status ?? "completed";
}

/** One agent the band's tree may draw: its entry in the agent list (none
 * for an agent the list has let go, whose sidecar alone is left), its
 * sidecar's JSON (null for none), the fold of its transcript (null for
 * none), how many messages wait in its inbox, the branch of a worktree it
 * works in apart from the session's, and its latest progress update. */
export type AgentInput = {
  readonly id: string;
  readonly listed: ListedAgent | null;
  readonly meta: Dict | null;
  readonly fold: AgentFold | null;
  readonly inbox: number;
  readonly branch: string;
  readonly progress: string;
};

/** The agents of `agents` whose inbox is counted, each by its id to its
 * file, `pathOf(id)`, and the earliest any of them started, in epoch
 * seconds (null for none): preparedOf's targets and firsts.  A
 * killed or failed agent's inbox is dropped with it, and one with no file
 * has none. */
export function inboxTargets(
  agents: readonly Pick<AgentInput, "id" | "listed" | "fold">[],
  pathOf: (id: string) => string): [Map<string, string>, number | null] {
  const targets = new Map<string, string>();
  const firsts: number[] = [];
  for (const a of agents) {
    const status = a.listed ? taskStatus(a.listed.status) : "completed";
    const path = pathOf(a.id);
    if (!path || status === "killed" || status === "failed") continue;
    targets.set(a.id, path);
    // Its first span, open or closed, or its last record: taskOf's start.
    const f = a.fold;
    const starts = f === null ? [] : [f.work[0]?.[0], f.spanState[0],
      f.lastSeen].filter((t): t is number => typeof t === "number");
    if (starts.length) firsts.push(Math.min(...starts));
  }
  return [targets, firsts.length ? Math.min(...firsts) : null];
}

/** One prepared task, its latest progress update and the background
 * shells and Monitors it has open, in the order they opened (none where
 * absent), and the ones it last closed, each with its end, in the order
 * they closed (none where absent), as the band's document carries them
 * (`agents.tasks`). */
export type TreeTask = {
  readonly task: Dict;
  readonly usage: Dict;
  readonly meta: Dict;
  readonly shares: { sess: number | null; week: number | null };
  readonly progress: string;
  readonly bgTasks?: readonly BgTask[];
  readonly bgEnded?: readonly BgTask[];
};

/** The task the renderer reads, from the agent list and the fold: its id,
 * name, kind (`in_process_teammate` for a teammate, else `local_agent`),
 * status (an agent the list no longer has is completed), description,
 * start (its transcript's first span, in ms), model and effort.  `label`,
 * Claude Code's activity, is left empty: the tree draws the agent's
 * progress update in its place. */
function taskOf(a: AgentInput, usage: Dict | null): Dict {
  const meta = a.meta ?? {};
  const starts: number[] = [];
  if (usage !== null) {
    const work = usage.work as Span[];
    if (work.length) starts.push(work[0][0]);
    for (const k of ["open_at", "last_seen"]) {
      if (typeof usage[k] === "number") starts.push(usage[k] as number);
    }
  }
  const str = (v: unknown): string => typeof v === "string" ? v : "";
  return {
    id: a.id,
    name: str(a.listed?.name) || str(meta.name),
    type: a.listed?.teammateId ? "in_process_teammate" : "local_agent",
    status: a.listed ? taskStatus(a.listed.status) : "completed",
    description: str(a.listed?.description) || str(meta.description),
    label: "",
    startTime: starts.length ? Math.min(...starts) * 1000 : null,
    model: usage !== null ? str(usage.model) : "",
    effort: usage !== null ? str(usage.effort) : "",
    tokenSamples: [],
  };
}

/** The prepared tasks of `agents`, as preparedOf hands them
 * to the renderer, each with its progress update: the usage off its fold,
 * its clock run on to `now` while it runs, the window `windowOf` gives
 * its model, its inbox and branch, its shares of the plan windows; the
 * sidecar with the list's type and parent where the sidecar has none. */
export function treeTasks(agents: readonly AgentInput[], now: number,
  windowOf: (model: string) => number, calib: Calib | null,
  snap: Snapshot | null): TreeTask[] {
  return agents.map((a) => {
    let usage = a.fold ? agentUsageOf(a.fold) : null;
    const task = taskOf(a, usage);
    if (usage !== null) {
      const [modelS, toolS] = agentClock(usage, task.status === "running",
        now);
      usage = { ...usage, model_s: modelS, tool_s: toolS };
    }
    const filled: Dict = { ...(usage ?? NO_USAGE), inbox: a.inbox,
      ctx_window: usage !== null ? windowOf(String(usage.model)) : 0,
      branch: a.branch };
    const meta: Dict = { ...(a.meta ?? {}) };
    if (typeof meta.agentType !== "string" && a.listed?.type) {
      meta.agentType = a.listed.type;
    }
    if (!meta.parentAgentId && a.listed?.parentId) {
      meta.parentAgentId = a.listed.parentId;
    }
    const gone = endedTasks(a.fold?.bgEnded);
    return { task, usage: filled, meta,
      shares: agentShares(filled, calib, snap), progress: a.progress,
      bgTasks: a.fold ? backgroundTasks(a.fold.background, a.fold.bgInfo)
        : [], ...gone.length ? { bgEnded: gone } : {} };
  });
}

/** NO_AGENT_USAGE: a task with no transcript, a teammate in a pane of its
 * own or an agent whose file has not been read yet.  `eta` null: there is
 * no transcript to report in. */
const NO_USAGE: Dict = {
  tok_up: null, tok_down: 0, cache_pct: -1, ctx_tokens: 0, cost: 0.0,
  parts: [], model: "", effort: "", calls: 0, last_epoch: null,
  lines_added: 0, lines_removed: 0, tool_s: 0.0, eta: null, work: [],
  open_at: null, tools: [], model_s: null, waiting: [], pending: [],
  background: [], compactions: 0, last_seen: null, api_error: false,
  cwd: "", blocks: 0, inbox: 0, ctx_window: 0, branch: "",
};

/** The renderer's prepared tuples of `tasks`. */
export function preparedOf(tasks: readonly TreeTask[]): Prepared[] {
  return tasks.map((t) => [t.task, t.usage, t.meta, t.shares] as const);
}

/** A thread's latest progress update off `tail`, the last bytes of its
 * transcript (its first line left out where `cut`, as a piece of one): the
 * last text block an assistant record holds, with the ETA report's lines
 * left out, its first line that has words, trimmed.  "" where there is
 * none.  It is the line the model writes to the person between its tool
 * calls, which neither `$.agent.list()` nor the folds carry. */
export function progressOf(tail: string, cut: boolean): string {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= (cut ? 1 : 0); i--) {
    let rec: unknown;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!isDict(rec) || rec.type !== "assistant") continue;
    const content = pyGet(rec.message, "content");
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const b = content[j];
      if (!isDict(b) || b.type !== "text" || typeof b.text !== "string") {
        continue;
      }
      const first = b.text.replace(ETA_LINE, "").split("\n")
        .map((l) => l.trim()).find((l) => l);
      if (first) return first;
    }
  }
  return "";
}

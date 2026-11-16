// The agent panel: every prepared task's row, laid out on the grid and
// joined into escape codes (renderTaskRows), pinned by the panel cases
// (tests/fixtures/panel/).  No entry draws it: the band's tree draws the
// same rows (band_tree.ts, agent_row.ts).
import {
  E_INBOX, E_KIDS, E_MODE_MONITOR, E_MODE_SHELL, E_ROW_COMPACT, CHROME_DEPTH,
  GRID_CELLS, LABEL_MIN,
} from "./spec.ts";
import { visWidth } from "./formatting.ts";
import type { Settings } from "./formatting.ts";
import { join, rstrip, width } from "./spans.ts";
import type { Span } from "./spans.ts";
import { pyGet, pyIntText, pyLen, pyOr, pyTruthy } from "./py.ts";
import type { Dict } from "./py.ts";
import { pyStr } from "./sources.ts";
import type { Limits } from "./claude_sources.ts";
import {
  agentCells, agentLabel, backgroundCount, firstMax, hasId, inheritedEtas,
  runningParents, strOr, treeShape, ua,
} from "./agent_row.ts";
import type { Eta, PanelWidths, Prepared } from "./agent_row.ts";
import { cellWidth, chrome, draw, hidden, labelRoom, layout } from "./grid.ts";
import type { Piece, Row } from "./grid.ts";

/** The largest of xs, or 0 for none. */
function maxOr0(xs: readonly number[]): number {
  return xs.length ? firstMax(xs) : 0;
}

/** 1 for a task the session started, 2 for one an agent started, and so
 * on: max(1, int(...)), 1 where int() raises. */
export function spawnDepth(task: unknown, meta: unknown): number {
  const v = pyOr(pyOr(pyGet(meta, "spawnDepth"), pyGet(task, "spawnDepth")),
    1);
  let n: number | null;
  if (typeof v === "boolean") n = v ? 1 : 0;
  else if (typeof v === "number") n = Number.isFinite(v) ? Math.trunc(v) : 1;
  else if (typeof v === "string") n = pyIntText(v);
  else n = null;
  return n === null ? 1 : Math.max(1, n);
}

/** The cells each scope's rows can carry: templates of the band's, the
 * receipt's and an agent's rows, the panel's rows laid out over them so
 * they reach the mod's columns. */
export const SCOPE_CELLS: readonly (readonly [string, readonly string[]])[] = [
  ["account", ["five", "week"]],
  ["turn", ["cost", "spend", "ctx", "tok", "cache", "clock", "eta", "split",
    "five", "week", "diff"]],
  ["main", GRID_CELLS.map((c) => c.key)],
  ["session", ["cost", "spend", "tok", "cache", "clock", "split", "five",
    "week", "diff"]],
  ["agent", GRID_CELLS.map((c) => c.key)],
];

/** The templates of SCOPE_CELLS, as grid rows. */
export function possibleRows(): Row[] {
  return SCOPE_CELLS.map(([scope, keys]) => ({
    scope, label: [],
    cells: Object.fromEntries(keys.map((k) => [k, [] as Span[]])),
  }));
}

/** [cols, keys]: the terminal width a row is drawn for and the columns
 * every row draws there.  With no width known, the narrowest that drops no
 * column. */
export function panelLayout(st: Settings, cols: number | null = null,
  hide: readonly string[] = []): [number, string[]] {
  const rows = possibleRows();
  let w = cols;
  if (!w) {
    const keys = layout(st, rows, 1 << 30, hide);
    const room = new Map(GRID_CELLS.map((c) =>
      [c.key, cellWidth(st, c.width) + c.gap]));
    w = st.rightEdge + width(chrome(CHROME_DEPTH), st.widths) + LABEL_MIN +
      keys.reduce((n, k) => n + room.get(k)!, 0);
  }
  return [w, layout(st, rows, w, hide)];
}

/** Render one fully prepared task on the grid, without its chrome, which
 * Claude Code draws.
 * `eta` false is the row's own. */
export function renderAgentRow(st: Settings, task0: unknown, usage: unknown,
  meta0: unknown, shares0: unknown, limits: Limits,
  cols0: number | null = null, now: number | null = null,
  eta: Eta | false = false, waitingOn = false, depth: number | null = null,
  kids = 0, kidsW = 0, widths: PanelWidths | null = null,
  hide: readonly string[] = []): Span[] {
  const [cols, keys] = panelLayout(st, cols0, hide);
  return drawAgentRow(st, agentRow(st, task0, usage, meta0, shares0, limits,
    now, eta, waitingOn, depth, kids, kidsW, widths), keys, cols, hide);
}

/** agentRow: the grid row for one prepared task; see renderAgentRow. */
export function agentRow(st: Settings, task0: unknown, usage: unknown,
  meta0: unknown, shares0: unknown, limits: Limits,
  now: number | null = null, eta: Eta | false = false, waitingOn = false,
  depth: number | null = null, kids = 0, kidsW = 0,
  widths: PanelWidths | null = null): Row {
  const task = pyOr(task0, {}) as Dict, meta = pyOr(meta0, {});
  const shares = pyOr(shares0, {});
  return {
    scope: "agent",
    depth: depth === null ? spawnDepth(task, meta) : depth,
    label: agentLabel(st, task, usage, meta, waitingOn, kids, kidsW, widths),
    cells: agentCells(st, task, usage, meta, shares, limits, now, eta,
      waitingOn),
  };
}

/** drawAgentRow: the row on the panel's columns, without the chrome
 * Claude Code draws. */
export function drawAgentRow(st: Settings, row: Row, keys: readonly string[],
  cols: number, hide: readonly string[] = []): Span[] {
  const out = draw(st, row, keys, cols, hide), head = chrome(row.depth);
  // A terminal too narrow for even the chrome leaves the row nothing.
  const same = head.every((h, i) => i < out.length &&
    JSON.stringify(out[i]) === JSON.stringify(h));
  return rstrip(same ? out.slice(head.length) : []);
}

/** The counts in the order their columns leave the panel, the quickest
 * to pass first: 📨, 📡, 💻, 🤏, then 👶🏻. */
export const COUNTS_LEAVING = [
  "inbox", "monitors", "shells", "compact", "kids",
] as const;
export type Count = typeof COUNTS_LEAVING[number];

/** The label's pieces that are cut before a count column leaves. */
export const CUT_FIRST: readonly string[] = ["workspace.branch", "chat.doing"];

/** labelFits: whether the row's label, but for its branch and activity,
 * fits the room the grid gives it. */
export function labelFits(st: Settings, row: Row, keys: readonly string[],
  cols: number, hide: readonly string[] = []): boolean {
  const kept = row.label.filter((p) => !CUT_FIRST.includes(p.path) &&
    !hidden(hide, row.scope + "." + p.path));
  return width(kept.flatMap((p) => p.spans), st.widths) <=
    labelRoom(st, row, keys, cols, hide);
}

/** panelCounts: the rows with the count columns the whole panel keeps;
 * `relabel(gone)` gives their labels without the counts in `gone`. */
export function panelCounts(st: Settings,
  relabel: (gone: ReadonlySet<Count>) => Piece[][], rows0: readonly Row[],
  keys: readonly string[], cols: number,
  hide: readonly string[] = []): Row[] {
  let rows = [...rows0];
  const gone = new Set<Count>();
  for (const k of COUNTS_LEAVING) {
    if (rows.every((r) => labelFits(st, r, keys, cols, hide))) break;
    gone.add(k);
    const labels = relabel(gone);
    rows = rows.map((r, i) => ({ ...r, label: labels[i] }));
  }
  return rows;
}

/** The widest 📨, 🤏, 💻 and 📡 cell on the panel; see PanelWidths. */
export function panelWidths(st: Settings,
  prepared: readonly Prepared[]): PanelWidths {
  const live = prepared.filter(([t]) => hasId(t))
    .map(([t, u]) => [strOr((t as Dict).status), u] as const);
  const widest = (mark: string, ns: readonly unknown[]): number =>
    maxOr0(ns.filter((n) => pyTruthy(n))
      .map((n) => visWidth(mark, st.widths) + pyLen(pyStr(n))));
  return {
    inbox: widest(E_INBOX, live.map(([, u]) => ua(u, "inbox", 0))),
    compact: widest(E_ROW_COMPACT,
      live.map(([, u]) => ua(u, "compactions", 0))),
    shells: widest(E_MODE_SHELL,
      live.map(([s, u]) => backgroundCount(s, u, "bash"))),
    monitors: widest(E_MODE_MONITOR,
      live.map(([s, u]) => backgroundCount(s, u, "monitor"))),
  };
}

/** The (task id, row) pairs for prepared (task, usage, meta, shares)
 * facts, in the payload's order.  `cols` is the terminal's width, the
 * payload's columns plus PANEL_COLUMNS_SHORT, and `hide` the --hide
 * paths. */
export function renderTaskRowSpans(st: Settings,
  prepared: readonly Prepared[], limits: Limits, cols0: number | null = null,
  now: number | null = null,
  hide: readonly string[] = []): [string, Span[]][] {
  const rows: [string, Span[]][] = [];
  const shape = treeShape(prepared);
  const etas = inheritedEtas(prepared);
  const busy = runningParents(prepared);
  // 👶🏻 counts the rows hanging directly under each one, as treeShape
  // resolves them, finished or not.
  const kids = new Map<string, number>();
  for (const [p] of shape.values()) {
    if (p) kids.set(p, (kids.get(p) ?? 0) + 1);
  }
  const kidsW = maxOr0([...kids.values()]
    .map((n) => visWidth(E_KIDS, st.widths) + pyLen(String(n))));
  const widths = panelWidths(st, prepared);
  const live = prepared.filter(([t]) => hasId(t))
    .map(([t, u, m, sh]) => [pyStr((t as Dict).id), t as Dict, u, m, sh] as
      const);
  const [cols, keys] = panelLayout(st, cols0, hide);
  const relabel = (gone: ReadonlySet<Count>): Piece[][] => {
    const w: PanelWidths = {
      inbox: gone.has("inbox") ? 0 : widths.inbox,
      compact: gone.has("compact") ? 0 : widths.compact,
      shells: gone.has("shells") ? 0 : widths.shells,
      monitors: gone.has("monitors") ? 0 : widths.monitors,
    };
    return live.map(([tid, t, u, m]) => agentLabel(st, t, u, pyOr(m, {}),
      busy.has(tid), kids.get(tid) ?? 0, gone.has("kids") ? 0 : kidsW, w));
  };
  const drawn = panelCounts(st, relabel, live.map(([tid, t, u, m, sh]) =>
    agentRow(st, t, u, m, sh, limits, now,
      etas.has(tid) ? etas.get(tid)! : false, busy.has(tid),
      shape.get(tid)![1], kids.get(tid) ?? 0, kidsW, widths)),
  keys, cols, hide);
  live.forEach(([tid], i) => {
    rows.push([tid, drawAgentRow(st, drawn[i], keys, cols, hide)]);
  });
  return rows;
}

/** renderTaskRows: `(task id, row)` pairs, each row joined into escape
 * codes where the panel prints it. */
export function renderTaskRows(st: Settings, prepared: readonly Prepared[],
  limits: Limits, cols: number | null = null, now: number | null = null,
  hide: readonly string[] = []): [string, string][] {
  return renderTaskRowSpans(st, prepared, limits, cols, now, hide)
    .map(([tid, row]) => [tid, join(row, false, false, st.truecolor)]);
}

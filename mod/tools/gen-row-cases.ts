// Write the row builders' shared cases, tests/fixtures/rows/, from
// src/band.ts and src/receipt.ts.
//
//   node mod/tools/gen-row-cases.ts
//
// Like the grid's cases (gen-grid-cases.ts), these are written by the
// TypeScript, where the builders are built first; mod/test/rows.test.ts
// runs every case and fails when this generator's output differs from what
// is committed, so regenerating and reading the diff is the only way to
// change them.
//
// The inputs are the committed figures documents, tests/fixtures/figures/,
// by id (`<suite>/<name>`), each filled out as mod/test/figures_doc.ts
// fills one.  The first terminal profile's file holds every case.  The
// other profiles' hold a sample, the cases a profile can change: each
// status document at SAMPLE_COLS in each phase, and every receipt; a padded
// icon is a cell's, not a width's.  Profiles whose samples come out the
// same share one file.  The start and account cases, which no profile
// changes, are written once, in the first; mod/test/rows.test.ts replays
// them under every profile.  Each file holds:
//
//   settings  the profiles, each with the environment it is read from
//   band      one case a line: a status document, `doc`, drawn
//             at `cols` under `hide` in `phase` with the mod's 🛫, `rate`,
//             and, where the case has them, only the rows `places` (the
//             defaults file's rows.*.place) puts in `place`; above the
//             prompt, where the case has them, the band's tree with the
//             subagents of the panel input `agents`, the main
//             thread's progress update `progress`;
//             `rows`, each row's spans top to bottom
//   receipt   one case a line: a cost document drawn at `cols` under
//             `hide`; its lines as spans, `rows`
//   start     one case a line: a status document's start line under
//             `hide`, as `spans`
//   account   one case a line: a status document's 💳 row drawn at `cols`
//             under `hide` (the paths accountHide gives, where a case is
//             of the option weekly-windows), `indent` blanks in, as `row`;
//             the last ones three documents at widths that shed their
//             pieces
//
// The first case of each kind in a file also has its spans joined with
// their escape codes, `lines` or `line`; tests/fixtures/formatting/
// spans.json pins the joining for the rest.
//
// Each document's clock is drawn in its own `clock.tz`.  A span is written
// as the grid's cases write one.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { settings } from "../src/formatting.ts";
import type { Settings } from "../src/formatting.ts";
import { join } from "../src/spans.ts";
import type { Span } from "../src/spans.ts";
import type { Dict } from "../src/py.ts";
import { accountHide, accountLine, bandLines } from "../src/band.ts";
import { WEEKLY_WINDOWS } from "../src/sources.ts";
import type { WeeklyKey } from "../src/sources.ts";
import type { Phase, Place, RowsPlace } from "../src/band.ts";
import { DEFAULTS_REL, parseDefaults } from "../src/config.ts";
import type { Rows } from "../src/config.ts";
import { receiptLines, startLine } from "../src/receipt.ts";
import { PROFILES, spanJson } from "./gen-grid-cases.ts";
import { FIGURES, figuresNames, readFigures } from "../test/figures_doc.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = pathJoin(HERE, "..", "..", "tests", "fixtures", "rows");
export { FIGURES };
const COLS = [200, 155, 120, 80];
// Each scope's figures hidden, a group on every row, a label piece, and a
// whole scope with a label part of another, at one width.
const HIDES: readonly (readonly string[])[] = [
  ["*.work", "*.state.rate", "main.state.inbox"],
  ["session.tokens", "*.clock.time"],
  ["turn", "main.name", "*.plan"],
];
const HIDE_COLS = 155;
// The width a second profile's sample draws each status document at.
const SAMPLE_COLS = 155;
// The start line's: none, and 🔋 hidden on the tag lines alone.
const START_HIDES: readonly string[][] = [[], ["tag.plan.five_hour"]];
// The Fable window's own: hidden, and the weekly window hidden, which
// takes the shared 🔜 with it unless the Fable window draws its own.
const FABLE_HIDES: readonly string[][] = [["account.plan.fable"],
  ["account.plan.week"]];
// A document with every piece of the 💳 row, 🔀 and 🎨 among them, one
// with the Fable window's 🦊 and its own 🔜, and one with the other weekly
// windows, drawn at widths that shed them one by one.
const SHED_DOCS = ["status/04-pr-and-style",
  "status/fable-own-reset", "status/weekly-windows"];
// The 🛫 the mod would pass, at one width: the documents carry the counts
// it works one out from, never the rate itself.
const RATE = 220, RATE_COLS = 200;
// Where the defaults file puts each of the band's rows, and the width the
// cases by place are drawn at.
const DEFAULT_ROWS = parseDefaults(DEFAULTS_REL, readFileSync(
  pathJoin(HERE, "..", DEFAULTS_REL), "utf8")).rows as Rows;
// The weekly windows as the defaults file leaves them, all off, and the
// hide paths of a document with any of them: as shipped; a file's own
// `hide`, which leaves them off; Opus alone turned on; and every one on
// with the weekly window hidden, which gives each its own 🔜.
const DEFAULT_WINDOWS = parseDefaults(DEFAULTS_REL, readFileSync(
  pathJoin(HERE, "..", DEFAULTS_REL), "utf8"))["weekly-windows"] as
  { [key in WeeklyKey]: boolean };
const WINDOW_HIDES: readonly string[][] = [
  accountHide([], DEFAULT_WINDOWS),
  accountHide(["*.plan.five_hour", "*.context.share"], DEFAULT_WINDOWS),
  accountHide([], { ...DEFAULT_WINDOWS, opus: true }),
  ["account.plan.week"]];
export const PLACES: RowsPlace = Object.fromEntries(
  (["turn", "agent", "session"] as const).map((r) =>
    [r, DEFAULT_ROWS[r].place as Place]));
const PLACE_COLS = 155;

/** The documents of `suite`: [id, the document]. */
export function documents(suite: string): [string, Dict][] {
  return figuresNames(suite).map((name) =>
    [suite + "/" + name, readFigures(suite, name)]);
}

/** A document by id. */
export function document(id: string): Dict {
  const [suite, name] = id.split("/");
  return readFigures(suite, name);
}

/** Draw `fig` with its clock in its own zone, as the edge sets it. */
export function inZone<T>(fig: Dict, f: () => T): T {
  const tz = (fig.clock as Dict).tz as string | null;
  const was = process.env.TZ;
  process.env.TZ = tz ?? "UTC";
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

export type BandCase = { doc: string; cols: number; hide: string[];
  phase: Phase; rate: number | null; place?: Place; places?: RowsPlace;
  agents?: string; progress?: string; background?: boolean;
  session?: { name: string; color: string } };

/** The panel's inputs, tests/fixtures/panel/inputs.json: by group and
 * name, each case's prepared `(task, usage, meta, shares)` records, which
 * are the band's tree's subagents (corpusAgents). */
export const PANEL_INPUTS = pathJoin(HERE, "..", "..", "tests", "fixtures",
  "panel", "inputs.json");
type PanelInputs = { [group: string]: { [name: string]: Dict[] } };
const panelInputs = (): PanelInputs =>
  JSON.parse(readFileSync(PANEL_INPUTS, "utf8")) as PanelInputs;

/** Every panel input's id, `<group>/<name>`, in the file's order. */
export function panelInputIds(): string[] {
  return Object.entries(panelInputs()).flatMap(([group, cases]) =>
    Object.keys(cases).map((name) => group + "/" + name));
}

/** A status document's `agents` with the subagents of the panel input
 * `id`, `<group>/<name>` ("" for none), each task's `label` standing for
 * its latest progress update and none for its activity, and `main` the
 * main thread's.  The inputs' clock is the figures documents'. */
export function corpusAgents(id: string, main: string): Dict {
  if (!id) return { tasks: [], main_progress: main };
  const [group, name] = id.split("/");
  const tasks = panelInputs()[group]?.[name];
  if (!tasks) throw new Error("no panel input " + JSON.stringify(id));
  return { main_progress: main, tasks: tasks
    .map((t) => ({ task: { ...t.task as Dict, label: "" }, usage: t.usage,
      meta: t.meta, shares: t.shares,
      progress: String((t.task as Dict).label ?? "") })) };
}
export type ReceiptCase = { doc: string; cols: number; hide: string[] };
export type AccountCase = { doc: string; cols: number; hide: string[];
  indent: number };

/** The account case's row, as the 💳 row under the footer line or above
 * the prompt draws it; none under the hide path `account`. */
export function drawAccount(st: Settings, fig: Dict, c: AccountCase):
  Span[] {
  return inZone(fig, () => accountLine(st, fig, c.hide, c.cols, "",
    c.indent));
}

/** `doc`, a document's `agents`, with open background tasks the tree draws
 * under their threads: a shell and a Monitor of the main thread's, and
 * for each task its usage's, each labelled and opened a while before
 * `now`. */
export function withBackground(doc: Dict, now: number): Dict {
  const label = (kind: string): string =>
    kind === "bash" ? "Build the docs site" : "Watch the CI checks";
  return { ...doc, main_background: [
    { id: "msh", kind: "bash", label: "Run the plugin tests",
      start: now - 372, command: "npm test -- --watch",
      output: "/private/tmp/claude-501/-Users-u-git-p/0f3c9a7e-5b1d-4e2a" +
        "-9c8b-1a2b3c4d5e6f/tasks/b3qupkikw.output" },
    { id: "mmon", kind: "monitor", label: "Watch PR #38 for comments",
      start: now - 1500, command: "gh pr view 38 --comments ⏎ sleep 30",
      output: "/Users/u/.cache/tasks/mmon.output" }],
  tasks: (doc.tasks as Dict[]).map((t) => ({ ...t,
    bgTasks: ((t.usage as Dict).background as [string, string][] ?? [])
      .map(([id, kind]) => ({ id, kind, label: label(kind),
        start: now - 125 })) })) };
}

/** The band case's rows: with `agents` or `progress`, the document's
 * `agents` from the corpus (corpusAgents), drawn in the tree, with open background tasks under `background` (withBackground); with
 * `session`, the transcript's session name and colour. */
export function drawBand(st: Settings, fig0: Dict, c: BandCase): Span[][] {
  const fig1 = c.session === undefined ? fig0 : { ...fig0,
    transcript: { ...fig0.transcript as Dict, session_name: c.session.name,
      session_color: c.session.color } };
  const agents = (): Dict => {
    const doc = corpusAgents(c.agents ?? "", c.progress ?? "");
    return c.background
      ? withBackground(doc, (fig0.clock as Dict).now as number) : doc;
  };
  const fig = c.agents !== undefined || c.progress !== undefined
    ? { ...fig1, agents: agents() } : fig1;
  return inZone(fig, () => bandLines(st, fig, c.cols, c.hide,
    { rate: c.rate, phase: c.phase, place: c.place, places: c.places }));
}

/** The band's tree with subagents, on TREE_DOC, with the main thread's
 * progress update: three of the corpus's sessions at each width, and every
 * other panel input at INPUT_COLS;
 * one that hides the
 * progress updates; once between turns; with open background shells
 * and Monitors under the main thread and the agents that started them;
 * and with the session named, at each width, in a colour and in none, and
 * with its name hidden. */
function treeCases(): BandCase[] {
  const base = { doc: TREE_DOC, hide: [] as string[], phase: "running" as
    Phase, rate: RATE, place: "above" as Place, places: PLACES,
    progress: TREE_PROGRESS };
  const out: BandCase[] = [];
  for (const agents of TREE_AGENTS) {
    for (const cols of [236, ...COLS]) out.push({ ...base, cols, agents });
  }
  for (const agents of panelInputIds()) {
    if (!TREE_AGENTS.includes(agents)) {
      out.push({ ...base, cols: INPUT_COLS, agents });
    }
  }
  out.push({ ...base, cols: 200, agents: TREE_AGENTS[1],
    hide: ["*.chat.progress"] });
  out.push({ ...base, cols: 200, agents: TREE_AGENTS[1], phase: "done" });
  for (const cols of [236, 120]) {
    out.push({ ...base, cols, agents: TREE_AGENTS[2], background: true });
  }
  const session = { name: "Statusline", color: "purple" };
  for (const cols of [...COLS, 60]) {
    out.push({ ...base, cols, agents: TREE_AGENTS[1], session });
  }
  out.push({ ...base, cols: 200, agents: TREE_AGENTS[1],
    session: { name: "Statusline", color: "" } });
  out.push({ ...base, cols: 200, agents: TREE_AGENTS[1], session,
    hide: ["session.workspace.name"] });
  return out;
}

// The tree's cases: a document, the corpus sessions whose tasks are its
// subagents at every width, the width every other panel input is drawn
// at, and the main thread's progress update.
const TREE_DOC = "status/01-baseline";
const TREE_AGENTS = ["corpus/01-mixed", "corpus/03-tree",
  "corpus/02-parked"];
const INPUT_COLS = 160;
const TREE_PROGRESS = "Checking the binary for subagentStatusLine, then " +
  "the changelog for a hook that replaces it";

/** The receipt case's lines. */
export function drawReceipt(st: Settings, fig: Dict, c: ReceiptCase):
  Span[][] {
  return inZone(fig, () => receiptLines(st, fig, c.cols, c.hide));
}

/** The start line under `hide`. */
export function drawStart(st: Settings, fig: Dict,
  hide: readonly string[] = []): Span[] {
  return inZone(fig, () => startLine(st, fig, hide));
}

/** Every band case of one document. */
function bandCases(doc: string): BandCase[] {
  const out: BandCase[] = [];
  for (const cols of COLS) {
    for (const phase of ["running", "done"] as const) {
      out.push({ doc, cols, hide: [], phase, rate: null });
    }
  }
  for (const hide of HIDES) {
    out.push({ doc, cols: HIDE_COLS, hide: [...hide], phase: "running",
      rate: null });
  }
  out.push({ doc, cols: RATE_COLS, hide: [], phase: "running", rate: RATE });
  for (const place of ["above", "footer"] as const) {
    out.push({ doc, cols: PLACE_COLS, hide: [], phase: "running", rate: null,
      place, places: PLACES });
  }
  return out;
}

/** Every account case of one document: at each width and hiding the band
 * cases take, and once indented, as above the prompt; a document with the
 * Fable window also with each weekly window hidden, and one with any
 * other weekly window under WINDOW_HIDES. */
function accountCases(doc: string, fig: Dict): AccountCase[] {
  const lim = fig.limits as Dict;
  const fable = lim.fable_pct !== null;
  const others = WEEKLY_WINDOWS.some(([key]) => lim[key + "_pct"] !== null);
  return [...COLS.map((cols) => ({ doc, cols, hide: [], indent: 0 })),
    ...HIDES.map((hide) => ({ doc, cols: HIDE_COLS, hide: [...hide],
      indent: 0 })),
    ...(fable ? FABLE_HIDES : []).map((hide) => ({ doc, cols: HIDE_COLS,
      hide: [...hide], indent: 0 })),
    ...(others ? WINDOW_HIDES : []).map((hide) => ({ doc, cols: HIDE_COLS,
      hide: [...hide], indent: 0 })),
    { doc, cols: HIDE_COLS, hide: [], indent: 2 }];
}

/** The account cases of SHED_DOCS, from wide enough for every piece down
 * to too narrow for any but the cut 💳, a piece shed at each step. */
function shedCases(): AccountCase[] {
  const out: AccountCase[] = [];
  for (const doc of SHED_DOCS) {
    for (let cols = 200; cols >= 30; cols -= 10) {
      out.push({ doc, cols, hide: [], indent: 0 });
    }
  }
  return out;
}

/** Every receipt case of one document. */
function receiptCases(doc: string): ReceiptCase[] {
  const out: ReceiptCase[] = COLS.map((cols) => ({ doc, cols, hide: [] }));
  for (const hide of HIDES) {
    out.push({ doc, cols: HIDE_COLS, hide: [...hide] });
  }
  return out;
}

const rowsJson = (rows: Span[][]): unknown[][] =>
  rows.map((r) => r.map(spanJson));

/** A case's text: the case, its spans, and `joined` for the first case of
 * its kind in the file, the spans joined with their escape codes. */
function caseText(c: object, spans: Dict, joined: Dict | null): string {
  return JSON.stringify({ ...c, ...spans, ...joined });
}

/** The cases under one profile's settings, as the file's text after its
 * settings line: every case, or under `sample` the cases a profile can
 * change, each status document at SAMPLE_COLS in each phase and every
 * receipt, and no start or account case, which no profile changes. */
function cases(st: Settings, sample: boolean): string {
  const band: string[] = [], receipt: string[] = [], start: string[] = [];
  const account: string[] = [];
  const bandCase = (c: BandCase, fig: Dict): string => {
    const rows = drawBand(st, fig, c);
    return caseText(c, { rows: rowsJson(rows) },
      band.length ? null : { lines: rows.map((r) => join(r)) });
  };
  const accountCase = (c: AccountCase, fig: Dict): string => {
    const row = drawAccount(st, fig, c);
    return caseText(c, { row: row.map(spanJson) },
      account.length ? null : { line: join(row) });
  };
  for (const [id, fig] of documents("status")) {
    for (const c of bandCases(id)) {
      if (sample && !(c.cols === SAMPLE_COLS && !c.hide.length &&
        c.rate === null && c.place === undefined)) continue;
      band.push(bandCase(c, fig));
    }
    if (sample) continue;
    for (const c of accountCases(id, fig)) account.push(accountCase(c, fig));
    for (const hide of START_HIDES) {
      const s = drawStart(st, fig, hide);
      start.push(caseText({ doc: id, hide }, { spans: s.map(spanJson) },
        start.length ? null : { line: join(s) }));
    }
  }
  if (!sample) {
    for (const c of shedCases()) {
      account.push(accountCase(c, document(c.doc)));
    }
    for (const c of treeCases()) band.push(bandCase(c, document(c.doc)));
  }
  for (const [id, fig] of documents("cost")) {
    for (const c of receiptCases(id)) {
      const got = drawReceipt(st, fig, c);
      receipt.push(caseText(c, { rows: rowsJson(got) },
        receipt.length ? null : { lines: got.map((r) => join(r)) }));
    }
  }
  const list = (name: string, lines: string[]): string =>
    ' "' + name + '": [\n' + lines.map((l) => "  " + l).join(",\n") +
    "\n ]";
  return [list("band", band), list("receipt", receipt), list("start", start),
    list("account", account)].join(",\n") + "}\n";
}

/** Every file, by name: the first profile's every case, and the other
 * profiles' samples, profiles whose samples come out the same sharing a
 * file, as gen-grid-cases.ts's generate shares them. */
export function generate(): Map<string, string> {
  const [first, ...rest] = Object.keys(PROFILES);
  const groups = new Map<string, string[]>(
    [[cases(settings(PROFILES[first]), false), [first]]]);
  for (const name of rest) {
    const body = cases(settings(PROFILES[name]), true);
    groups.set(body, [...(groups.get(body) ?? []), name]);
  }
  return new Map([...groups].map(([body, names]) => [
    names.join("-") + ".json",
    '{"settings": ' + JSON.stringify({ profiles: Object.fromEntries(
      names.map((n) => [n, PROFILES[n]])) }) + ",\n" + body]));
}

if (import.meta.main) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of generate()) {
    writeFileSync(pathJoin(OUT, name), text);
    const j = JSON.parse(text);
    process.stdout.write(`rows/${name.padEnd(22)} ${j.band.length} band, ` +
      `${j.receipt.length} receipt, ${j.start.length} start and ` +
      `${j.account.length} account cases\n`);
  }
}

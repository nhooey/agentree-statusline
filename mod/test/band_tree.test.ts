// The band's tree (band_tree.ts) and the subagents' facts it draws
// (subagent_tasks.ts): agentUsageOf against the committed answers over
// the fixture agents, the progress update off a transcript's tail,
// and the tree's lines, groups, cap and folds over the panel corpus's
// tasks.  The drawn rows themselves are pinned by the rows' cases
// (rows.test.ts, gen-row-cases.ts's tree cases).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { settings, stripAnsi, visWidth } from "../src/formatting.ts";
import { join, span } from "../src/spans.ts";
import type { Span } from "../src/spans.ts";
import type { Dict } from "../src/py.ts";
import { githubRepo } from "../src/github.ts";
import { NO_LIMITS } from "../src/claude_sources.ts";
import { foldAgentBytes, newAgentFold } from "../src/claude_records.ts";
import type { BgTask } from "../src/claude_records.ts";
import {
  agentClock, agentShares, agentUsageOf, inboxTargets, progressOf,
  taskStatus, treeTasks,
} from "../src/subagent_tasks.ts";
import { inboxCounts } from "../src/claude_records_node.ts";
import type { TreeTask } from "../src/subagent_tasks.ts";
import {
  bgPath, bgText, foldShut, groupFold, pruneFolds, treeRows,
  workspaceLinks,
} from "../src/band_tree.ts";
import type { TreeInput } from "../src/band_tree.ts";
import { stampedSplit } from "../src/band_tree.ts";
import { draw, labelText } from "../src/grid.ts";
import { SESSION_COLOUR_NONE, SESSION_COLOURS } from "../src/cells.ts";
import * as spec from "../src/spec.ts";
import type { Row } from "../src/grid.ts";
import { bandRows, fixedKeys, treeOf } from "../src/band.ts";
import type { BandOpts, Live, Phase } from "../src/band.ts";
import { corpusAgents, withBackground } from "../tools/gen-row-cases.ts";
import { readFigures } from "./figures_doc.ts";
import { expand } from "./cases_once.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const ST = settings({}, true, false, 5);
const NOW = 1786847000;
const LIMITS = { ...NO_LIMITS, session_pct: "15", weekly_pct: "87" };

/** The fixture agents' transcripts, every one under
 * tests/fixtures/transcripts/subagent/. */
function agentFiles(): string[] {
  const top = path.join(REPO, "tests/fixtures/transcripts/subagent");
  const out: string[] = [];
  for (const d of fs.readdirSync(top).sort()) {
    const sub = path.join(top, d, "subagents");
    if (!fs.existsSync(sub)) continue;
    for (const f of fs.readdirSync(sub).sort()) {
      if (f.endsWith(".jsonl")) out.push(path.join(sub, f));
    }
  }
  return out;
}

// tests/fixtures/claude/agent-usage.json holds each fixture agent's usage
// as committed data, each an AgentUsage record written with the fields
// that differ from an empty fold's (cases_once.ts).
test("agentUsageOf is each fixture agent's committed usage, field for " +
  "field", () => {
  const files = agentFiles();
  assert.ok(files.length > 3);
  const want = expand(JSON.parse(fs.readFileSync(path.join(REPO,
    "tests/fixtures/claude/agent-usage.json"), "utf8"))) as
    Record<string, Dict>;
  assert.deepEqual(Object.keys(want).sort(),
    files.map((f) => path.relative(REPO, f)).sort());
  for (const f of files) {
    const fold = newAgentFold();
    foldAgentBytes(fold, fs.readFileSync(f), true);
    const got = JSON.parse(JSON.stringify(agentUsageOf(fold))) as Dict;
    const w = want[path.relative(REPO, f)];
    assert.deepEqual(Object.keys(got).sort(), Object.keys(w).sort(), f);
    for (const k of Object.keys(w)) {
      assert.deepEqual(got[k], w[k], path.basename(f) + " " + k);
    }
  }
});

test("agentClock runs a running agent's open span on to now, and stops a " +
  "finished one's where its file does", () => {
  const usage: Dict = { work: [[100, 160]], tools: [[110, 120]],
    waiting: [], open_at: 200, pending: [] };
  assert.deepEqual(agentClock(usage, false, 300), [50, 10]);
  assert.deepEqual(agentClock(usage, true, 300), [150, 10]);
});

test("agentShares divides what an agent billed in each window by the " +
  "calibrated dollars a percent", () => {
  const usage: Dict = { parts: [[null, 1.0], [1786846000, 2.0]] };
  assert.deepEqual(agentShares(usage, { sess: 0.5, week: 2.0 }, {}),
    { sess: 6, week: 1.5 });
  assert.deepEqual(agentShares(usage, { sess: 0.5 }, {}),
    { sess: 6, week: null });
  assert.deepEqual(agentShares({ parts: [] }, { sess: 0.5 }, {}),
    { sess: null, week: null });
});

test("taskStatus keeps a waiting loop waiting and reads an idle teammate " +
  "as done", () => {
  assert.deepEqual(["waiting", "idle", "running", "killed", undefined]
    .map(taskStatus), ["waiting", "completed", "running", "killed",
    "completed"]);
});

test("progressOf is the first worded line of the last assistant text " +
  "block, the ETA report left out", () => {
  const rec = (content: unknown) => JSON.stringify({ type: "assistant",
    message: { role: "assistant", content } });
  const tail = [
    rec([{ type: "text", text: "Reading the grid first." }]),
    JSON.stringify({ type: "user", message: { content: [{
      type: "tool_result", content: "ok" }] } }),
    rec([{ type: "text", text: "\n  Now the tree.\nMore words." },
      { type: "tool_use", name: "Read", input: {} }]),
    rec([{ type: "text",
      text: "⛳ skills/coding-agent-usage-line-report-eta: ETA 4m" }]),
  ].join("\n");
  assert.equal(progressOf(tail, false), "Now the tree.");
  assert.equal(progressOf('{"half": ' + "\n" + tail, true), "Now the tree.");
  assert.equal(progressOf(rec([{ type: "tool_use", input: {} }]), false), "");
});

test("treeTasks builds each task from the list and the fold, and the " +
  "sidecar takes the list's type and parent where it has none", () => {
  const [t] = treeTasks([{ id: "a1", listed: { id: "a1", status: "waiting",
    type: "Explore", parentId: "p", description: "Look around",
    name: "Moss" }, meta: null, fold: null, inbox: 2, branch: "b",
  progress: "Reading" }], NOW, () => 200000, null, null);
  assert.equal(t.task.status, "waiting");
  assert.equal(t.task.name, "Moss");
  assert.equal(t.task.type, "local_agent");
  assert.deepEqual(t.meta, { agentType: "Explore", parentAgentId: "p" });
  assert.deepEqual([t.usage.inbox, t.usage.branch, t.usage.eta,
    t.usage.ctx_window], [2, "b", null, 0]);
  assert.equal(t.progress, "Reading");
});

/** The 03-tree fixture's agents as the hooks read them, each listed with
 * `status` (or `statuses[id]`) under the name `N<id>`, its inbox counted
 * over the main transcript and every agent's file as inboxTargets picks
 * the targets, drawn in the tree as plain lines at 200 columns. */
function inboxTree(statuses: { [id: string]: string } = {}): string[] {
  const main = path.join(REPO, "tests/fixtures/transcripts/subagent/" +
    "03-tree.jsonl");
  const dir = main.slice(0, -".jsonl".length) + "/subagents/";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    .sort().map((f) => dir + f);
  const idOf = (f: string) => path.basename(f).slice("agent-".length,
    -".jsonl".length);
  const drafts = files.map((f) => {
    const fold = newAgentFold();
    foldAgentBytes(fold, fs.readFileSync(f));
    const id = idOf(f);
    return { id, fold, listed: { id, name: "N" + id,
      status: statuses[id] ?? "running" },
    meta: JSON.parse(fs.readFileSync(f.slice(0, -".jsonl".length) +
      ".meta.json", "utf-8")), branch: "", progress: "" };
  });
  const [targets, since] = inboxTargets(drafts, (id) => dir + `agent-${id}.jsonl`);
  const inbox = inboxCounts([main, ...files], targets, since);
  const tasks = treeTasks(drafts.map((d) =>
    ({ ...d, inbox: inbox.get(d.id) ?? 0 })), NOW, () => 200000, null, null);
  const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
  const rows = treeRows(ST, { session: blank("session"),
    main: blank("main"), turn: blank("turn"), workspace: null,
    mainPhase: "🟢", mainInbox: 0, mainProgress: "", turnPhase: "🟢",
    agents: { tasks, limits: LIMITS, now: NOW, turnStart: null }, cap: 20 },
  []);
  const keys = fixedKeys(ST, 200, []);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, []))));
}

test("an agent with messages queued for it draws 📨N, and one with none " +
  "draws no 📨", () => {
  const lines = inboxTree();
  const row = (id: string) => lines.find((l) => l.includes("N" + id + " "))!;
  assert.match(row("t2"), /📨1 Nt2/u);
  assert.match(row("t3"), /📨2 Nt3/u);
  for (const id of ["g1", "t1", "t4", "t5"]) {
    assert.ok(!row(id).includes("📨"), id);
  }
});

test("a killed or failed agent's inbox is dropped with it", () => {
  const lines = inboxTree({ t2: "killed", t3: "failed" });
  assert.ok(!lines.some((l) => l.includes("📨")));
});

test("inboxTargets counts each agent with a file that was not killed or " +
  "failed, from the earliest any of them started", () => {
  const fold = (t: number) => {
    const f = newAgentFold();
    f.lastSeen = t;
    return f;
  };
  const [targets, since] = inboxTargets([
    { id: "a", listed: { id: "a", status: "running" }, fold: fold(30) },
    { id: "b", listed: { id: "b", status: "killed" }, fold: fold(10) },
    { id: "c", listed: null, fold: fold(20) },
    { id: "d", listed: { id: "d", status: "waiting" }, fold: null },
    { id: "e", listed: { id: "e", status: "running" }, fold: fold(5) },
  ], (id) => id === "e" ? "" : "/s/agent-" + id + ".jsonl");
  assert.deepEqual([...targets.keys()], ["a", "c", "d"]);
  assert.equal(since, 20);
});

/** The tree over a corpus case's tasks, under 🧵 main, as plain lines at
 * 200 columns; `statuses` gives some tasks, by id, another status. */
function tree(id: string, over: Partial<TreeInput> = {},
  hide: string[] = [], turnStart: number | null = null,
  statuses: { [id: string]: string } = {}): string[] {
  const doc = corpusAgents(id, "Checking the binary");
  doc.tasks = (doc.tasks as TreeTask[]).map((t) =>
    statuses[String(t.task.id)] === undefined ? t
      : { ...t, task: { ...t.task, status: statuses[String(t.task.id)] } });
  const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
  const rows = treeRows(ST, { session: blank("session"),
    main: blank("main"), turn: blank("turn"),
    workspace: { project: "repo", branch: "main", dirty: false, dir: "",
      pr: "38", style: "" },
    mainPhase: "🟢", mainInbox: 0, mainProgress: doc.main_progress as string,
    turnPhase: "🟢", agents: { tasks: doc.tasks as TreeTask[],
      limits: LIMITS, now: NOW, turnStart }, cap: 6, ...over }, hide);
  const keys = fixedKeys(ST, 200, hide);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, hide)))
    .trimEnd());
}

/** Each line's tree line: what stands before its first kind glyph. */
function heads(lines: readonly string[]): string[] {
  return lines.map((l) => l.slice(0, l.search(/[🎮🧵🎤🎩🔍🔩]/u)));
}

test("the tree draws 🎮 with the workspace, then 🧵 main, and under it " +
  "🎤 then its agents, each line three columns a level", () => {
  const lines = tree("corpus/03-tree");
  assert.deepEqual(heads(lines), ["⊟ ", "╰⊟ ", "   ├─ ", "   ├⊟ ",
    "   │  ├─ ", "   │  ╰⊟ ", "   │     ╰⊟ ", "   │        ╰─ ",
    "   ╰─ "]);
  assert.match(lines[0], /^⊟ 🎮 +📦repo 🌿main  🔀#38/u);
  assert.match(lines[1], /^╰⊟ 🧵 +🟢 main  Checking the binary/u);
  assert.match(lines[2], /^   ├─ 🎤 +🟢 turn$/u);
});

/** The column `text` starts at on `line`, or -1 where it is not on it. */
function colOf(line: string, text: string): number {
  const i = line.indexOf(text);
  return i < 0 ? -1 : visWidth(line.slice(0, i), ST.widths);
}

/** The column of each line's state circle, -1 for a line with none. */
function lights(lines: readonly string[]): number[] {
  return lines.map((l) => {
    const m = /[🟢🟡⚫🏁]/u.exec(l);
    return m ? visWidth(l.slice(0, m.index), ST.widths) : -1;
  });
}

test("the state circles stand in one column, a blank past the deepest " +
  "kind glyph drawn, and every name three columns after it", () => {
  // 🎤 the deepest: its glyph ends at 8, so the circles stand at 9.
  const shallow = tree("corpus/03-tree", { agents: null });
  assert.deepEqual(shallow, [
    "⊟ 🎮        📦repo 🌿main  🔀#38",
    "╰⊟ 🧵    🟢 main  Checking the binary",
    "   ╰─ 🎤 🟢 turn"]);
  assert.deepEqual(lights(shallow), [-1, 9, 9]);
  // Four levels down, Moss's glyph ends at 17: every circle moves to 18.
  const deep = tree("corpus/03-tree");
  assert.deepEqual(lights(deep), [-1, 18, 18, 18, 18, 18, 18, 18, 18]);
  assert.match(deep[1], /^╰⊟ 🧵 {13}🟢 main/u);
  assert.match(deep[7], /^   │        ╰─ 🔍 🟢 /u);
  assert.equal(colOf(deep[0], "📦"), 21);
  assert.equal(colOf(deep[1], "main"), 21);
  assert.equal(colOf(deep[2], "turn"), 21);
  // A name after counts moves on past them, as before.
  assert.equal(colOf(deep.find((l) => l.includes("Trunk"))!, "🤏"), 21);
});

test("a grouped row draws its glyph where a kind glyph stands and its " +
  "name in the names' column", () => {
  const lines = tree("corpus/03-tree", { cap: 2 });
  const more = lines.filter((l) => l.includes("more"));
  // Twig's glyph, three levels down, ends at 11: the names stand at 15.
  assert.match(more[0], /^   │  ╰⊞ … {5}3 more/u);
  assert.match(more[1], /^   ╰⊞ … {8}1 more/u);
  for (const l of more) {
    assert.equal(colOf(l, "…"), colOf(l, "⊞") + 2);
    assert.equal(colOf(l, "more") - 2, colOf(lines[1], "main"));
  }
});

test("🎮 draws the session's name in the names' column, before 📦, in " +
  "its colour, with no press; 📦 there without a name, and " +
  "workspace.name hides it", () => {
  const named = { agents: null, sessionName: "Statusline",
    sessionColour: "purple" };
  const lines = tree("corpus/03-tree", named);
  assert.match(lines[0], /^⊟ 🎮 {8}Statusline  📦repo 🌿main  🔀#38/u);
  assert.equal(colOf(lines[0], "Statusline"), colOf(lines[1], "main"));
  const bare = tree("corpus/03-tree", { agents: null });
  assert.match(bare[0], /^⊟ 🎮 {8}📦repo 🌿main  🔀#38/u);
  assert.equal(colOf(bare[0], "📦"), colOf(bare[1], "main"));
  assert.match(tree("corpus/03-tree", named, ["session.workspace.name"])[0],
    /^⊟ 🎮 {8}📦repo 🌿main  🔀#38/u);
  const root = (colour: string) => treeRows(ST, { session: { scope: "session",
    label: [], cells: {} }, main: null, turn: null, workspace: null,
    mainPhase: "🟢", mainInbox: 0, mainProgress: "", turnPhase: "🟢",
    agents: null, cap: 6, sessionName: "Statusline",
    sessionColour: colour }, [])[0];
  const badge = (colour: string) => root(colour).label
    .find((p) => p.path === "workspace.name")!;
  for (const [name, token] of Object.entries(SESSION_COLOURS)) {
    assert.equal(badge(name).spans[0].colour, token, name);
  }
  assert.equal(badge("").spans[0].colour, SESSION_COLOUR_NONE);
  assert.equal(badge("teal").spans[0].colour, SESSION_COLOUR_NONE);
  assert.deepEqual(badge("purple").spans.map((s) => s.press),
    [undefined, undefined]);
});

test("on a narrow 🎮 label the name gives way after 🔀 and before 📦",
  () => {
    const row: Row = treeRows(ST, { session: { scope: "session", label: [],
      cells: {} }, main: null, turn: null,
    workspace: { project: "repo", branch: "main", dirty: false, dir: "",
      pr: "38", style: "" }, mainPhase: "🟢", mainInbox: 0, mainProgress: "",
    turnPhase: "🟢", agents: null, cap: 6, sessionName: "Statusline",
    sessionColour: "purple" }, [])[0];
    const at = (room: number) => stripAnsi(join(labelText(ST, row, [],
      room)));
    assert.equal(at(60), "🎮    Statusline  📦repo 🌿main  🔀#38  ");
    assert.equal(at(36), "🎮    Statusline  📦repo 🌿main  ");
    assert.equal(at(22), "🎮    📦repo 🌿main  ");
    assert.equal(at(12), "🎮    📦rep…");
  });

test("on a narrow label the blanks before the circle stay, and the name " +
  "after it is cut with …", () => {
  const rows = treeRows(ST, { session: null, main: null, turn: null,
    workspace: null, mainPhase: "🟢", mainInbox: 0, mainProgress: "",
    turnPhase: "🟢", agents: { tasks: corpusAgents("corpus/03-tree", "")
      .tasks as TreeTask[], limits: LIMITS, now: NOW, turnStart: null },
    cap: 20 }, []);
  const at = (name: string, room: number) => stripAnsi(join(labelText(ST,
    rows.find((r) => r.label.some((p) => p.spans.some((s) =>
      s.text === name)))!, [], room)));
  // Tip, three levels down, sets the column; Trunk, at the top, takes
  // the blanks out of its name's room.
  assert.equal(at("Tip", 22), "      ╰─ 🔍 🟢 Tip");
  assert.equal(at("Trunk", 30), "⊟ 🎩        🟢 🤏2 Trunk");
  assert.equal(at("Trunk", 22), "⊟ 🎩        🟢 🤏2 Tr…");
  assert.equal(at("Trunk", 16), "⊟ 🎩        🟢 …");
  assert.equal(at("Trunk", 8), "⊟ 🎩   …");
});

test("🎤 alone under 🧵 main gives 🧵 a fold mark", () => {
  const lines = tree("corpus/03-tree", { agents: null });
  assert.deepEqual(heads(lines), ["⊟ ", "╰⊟ ", "   ╰─ "]);
  assert.match(lines[2], /^   ╰─ 🎤 +🟢 turn$/u);
});

test("🧵 main folded hides 🎤 with its agents", () => {
  for (const agents of [undefined, null]) {
    const lines = tree("corpus/03-tree", { folds: { main: true },
      ...(agents === null ? { agents } : {}) });
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^╰⊞ 🧵 +🟢 main  Checking the binary$/u);
    assert.ok(!lines.some((l) => l.includes("🎤")));
  }
});

test("with no turn open, 🧵 main draws as before", () => {
  const bare = tree("corpus/03-tree", { turn: null, agents: null });
  assert.deepEqual(heads(bare), ["⊟ ", "╰─ "]);
  const lines = tree("corpus/03-tree", { turn: null });
  assert.deepEqual(heads(lines).slice(0, 3), ["⊟ ", "╰⊟ ", "   ├⊟ "]);
  assert.ok(!lines.some((l) => l.includes("🎤")));
});

test("without 🧵 main, 🎤 is the root's child, before the agents", () => {
  const lines = tree("corpus/03-tree", { main: null, agents: null });
  assert.deepEqual(heads(lines), ["⊟ ", "╰─ "]);
  const agents = tree("corpus/03-tree", { main: null });
  assert.deepEqual(heads(agents).slice(0, 3), ["⊟ ", "├─ ", "├⊟ "]);
  assert.match(agents[1], /^├─ 🎤 +🟢 turn$/u);
});

test("without 🎮, 🧵 main stands at the top with 🎤 under it", () => {
  const lines = tree("corpus/03-tree", { session: null, agents: null });
  assert.deepEqual(heads(lines), ["⊟ ", "╰─ "]);
  assert.match(lines[0], /^⊟ 🧵 +🟢 main/u);
  const bare = tree("corpus/03-tree", { session: null, main: null,
    agents: null });
  assert.deepEqual(bare.map((l) => l.slice(0, 2)), ["🎤"]);
});

test("every figure keeps its column on every row of the tree", () => {
  const lines = tree("corpus/03-tree");
  const at = (l: string) => visWidth(l.slice(0, l.indexOf("⌛")), ST.widths);
  const agents = lines.slice(3);
  assert.equal(new Set(agents.map(at)).size, 1);
});

test("an agent's label packs its own counts before its name, with no " +
  "blank slots for the counts other rows have", () => {
  const lines = tree("corpus/03-tree");
  const label = (name: string) => lines.find((l) => l.includes(name))!;
  assert.match(label("Trunk"), /🎩 +🟢 🤏2 Trunk/u);
  assert.match(label("Twig"), /🔍 +🟢 📨1 Twig/u);
  assert.match(label("Tendril"), /🔩 +🟢 Tendril/u);
  assert.match(label("Moss"), /🔍 +🟢 Moss/u);
});

test("past the cap the later siblings fold into their parent's … N more, " +
  "and every shown row's parents stay", () => {
  const lines = tree("corpus/03-tree", { cap: 2 });
  assert.equal(lines.length, 7);
  assert.match(lines[3], /^   ├⊟ 🎩 +🟢 🤏2 Trunk/u);
  assert.match(lines[4], /^   │  ├─ 🔍 +🟢 📨1 Twig/u);
  assert.match(lines[5], /^   │  ╰⊞ … +3 more/u);
  assert.match(lines[6], /^   ╰⊞ … +1 more/u);
});

test("a folded agent draws ⊞ and counts every agent hidden under it", () => {
  const lines = tree("corpus/03-tree", { folds: { t1: true } });
  const trunk = lines.find((l) => l.includes("Trunk"))!;
  assert.match(trunk, /├⊞ 🎩 +🟢 👶🏻4 🤏2 Trunk/u);
  assert.ok(!lines.some((l) => l.includes("Twig")));
});

test("the agents that ended past finished-within draw no row and no " +
  "grouped row", () => {
  const lines = tree("corpus/01-mixed", {}, [], NOW - 3600);
  assert.ok(!lines.some((l) => l.includes("Daisy")));
  assert.ok(!lines.some((l) => l.includes("done")));
});

test("each thread's latest text follows its name, working or ended, and " +
  "chat.progress hides it", () => {
  assert.ok(tree("corpus/01-mixed").some((l) =>
    /Marigold  Running the suite/u.test(l)));
  assert.ok(!tree("corpus/01-mixed", {}, ["*.chat.progress"]).some((l) =>
    l.includes("Running the suite") || l.includes("Checking the binary")));
  assert.ok(tree("corpus/01-mixed", { mainPhase: "⚫" }).some((l) =>
    /🧵 +⚫ main  Checking the binary/u.test(l)));
});

test("🎤 draws the prompt typed last after its name, and chat.prompt " +
  "hides it", () => {
  const over = { agents: null, turnPrompt: "Draw the\n  prompt" };
  assert.match(tree("corpus/03-tree", over)[2],
    /^   ╰─ 🎤 +🟢 turn  Draw the¶ prompt$/u);
  assert.match(tree("corpus/03-tree", over, ["*.chat.prompt"])[2],
    /^   ╰─ 🎤 +🟢 turn$/u);
});

test("a waiting agent is paused and live: 🟡, its 🛫 what it waits on " +
  "and for how long since its last record, its progress update drawn, " +
  "counted toward the cap and kept", () => {
  const turn = NOW - 3600;
  const waiting = { p1: "waiting", x1: "waiting" };
  const lines = tree("corpus/02-parked", { cap: 10 }, [], turn, waiting);
  const row = (name: string) => lines.find((l) => l.includes(name))!;
  // Pine waits on its background shell, 980s after its last record.
  assert.match(row("Pine"), /🔩 +🟡 💻1 Pine .*💻  16m/u);
  // Yarrow waits on nothing its transcript names.
  assert.match(row("Yarrow"), /🔍 +🟡 Yarrow .*📋  13m/u);
  assert.ok(!tree("corpus/02-parked", {}, [], turn).some((l) =>
    l.includes("Yarrow")));
  // Each takes a row under the cap like any other live agent.
  const capped = tree("corpus/02-parked", { cap: 7 }, [], turn, waiting);
  assert.ok(capped.some((l) => /… +1 more/u.test(l)));
  assert.ok(!tree("corpus/02-parked", { cap: 7 }, [], turn).some((l) =>
    l.includes("more")));
});

test("a waiting agent's progress update stays drawn", () => {
  const doc = corpusAgents("corpus/02-parked", "");
  const tasks = (doc.tasks as TreeTask[]).map((t) => t.task.id === "x1"
    ? { ...t, task: { ...t.task, status: "waiting" }, progress: "Held" } : t);
  const rows = treeRows(ST, { session: null, main: null, turn: null,
    workspace: null, mainPhase: "🟢", mainInbox: 0, mainProgress: "",
    turnPhase: "🟢", agents: { tasks, limits: LIMITS, now: NOW,
      turnStart: null }, cap: 10 }, []);
  const keys = fixedKeys(ST, 200, []);
  const lines = rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, []))));
  assert.ok(lines.some((l) => /🔍 +🟡 Yarrow  Held/u.test(l)));
});

/** The tree under 🧵 main over corpus case `id`'s agents with open
 * background tasks (withBackground: a shell and a Monitor of the main
 * thread's, and each agent's usage's), `edit` changing the document
 * first, as plain lines at 200 columns, a finished row kept `linger`
 * seconds. */
function bgTree(id: string, over: Partial<TreeInput> = {},
  hide: string[] = [], turnStart: number | null = null,
  edit: (doc: Dict) => Dict = (d) => d, linger = 0): string[] {
  const doc = edit(withBackground(corpusAgents(id, ""), NOW));
  const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
  const rows = treeRows(ST, { session: null, main: blank("main"),
    turn: blank("turn"), workspace: null, mainPhase: "🟢", mainInbox: 0,
    mainProgress: "", turnPhase: "🟢", agents: {
      tasks: doc.tasks as TreeTask[], limits: LIMITS, now: NOW, turnStart,
      mainBackground: doc.main_background as BgTask[],
      mainEnded: (doc.main_background_ended ?? []) as BgTask[], linger },
    cap: 10, ...over }, hide);
  const keys = fixedKeys(ST, 200, hide);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, hide)))
    .trimEnd());
}

test("each open shell and Monitor is a leaf under the thread that " +
  "started it, after its agents, with its label and how long it has run",
() => {
  const lines = bgTree("corpus/02-parked");
  const at = (text: string) => lines.findIndex((l) => l.includes(text));
  // Under 🧵 main: 🎤 first, its agents, then its shell and its Monitor.
  assert.match(lines[1], /^├─ 🎤 +🟢 turn/u);
  assert.match(lines.at(-2)!, /^├─ 💻 +🟢 Run the plugin tests +⌛6\.2m$/u);
  assert.match(lines.at(-1)!, /^╰─ 📡 +🟢 Watch PR #38 for comments +⌛ 25m$/u);
  assert.ok(at("Peony") < at("Run the plugin tests"));
  // Under Poppy, its Monitor and its shell, in the order they opened.
  const poppy = at("Poppy");
  assert.match(lines[poppy + 1], /^│  ├─ 📡 +🟢 Watch the CI checks +⌛2\.1m$/u);
  assert.match(lines[poppy + 2], /^│  ╰─ 💻 +🟢 Build the docs site +⌛2\.1m$/u);
  // Last under 🧵, with no agents that ended after them.
  const done = bgTree("corpus/01-mixed", {}, [], NOW - 3600);
  assert.match(done.at(-1)!, /📡 +🟢 Watch PR #38/u);
});

/** The tree over 01-mixed's agents, Elm's last record `ago` seconds
 * before NOW, a finished row kept `linger` seconds, at most `cap` agent
 * rows, the turn opened an hour before NOW. */
function lingerTree(ago: number, linger: number, cap = 10): string[] {
  const doc = corpusAgents("corpus/01-mixed", "");
  const tasks = (doc.tasks as TreeTask[]).map((t) => t.task.id === "e1"
    ? { ...t, usage: { ...t.usage, last_seen: NOW - ago,
      last_epoch: NOW - ago } } : t);
  const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
  const rows = treeRows(ST, { session: null, main: blank("main"),
    turn: blank("turn"), workspace: null, mainPhase: "🟢", mainInbox: 0,
    mainProgress: "", turnPhase: "🟢", agents: { tasks, limits: LIMITS,
      now: NOW, turnStart: NOW - 3600, linger }, cap }, []);
  const keys = fixedKeys(ST, 200, []);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, [])))
    .trimEnd());
}

test("an agent that ended under finished-within ago keeps its own row, " +
  "ended, and is gone once past it", () => {
  const kept = lingerTree(100, 120);
  assert.ok(kept.some((l) => /^├─ \S+ +⚫ Elm/u.test(l)), kept.join("\n"));
  assert.ok(!kept.some((l) => l.includes("done")), kept.join("\n"));
  // Past it, Elm is gone, as with no window at all.
  for (const lines of [lingerTree(121, 120), lingerTree(2, 0)]) {
    assert.ok(!lines.some((l) => l.includes("Elm")), lines.join("\n"));
    assert.ok(!lines.some((l) => l.includes("done")), lines.join("\n"));
  }
});

test("an ended parent stays drawn, ended, while a child it started " +
  "finished within finished-within, and goes with it", () => {
  // corpus/03-tree's g1 ended long ago; g2, under it, `ago` seconds ago.
  const lines = (ago: number): string[] => {
    const doc = corpusAgents("corpus/03-tree", "");
    const tasks = (doc.tasks as TreeTask[]).map((t) => t.task.id === "g2"
      ? { ...t, usage: { ...t.usage, last_seen: NOW - ago,
        last_epoch: NOW - ago } } : t);
    const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
    const rows = treeRows(ST, { session: null, main: blank("main"),
      turn: blank("turn"), workspace: null, mainPhase: "🟢", mainInbox: 0,
      mainProgress: "", turnPhase: "🟢", agents: { tasks, limits: LIMITS,
        now: NOW, turnStart: NOW - 3600, linger: 120 }, cap: 20 }, []);
    const keys = fixedKeys(ST, 200, []);
    return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, []))));
  };
  const kept = lines(30);
  const parent = kept.findIndex((l) => l.includes("Gourd"));
  assert.match(kept[parent], /^├⊟ 🎩 +⚫ Gourd/u, kept.join("\n"));
  assert.match(kept[parent + 1], /^│  ╰─ 🔍 +⚫ Garlic/u, kept.join("\n"));
  const gone = lines(200);
  assert.ok(!gone.some((l) => l.includes("Gourd") || l.includes("Garlic")),
    gone.join("\n"));
});

test("a lingering agent row counts toward subagent-rows as a live one " +
  "does", () => {
  const more = (lines: string[]): number => Number(lines.find((l) =>
    l.includes("more"))?.match(/… +(\d+) more/u)?.[1] ?? 0);
  assert.equal(more(lingerTree(2, 5, 4)), more(lingerTree(2, 0, 4)) + 1);
});

test("a closed shell or Monitor stays where it stood, ended, its ⌛ " +
  "stopped, for finished-within, and then goes", () => {
  const gone = (ago: number) => (d: Dict): Dict => ({ ...d,
    main_background: [(d.main_background as BgTask[])[1]],
    main_background_ended: [{ ...(d.main_background as BgTask[])[0],
      end: NOW - ago }] });
  const kept = bgTree("corpus/02-parked", {}, [], null, gone(2), 5);
  // In the order they opened: the Monitor 25m ago, the shell 6.2m ago.
  assert.match(kept.at(-2)!, /^├─ 📡 +🟢 Watch PR #38 for comments/u);
  assert.match(kept.at(-1)!, /^╰─ 💻 +⚫ Run the plugin tests +⌛6\.2m$/u);
  for (const lines of [bgTree("corpus/02-parked", {}, [], null, gone(6), 5),
    bgTree("corpus/02-parked", {}, [], null, gone(2), 0)]) {
    assert.ok(!lines.some((l) => l.includes("Run the plugin tests")));
    assert.match(lines.at(-1)!, /^╰─ 📡 +🟢 Watch PR #38/u);
  }
  // An agent's own closed shell lingers under it the same way.
  const poppy = bgTree("corpus/02-parked", {}, [], null, (d) => ({ ...d,
    tasks: (d.tasks as TreeTask[]).map((t) => t.bgTasks?.length === 2
      ? { ...t, bgTasks: [t.bgTasks[0]],
        bgEnded: [{ ...t.bgTasks[1], end: NOW - 1 }] } : t) }), 5);
  const at = poppy.findIndex((l) => l.includes("Poppy"));
  assert.match(poppy[at + 2], /^│  ╰─ 💻 +⚫ Build the docs site/u);
  const shown = bgText(ST, { id: "x", kind: "bash", label: "x",
    start: NOW - 60, end: NOW - 1 }, "Build", NOW);
  assert.equal(shown, "💻 shell · ⚫ ended · ⌛ 59s · Build");
});

test("a shell with no label draws its kind, and one with no start no ⌛",
() => {
  const lines = bgTree("corpus/02-parked", {}, [], null, (d) => ({ ...d,
    main_background: [{ id: "a", kind: "bash", label: " ", start: null },
      { id: "b", kind: "monitor", label: "", start: NOW - 5 }] }));
  assert.match(lines.at(-2)!, /^├─ 💻 +🟢 shell$/u);
  assert.match(lines.at(-1)!, /^╰─ 📡 +🟢 monitor +⌛  5s$/u);
});

test("shells and Monitors count against no cap", () => {
  const capped = bgTree("corpus/02-parked", { cap: 2 });
  assert.ok(capped.some((l) => /… +\d+ more/u.test(l)));
  assert.ok(capped.some((l) => l.includes("Run the plugin tests")));
  assert.ok(capped.some((l) => l.includes("Watch PR #38")));
  const none = bgTree("corpus/02-parked", { cap: 0 });
  assert.equal(none.filter((l) => /[💻📡] +🟢/u.test(l)).length, 2);
});

test("an opened thread leaves its 💻 📡 counts to its rows, and a folded " +
  "one hides the rows and counts them", () => {
  const opened = bgTree("corpus/02-parked");
  const row = (lines: string[], name: string) =>
    lines.find((l) => l.includes(name))!;
  assert.match(row(opened, "Pine"), /├⊟ 🔩 +🟡 Pine/u);
  assert.match(row(opened, "Poppy"), /├⊟ 🔩 +🟡 Poppy/u);
  assert.match(row(opened, "main"), /^⊟ 🧵 +🟢 main/u);
  const folded = bgTree("corpus/02-parked", { folds: { p1: true, p2: true } });
  assert.match(row(folded, "Pine"), /├⊞ 🔩 +🟡 💻1 Pine/u);
  assert.match(row(folded, "Poppy"), /├⊞ 🔩 +🟡 💻1 📡1 Poppy/u);
  assert.ok(!folded.some((l) => l.includes("Build the docs site")));
  const main = bgTree("corpus/02-parked", { folds: { main: true } });
  assert.deepEqual(main, [main[0]]);
  assert.match(main[0], /^⊞ 🧵 +🟢 💻1 📡1 main/u);
});

test("the agent hide path hides the shells and Monitors with the agents",
() => {
  const lines = bgTree("corpus/02-parked", {}, ["agent"]);
  assert.ok(!lines.some((l) => /[💻📡] +🟢/u.test(l)));
});

/** The band's tree over the baseline status document, its turn opened an
 * hour before the clock, with corpus/01-mixed's agents, in `phase` and with
 * `rows.subagents.live` at `agents`, as plain lines at 200 columns. */
function bandTree(phase: Phase, agents: Live): string[] {
  const base = readFigures("status", "01-baseline");
  const fig: Dict = { ...base,
    transcript: { ...base.transcript as Dict, turn_s: NOW - 3600 },
    agents: corpusAgents("corpus/01-mixed", "") };
  const opts: BandOpts = { rate: null, phase, agents,
    live: { turn: "running", agent: "always", session: "always" },
    places: { turn: "above", agent: "above", session: "above" } };
  const rows = treeOf(ST, fig, bandRows(ST, fig, opts), opts, []);
  const keys = fixedKeys(ST, 200, []);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, [])))
    .trimEnd());
}

test("between turns live \"always\" keeps the running agents under 🧵 " +
  "and draws no grouped row of the ended ones, as the running turn " +
  "draws none", () => {
  const running = bandTree("running", "always");
  assert.ok(!running.some((l) => l.includes("done")));
  const done = bandTree("done", "always");
  assert.match(done[1], /^╰⊟ 🧵 +⚫ main/u);
  assert.ok(done.some((l) => /🔍 +🟢 Marigold/u.test(l)));
  assert.ok(!done.some((l) => l.includes("done")));
  assert.ok(!done.some((l) => l.includes("Daisy")));
});

test("between turns live \"running\" draws no agents", () => {
  assert.ok(bandTree("running", "running").some((l) =>
    l.includes("Marigold")));
  const done = bandTree("done", "running");
  assert.equal(done.length, 2);
  assert.match(done[1], /^╰─ 🧵 +⚫ main/u);
});

/** The tree's rows over a corpus case, as `tree` lays them out, before
 * they are drawn. */
function treeOfCase(id: string, over: Partial<TreeInput> = {},
  turnStart: number | null = null): Row[] {
  const doc = corpusAgents(id, "Checking the binary");
  const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
  return treeRows(ST, { session: blank("session"),
    main: blank("main"), turn: blank("turn"),
    workspace: { project: "repo", branch: "feat/x", dirty: false, dir: "",
      pr: "38", style: "" },
    mainPhase: "🟢", mainInbox: 0, mainProgress: doc.main_progress as string,
    turnPhase: "🟢", agents: { tasks: doc.tasks as TreeTask[],
      limits: LIMITS, now: NOW, turnStart }, cap: 6, ...over }, []);
}

/** The part of a span's text its press is on, all of it where its press
 * names no part. */
function pressedText(s: Span): string {
  const at = s.press?.at;
  return at ? Array.from(s.text).slice(at[0], at[1]).join("") : s.text;
}

/** Each press a row's label carries, as `kind:what`, in order, once per
 * run of spans that press it. */
function pressesOf(r: Row): string[] {
  const out: string[] = [];
  for (const s of r.label.flatMap((p) => p.spans)) {
    const p = s.press;
    const k = !p ? "" : p.kind === "fold" ? "fold:" + p.key + ":" + p.shut
      : p.kind === "view" ? "view:" + (p.agent ?? "main")
      : p.kind === "task" ? "task:" + p.row
      : "link:" + p.href;
    if (k && out.at(-1) !== k) out.push(k);
  }
  return out;
}

test("every row with children presses its fold, under its key, with its " +
  "default, and every agent's label, 🧵's and 🎤's switch the view", () => {
  const rows = treeOfCase("corpus/03-tree", { cap: 2 });
  const marks = rows.map((r) => pressesOf(r).filter((p) =>
    p.startsWith("fold:")));
  assert.deepEqual(marks, [["fold:session:false"], ["fold:main:false"], [],
    ["fold:t1:false"], [], ["fold:t1/more:true"], ["fold:main/more:true"]]);
  const views = rows.map((r) => pressesOf(r).filter((p) =>
    p.startsWith("view:")));
  assert.deepEqual(views, [[], ["view:main"], ["view:main"], ["view:t1"],
    ["view:t2"], [], []]);
  // 🎤's press is on its label alone: it has no fold.
  assert.deepEqual(pressesOf(rows[2]), ["view:main"]);
  // The press is on the mark alone, not the line's bars before it.
  assert.deepEqual(rows[5].label[0].spans.map((s) => pressedText(s)),
    ["⊞"]);
  // The blanks that set a circle in its column press what the glyph
  // does, so the head presses as one run; 🎮's press nothing.
  const head = rows[3].label.find((p) => p.path === "name.kind")!;
  assert.deepEqual(head.spans.map((s) => s.text.trim() ? s.text : "_"),
    ["🎩", "_", "🟢", "_", "_"]);
  assert.ok(head.spans.every((s) => s.press?.kind === "view"));
  assert.deepEqual(rows[0].label[1].spans.map((s) => s.press),
    [undefined, undefined]);
});

test("each open shell's and Monitor's label toasts what the band knows " +
  "of it, the whole of the label pressing", () => {
  const doc = withBackground(corpusAgents("corpus/02-parked", ""), NOW);
  const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
  const rows = treeRows(ST, { session: null, main: blank("main"),
    turn: blank("turn"), workspace: null, mainPhase: "🟢", mainInbox: 0,
    mainProgress: "", turnPhase: "🟢", agents: {
      tasks: doc.tasks as TreeTask[], limits: LIMITS, now: NOW,
      turnStart: null, mainBackground: doc.main_background as BgTask[],
      home: "/Users/u" },
    cap: 10 }, []);
  const bg = (doc.main_background as BgTask[]).map((b) => b.id);
  const tail = rows.slice(-bg.length);
  assert.deepEqual(tail.map(pressesOf), bg.map((id) => ["task:" + id]));
  // Every span after the tree line presses it, the kind glyph included.
  for (const r of tail) {
    assert.ok(r.label.slice(1).every((p) => p.spans.every((s) =>
      s.press?.kind === "task" && s.press.at === undefined)));
  }
  const texts = tail.map((r) => {
    const p = r.label[1].spans[0].press;
    return p?.kind === "task" ? p.text : "";
  });
  assert.deepEqual(texts, [
    "💻 shell · 🟢 running · ⌛ 6.2m · Run the plugin tests · " +
      "$ npm test -- --watch · ⤷ /private/tmp/…/b3qupkikw.output",
    "📡 Monitor · 🟢 running · ⌛ 25m · Watch PR #38 for comments · " +
      "$ gh pr view 38 --comments ⏎ sleep 30 · ⤷ ~/.cache/tasks/mmon.output"]);
});

test("a task's toast leaves out ⌛ where its start is not known", () => {
  const b = (kind: string, start: number | null): BgTask =>
    ({ id: "x", kind, label: "", start });
  assert.equal(bgText(ST, b("bash", null), "shell", NOW),
    "💻 shell · 🟢 running · shell");
  assert.equal(bgText(ST, b("monitor", NOW - 5), "monitor", NOW),
    "📡 Monitor · 🟢 running · ⌛ 5s · monitor");
});

test("a task's toast gives its command once: the label is left out where " +
  "it is the command's own first line", () => {
  const b: BgTask = { id: "x", kind: "bash", label: "make docs",
    start: NOW - 5, command: "make docs ⏎ open site", output: "" };
  assert.equal(bgText(ST, b, "make docs", NOW),
    "💻 shell · 🟢 running · ⌛ 5s · $ make docs ⏎ open site");
  assert.equal(bgText(ST, { ...b, label: "Build", end: NOW - 1 }, "Build",
    NOW, "/Users/u"),
  "💻 shell · ⚫ ended · ⌛ 4s · Build · $ make docs ⏎ open site");
});

test("a task's output file is drawn with ~ for home, and a long one as its " +
  "first two folders and its file name", () => {
  assert.equal(bgPath("/Users/u/x/y.output", "/Users/u"), "~/x/y.output");
  assert.equal(bgPath("/Users/uv/y.output", "/Users/u"), "/Users/uv/y.output");
  assert.equal(bgPath("/Users/u/x/y.output"), "/Users/u/x/y.output");
  const long = "/private/tmp/" + "d".repeat(80) + "/tasks/b1.output";
  assert.equal(bgPath(long, "/Users/u"), "/private/tmp/…/b1.output");
  // Too few folders to leave any out: drawn whole however long.
  assert.equal(bgPath("/Users/u/" + "d".repeat(80) + "/b1.output",
    "/Users/u"), "~/" + "d".repeat(80) + "/b1.output");
  assert.equal(bgPath("/Users/u/a/" + "d".repeat(80) + "/b1.output",
    "/Users/u"), "~/a/…/b1.output");
});

test("the presses change nothing drawn", () => {
  const keys = fixedKeys(ST, 200, []);
  const bare = (r: Row): Row => ({ ...r, label: r.label.map((p) => ({ ...p,
    spans: p.spans.map((s) => span(s.text, s.colour, s.dim, s.bold,
      s.bg)) })) });
  const rows = treeOfCase("corpus/03-tree", { repo: "https://github.com/o/r" });
  assert.ok(rows.some((r) => r.label.some((p) => p.spans.some((s) =>
    s.press))));
  assert.deepEqual(rows.map((r) => join(draw(ST, r, keys, 200, []))),
    rows.map((r) => join(draw(ST, bare(r), keys, 200, []))));
});

test("🎮 and 🧵 fold everything under them", () => {
  const root = tree("corpus/03-tree", { folds: { session: true } });
  assert.equal(root.length, 1);
  assert.match(root[0], /^⊞ 🎮/u);
  const main = tree("corpus/03-tree", { folds: { main: true } });
  assert.equal(main.length, 2);
  assert.match(main[1], /^╰⊞ 🧵 +🟢 main/u);
});

test("an opened … N more lists its agents under it", () => {
  const more = tree("corpus/03-tree", { cap: 2, folds: { "main/more": false } });
  const at = more.findIndex((l) => /… +1 more/u.test(l));
  assert.match(more[at], /^   ╰⊟ … +1 more/u);
  assert.match(more[at + 1], /^      ╰─ 🔍 +🟢 Moss/u);
});

test("🎮's 📦 🌿 🔀 link to the repository, its branch and its pull " +
  "request, with the blanks after each pressing nothing", () => {
  const repo = "https://github.com/o/r";
  const root = treeOfCase("corpus/03-tree", { repo })[0];
  assert.deepEqual(pressesOf(root), ["fold:session:false",
    "link:" + repo, "link:" + repo + "/tree/feat/x",
    "link:" + repo + "/pull/38"]);
  const linked = root.label.flatMap((p) => p.spans).filter((s) =>
    s.press?.kind === "link");
  assert.deepEqual(linked.map((s) => pressedText(s)),
    ["📦repo", "🌿feat/x", "🔀#38"]);
  assert.deepEqual(pressesOf(treeOfCase("corpus/03-tree")[0]),
    ["fold:session:false"]);
  assert.deepEqual(workspaceLinks(null, null), {});
  assert.deepEqual(workspaceLinks(repo, { project: "r", branch: "",
    dirty: false, dir: "", pr: "", style: "" }),
  { "workspace.project": repo });
});

test("an ended agent's folds go, its grouped rows' with them, and 🎮's " +
  "and 🧵's stay", () => {
  const folds = { session: true, main: false, "main/more": false,
    t1: true, "t1/more": false, t2: true, gone: true,
    "gone/more": false };
  const tasks = [{ id: "t1", status: "running" },
    { id: "t2", status: "completed" }, { id: "t3", status: "failed" }];
  assert.deepEqual(pruneFolds(folds, tasks), { session: true, main: false,
    "main/more": false, t1: true, "t1/more": false });
  const kept = { session: true, t1: false };
  assert.equal(pruneFolds(kept, tasks), kept);
  assert.equal(groupFold("t1", "more"), "t1/more");
  assert.equal(foldShut({}, "main/more", true), true);
  assert.equal(foldShut({ "main/more": false }, "main/more", true), false);
});

test("the repository's address on GitHub is read off its remote, in each " +
  "form git takes it, and none for another host", () => {
  for (const url of ["git@github.com:o/r.git", "git@github.com:o/r",
    "https://github.com/o/r.git", "https://github.com/o/r/",
    "ssh://git@github.com/o/r.git", "ssh://git@github.com:22/o/r.git",
    "https://user@github.com/o/r\n"]) {
    assert.equal(githubRepo(url), "https://github.com/o/r", url);
  }
  assert.equal(githubRepo("git@gitlab.com:o/r.git"), null);
  assert.equal(githubRepo("/srv/git/r.git"), null);
  assert.equal(githubRepo(""), null);
});

/** The stamped tree of a corpus case, as the receipt draws it: 🧵 the
 * parent, 🎤 🏁 under it, the agents the turn opened at `turnStart` ran,
 * with each agent's status as `statuses` gives it. */
function stamped(id: string, turnStart: number | null = null,
  over: Partial<TreeInput> = {},
  statuses: { [id: string]: string } = {}): string[] {
  return tree(id, { session: null, mainPhase: "⚫", turnPhase: "🏁",
    stamped: true, cap: 2, ...over }, [], turnStart, statuses);
}

/** corpus/03-tree with every agent completed. */
const TREE_DONE = Object.fromEntries(
  ["t1", "t2", "t3", "t4", "t5", "m1"].map((id) => [id, "completed"]));

/** Each line's tree line: what stands before its first glyph. */
function lines(drawn: readonly string[]): string[] {
  return drawn.map((l) => /^[ │├╰─⊟⊞]*/u.exec(l)![0]);
}

test("stamped, the tree lists every agent opened, each under the agent " +
  "that started it, with no cap, no grouped rows and no fold marks", () => {
  const drawn = stamped("corpus/03-tree", null, {}, TREE_DONE);
  assert.deepEqual(lines(drawn), ["", "├─ ", "├─ ", "│  ╰─ ", "├─ ",
    "│  ├─ ", "│  ╰─ ", "│     ╰─ ", "│        ╰─ ", "╰─ "]);
  assert.match(drawn[0], /^🧵 +⚫ main  Checking the binary/u);
  assert.match(drawn[1], /^├─ 🎤 +🏁 turn$/u);
  // An ended agent keeps the agents it started, and draws 🏁.
  assert.match(drawn[2], /🏁 Gourd/u);
  assert.match(drawn[3], /🏁 Garlic/u);
  assert.match(drawn[4], /🏁 🤏2 Trunk/u);
  assert.match(drawn[9], /🏁 Moss/u);
  assert.ok(!drawn.some((l) => /more|done|👶🏻/u.test(l)));
  // Folds kept for the band change nothing stamped.
  assert.deepEqual(stamped("corpus/03-tree", null,
    { folds: { t1: true, main: true } }, TREE_DONE), drawn);
});

test("stamped, an agent still running or paused is left for a later " +
  "receipt, and one it started that has ended hangs from the next one up",
() => {
  const drawn = stamped("corpus/03-tree");
  assert.deepEqual(lines(drawn), ["", "├─ ", "╰─ ", "   ╰─ "]);
  assert.ok(!drawn.some((l) => /🟢|🟡/u.test(l)));
  // Thorn runs: Tendril, ended, stands under 🧵 with Tip under it.
  const under = stamped("corpus/03-tree", null, {},
    { t4: "completed", t5: "completed" });
  const at = (name: string): number =>
    under.findIndex((l) => l.includes(name));
  assert.match(lines(under)[at("Tendril")], /^[├╰]─ $/u);
  assert.match(lines(under)[at("Tip")], /^[│ ]  ╰─ $/u);
  assert.equal(at("Tip"), at("Tendril") + 1);
  assert.match(under[at("Tendril")], /🏁 Tendril/u);
  assert.ok(!under.some((l) => /Trunk|Thorn/u.test(l)));
  // One with a running agent under it is still at work: not stamped.
  assert.ok(!stamped("corpus/03-tree", null, {}, { t3: "completed" })
    .some((l) => l.includes("Thorn")));
});

test("stamped, the tree holds only the agents the turn ran, and 🏁 on " +
  "each that ended, failed or was killed", () => {
  const all = stamped("corpus/01-mixed");
  for (const name of ["Daisy", "Fern", "Kale", "Elm"]) {
    assert.match(all.find((l) => l.includes(name))!, /🏁 /u, name);
  }
  assert.ok(!all.some((l) => l.includes("⚫") && !l.includes("main")));
  // Started, or last seen, since the turn opened.
  const turn = stamped("corpus/01-mixed", 1786845500);
  assert.ok(!turn.some((l) => l.includes("Daisy") || l.includes("Fern")));
  for (const name of ["Kale", "Elm"]) {
    assert.ok(turn.some((l) => l.includes(name)), name);
  }
  // Running, or not yet started, so not stamped.
  for (const name of ["Clover", "Quince"]) {
    assert.ok(!turn.some((l) => l.includes(name)), name);
  }
});

test("stampedSplit owes a row to an agent still at work, and stamps it " +
  "on the first receipt after it ends, though it wrote nothing in that turn",
() => {
  const doc = corpusAgents("corpus/01-mixed", "x");
  const tasks = doc.tasks as TreeTask[];
  const a = (turnStart: number | null, owed: string[] = [],
    done: string[] = []) => ({ limits: LIMITS, now: NOW,
    turnStart, owed, tasks: tasks.map((t) => done.includes(String(t.task.id))
      ? { ...t, task: { ...t.task, status: "completed" } } : t) });
  // At the turn's end Clover runs: owed, not stamped.
  const first = stampedSplit(a(1786845500));
  assert.ok(first.owe.includes("r4"));
  assert.ok(!first.stamp.has("r4"));
  // It ends between turns; the next turn opens after its last record.
  const quiet = 1786846990;
  assert.ok(!stampedSplit(a(quiet, [], ["r4"])).stamp.has("r4"));
  const next = stampedSplit(a(quiet, first.owe as string[], ["r4"]));
  assert.ok(next.stamp.has("r4"));
  assert.ok(!next.owe.includes("r4"));
  // The ones still running stay owed.
  assert.ok(next.owe.includes("r1"));
});

test("stamped, no row presses anything", () => {
  const rows = treeOfCase("corpus/03-tree", { stamped: true,
    repo: "https://github.com/o/r" });
  assert.deepEqual(rows.flatMap(pressesOf), []);
  assert.match(stripAnsi(join(rows[0].label.flatMap((p) => p.spans))),
    /^🎮 +📦repo/u);
});

/** The tree over corpus/02-parked's agents at `now`, with Sage (s1) ended
 * as `status` on its own last report `eta` and its last record 200s
 * before NOW, kept by a finished-within long enough to draw it, as plain
 * lines. */
function endedTree(status: string, eta: readonly number[],
  now: number): string[] {
  const doc = corpusAgents("corpus/02-parked", "");
  const tasks = (doc.tasks as TreeTask[]).map((t) => t.task.id === "s1"
    ? { ...t, task: { ...t.task, status },
      usage: { ...(t.usage as Dict), eta, last_epoch: NOW - 200,
        background: [] } } as TreeTask : t);
  const rows = treeRows(ST, { session: null, main: null, turn: null,
    workspace: null, mainPhase: "🟢", mainInbox: 0, mainProgress: "",
    turnPhase: "🟢", agents: { tasks, limits: LIMITS, now,
      turnStart: NOW - 3600, linger: 3600 }, cap: 10 }, []);
  const keys = fixedKeys(ST, 200, []);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, []))));
}

test("an ended agent that signed off at zero draws no ⛳, and one that " +
  "did not keeps its overrun frozen at its end", () => {
  const sage = (ls: string[]) => ls.find((l) => l.includes("Sage"))!;
  assert.ok(!sage(endedTree("completed", [NOW - 300, 0], NOW))
    .includes("⛳"));
  for (const at of [NOW, NOW + 600]) {
    assert.match(sage(endedTree("killed", [NOW - 500, 120], at)),
      /⛳ {2}\+3m/u);
  }
});

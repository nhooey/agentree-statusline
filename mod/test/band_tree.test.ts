// The band's tree (band_tree.ts) and the subagents' facts it draws
// (subagent_tasks.ts): agentUsageOf against claude.py's agent_usage_of
// over the fixture agents, the progress update off a transcript's tail,
// and the tree's lines, groups, cap and folds over the panel corpus's
// tasks.  The drawn rows themselves are pinned by the rows' cases
// (rows.test.ts, gen-row-cases.ts's tree cases).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { settings, stripAnsi, visWidth } from "../src/formatting.ts";
import { join, span } from "../src/spans.ts";
import type { Span } from "../src/spans.ts";
import type { Dict } from "../src/py.ts";
import { githubRepo } from "../src/github.ts";
import { foldAgentBytes, newAgentFold } from "../src/claude_records.ts";
import type { BgTask } from "../src/claude_records.ts";
import {
  agentClock, agentShares, agentUsageOf, inboxTargets, progressOf,
  taskStatus, treeTasks,
} from "../src/subagent_tasks.ts";
import { inboxCounts } from "../src/claude_records_node.ts";
import type { TreeTask } from "../src/subagent_tasks.ts";
import {
  foldShut, groupFold, MAIN_FOLD, pruneFolds, treeRows, workspaceLinks,
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const ST = settings({}, true, false, 5);
const NOW = 1786847000;
const LIMITS = { session_pct: "15", session_reset: "", session_share: "",
  weekly_pct: "87", weekly_reset: "", weekly_share: "", session_turn: "",
  weekly_turn: "", fable_pct: "", fable_reset: "" };

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

test("agentUsageOf is claude.py's agent_usage_of, field for field, over " +
  "every fixture agent", () => {
  const files = agentFiles();
  assert.ok(files.length > 3);
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import sys, json\nfrom coding_agent_usage_line import claude\n" +
    "print(json.dumps([claude.read_agent_usage(p)._asdict() " +
    "for p in sys.argv[1:]]))", ...files], { cwd: REPO, encoding: "utf8" }));
  files.forEach((f, i) => {
    const fold = newAgentFold();
    foldAgentBytes(fold, fs.readFileSync(f), true);
    const got = JSON.parse(JSON.stringify(agentUsageOf(fold))) as Dict;
    const want = py[i] as Dict;
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), f);
    for (const k of Object.keys(want)) {
      assert.deepEqual(got[k], want[k], path.basename(f) + " " + k);
    }
  });
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
  const lines = tree("03-tree@220");
  assert.deepEqual(heads(lines), ["⊟ ", "╰⊟ ", "   ├─ ", "   ├⊟ ",
    "   │  ├─ ", "   │  ╰⊟ ", "   │     ╰⊟ ", "   │        ╰─ ",
    "   ╰─ "]);
  assert.match(lines[0], /^⊟ 🎮 📦repo 🌿main  🔀#38/u);
  assert.match(lines[1], /^╰⊟ 🧵🟢 main  Checking the binary/u);
  assert.match(lines[2], /^   ├─ 🎤🟢 turn$/u);
});

test("🎮 draws 📛 and the session's name before 📦, in its colour, with " +
  "no press; none without a name, and workspace.name hides it", () => {
  const named = { agents: null, sessionName: "Statusline",
    sessionColour: "purple" };
  assert.match(tree("03-tree@220", named)[0],
    /^⊟ 🎮 📛Statusline 📦repo 🌿main  🔀#38/u);
  assert.match(tree("03-tree@220", { agents: null })[0],
    /^⊟ 🎮 📦repo 🌿main  🔀#38/u);
  assert.match(tree("03-tree@220", named, ["session.workspace.name"])[0],
    /^⊟ 🎮 📦repo 🌿main  🔀#38/u);
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
  assert.deepEqual(badge("purple").spans.map((s) => s.press), [undefined]);
  assert.equal(visWidth(spec.E_NAME, ST.widths), 2);
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
    assert.equal(at(60), "🎮 📛Statusline 📦repo 🌿main  🔀#38  ");
    assert.equal(at(36), "🎮 📛Statusline 📦repo 🌿main  ");
    assert.equal(at(22), "🎮 📦repo 🌿main  ");
    assert.equal(at(12), "🎮 📦repo …");
  });

test("🎤 alone under 🧵 main gives 🧵 a fold mark", () => {
  const lines = tree("03-tree@220", { agents: null });
  assert.deepEqual(heads(lines), ["⊟ ", "╰⊟ ", "   ╰─ "]);
  assert.match(lines[2], /^   ╰─ 🎤🟢 turn$/u);
});

test("🧵 main folded hides 🎤 with its agents", () => {
  for (const agents of [undefined, null]) {
    const lines = tree("03-tree@220", { folds: { main: true },
      ...(agents === null ? { agents } : {}) });
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^╰⊞ 🧵🟢 main  Checking the binary$/u);
    assert.ok(!lines.some((l) => l.includes("🎤")));
  }
});

test("with no turn open, 🧵 main draws as before", () => {
  const bare = tree("03-tree@220", { turn: null, agents: null });
  assert.deepEqual(heads(bare), ["⊟ ", "╰─ "]);
  const lines = tree("03-tree@220", { turn: null });
  assert.deepEqual(heads(lines).slice(0, 3), ["⊟ ", "╰⊟ ", "   ├⊟ "]);
  assert.ok(!lines.some((l) => l.includes("🎤")));
});

test("without 🧵 main, 🎤 is the root's child, before the agents", () => {
  const lines = tree("03-tree@220", { main: null, agents: null });
  assert.deepEqual(heads(lines), ["⊟ ", "╰─ "]);
  const agents = tree("03-tree@220", { main: null });
  assert.deepEqual(heads(agents).slice(0, 3), ["⊟ ", "├─ ", "├⊟ "]);
  assert.match(agents[1], /^├─ 🎤🟢 turn$/u);
});

test("without 🎮, 🧵 main stands at the top with 🎤 under it", () => {
  const lines = tree("03-tree@220", { session: null, agents: null });
  assert.deepEqual(heads(lines), ["⊟ ", "╰─ "]);
  assert.match(lines[0], /^⊟ 🧵🟢 main/u);
  const bare = tree("03-tree@220", { session: null, main: null,
    agents: null });
  assert.deepEqual(bare.map((l) => l.slice(0, 2)), ["🎤"]);
});

test("every figure keeps its column on every row of the tree", () => {
  const lines = tree("03-tree@220");
  const at = (l: string) => visWidth(l.slice(0, l.indexOf("⌛")), ST.widths);
  const agents = lines.slice(3);
  assert.equal(new Set(agents.map(at)).size, 1);
});

test("an agent's label packs its own counts before its name, with no " +
  "blank slots for the counts other rows have", () => {
  const lines = tree("03-tree@220");
  const label = (name: string) => lines.find((l) => l.includes(name))!;
  assert.match(label("Trunk"), /🎩🟢 🤏2 Trunk/u);
  assert.match(label("Twig"), /🔍🟢 📨1 Twig/u);
  assert.match(label("Tendril"), /🔩🟢 Tendril/u);
  assert.match(label("Moss"), /🔍🟢 Moss/u);
});

test("past the cap the later siblings fold into their parent's … N more, " +
  "and every shown row's parents stay", () => {
  const lines = tree("03-tree@220", { cap: 2 });
  assert.equal(lines.length, 7);
  assert.match(lines[3], /^   ├⊟ 🎩🟢 🤏2 Trunk/u);
  assert.match(lines[4], /^   │  ├─ 🔍🟢 📨1 Twig/u);
  assert.match(lines[5], /^   │  ╰⊞ … 3 more/u);
  assert.match(lines[6], /^   ╰⊞ … 1 more/u);
});

test("a folded agent draws ⊞ and counts every agent hidden under it", () => {
  const lines = tree("03-tree@220", { folds: { t1: true } });
  const trunk = lines.find((l) => l.includes("Trunk"))!;
  assert.match(trunk, /├⊞ 🎩🟢 👶🏻4 🤏2 Trunk/u);
  assert.ok(!lines.some((l) => l.includes("Twig")));
});

test("✅ N done sums the agents that ended since the turn opened, under " +
  "🧵 main", () => {
  const lines = tree("01-mixed@220", {}, [], NOW - 3600);
  const done = lines.find((l) => l.includes("done"))!;
  assert.match(done, /^   ╰⊞ ✅ 4 done +✅  18m/u);
  // Only those since the turn opened.
  assert.match(tree("01-mixed@220", {}, [], 1786845500).find((l) =>
    l.includes("done"))!, /✅ 2 done/u);
  assert.ok(!lines.some((l) => l.includes("Daisy")));
  assert.ok(!tree("01-mixed@220").some((l) => l.includes("done")));
});

test("each thread's latest text follows its name, working or ended, and " +
  "chat.progress hides it", () => {
  assert.ok(tree("01-mixed@220").some((l) =>
    /Marigold  Running the suite/u.test(l)));
  assert.ok(!tree("01-mixed@220", {}, ["*.chat.progress"]).some((l) =>
    l.includes("Running the suite") || l.includes("Checking the binary")));
  assert.ok(tree("01-mixed@220", { mainPhase: "⚫" }).some((l) =>
    /🧵⚫ main  Checking the binary/u.test(l)));
});

test("🎤 draws the prompt typed last after its name, and chat.prompt " +
  "hides it", () => {
  const over = { agents: null, turnPrompt: "Draw the\n  prompt" };
  assert.match(tree("03-tree@220", over)[2],
    /^   ╰─ 🎤🟢 turn  Draw the¶ prompt$/u);
  assert.match(tree("03-tree@220", over, ["*.chat.prompt"])[2],
    /^   ╰─ 🎤🟢 turn$/u);
});

test("a waiting agent is paused and live: 🟡, its 🛫 what it waits on " +
  "and for how long since its last record, its progress update drawn, " +
  "counted toward the cap and not in ✅ N done", () => {
  const turn = NOW - 3600;
  const waiting = { p1: "waiting", x1: "waiting" };
  const lines = tree("02-parked@220", { cap: 10 }, [], turn, waiting);
  const row = (name: string) => lines.find((l) => l.includes(name))!;
  // Pine waits on its background shell, 980s after its last record.
  assert.match(row("Pine"), /🔩🟡 💻1 Pine .*💻  16m/u);
  // Yarrow waits on nothing its transcript names.
  assert.match(row("Yarrow"), /🔍🟡 Yarrow .*📋  13m/u);
  assert.match(tree("02-parked@220", {}, [], turn).find((l) =>
    l.includes("done"))!, /✅ 1 done/u);
  assert.ok(!lines.some((l) => l.includes("done")));
  // Each takes a row under the cap like any other live agent.
  const capped = tree("02-parked@220", { cap: 7 }, [], turn, waiting);
  assert.ok(capped.some((l) => /… 1 more/u.test(l)));
  assert.ok(!tree("02-parked@220", { cap: 7 }, [], turn).some((l) =>
    l.includes("more")));
});

test("a waiting agent's progress update stays drawn", () => {
  const doc = corpusAgents("02-parked@220", "");
  const tasks = (doc.tasks as TreeTask[]).map((t) => t.task.id === "x1"
    ? { ...t, task: { ...t.task, status: "waiting" }, progress: "Held" } : t);
  const rows = treeRows(ST, { session: null, main: null, turn: null,
    workspace: null, mainPhase: "🟢", mainInbox: 0, mainProgress: "",
    turnPhase: "🟢", agents: { tasks, limits: LIMITS, now: NOW,
      turnStart: null }, cap: 10 }, []);
  const keys = fixedKeys(ST, 200, []);
  const lines = rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, []))));
  assert.ok(lines.some((l) => /🔍🟡 Yarrow  Held/u.test(l)));
});

/** The tree under 🧵 main over corpus case `id`'s agents with open
 * background tasks (withBackground: a shell and a Monitor of the main
 * thread's, and each agent's usage's), `edit` changing the document
 * first, as plain lines at 200 columns. */
function bgTree(id: string, over: Partial<TreeInput> = {},
  hide: string[] = [], turnStart: number | null = null,
  edit: (doc: Dict) => Dict = (d) => d): string[] {
  const doc = edit(withBackground(corpusAgents(id, ""), NOW));
  const blank = (scope: string): Row => ({ scope, label: [], cells: {} });
  const rows = treeRows(ST, { session: null, main: blank("main"),
    turn: blank("turn"), workspace: null, mainPhase: "🟢", mainInbox: 0,
    mainProgress: "", turnPhase: "🟢", agents: {
      tasks: doc.tasks as TreeTask[], limits: LIMITS, now: NOW, turnStart,
      mainBackground: doc.main_background as BgTask[] }, cap: 10, ...over },
  hide);
  const keys = fixedKeys(ST, 200, hide);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, hide)))
    .trimEnd());
}

test("each open shell and Monitor is a leaf under the thread that " +
  "started it, after its agents, with its label and how long it has run",
() => {
  const lines = bgTree("02-parked@220");
  const at = (text: string) => lines.findIndex((l) => l.includes(text));
  // Under 🧵 main: 🎤 first, its agents, then its shell and its Monitor.
  assert.match(lines[1], /^├─ 🎤🟢 turn/u);
  assert.match(lines.at(-2)!, /^├─ 💻🟢 Run the plugin tests +⌛6\.2m$/u);
  assert.match(lines.at(-1)!, /^╰─ 📡🟢 Watch PR #38 for comments +⌛ 25m$/u);
  assert.ok(at("Peony") < at("Run the plugin tests"));
  // Under Poppy, its Monitor and its shell, in the order they opened.
  const poppy = at("Poppy");
  assert.match(lines[poppy + 1], /^│  ├─ 📡🟢 Watch the CI checks +⌛2\.1m$/u);
  assert.match(lines[poppy + 2], /^│  ╰─ 💻🟢 Build the docs site +⌛2\.1m$/u);
  // Before ✅ N done, which stays last under 🧵.
  const done = bgTree("01-mixed@220", {}, [], NOW - 3600);
  assert.match(done.at(-2)!, /📡🟢 Watch PR #38/u);
  assert.match(done.at(-1)!, /✅ 4 done/u);
});

test("a shell with no label draws its kind, and one with no start no ⌛",
() => {
  const lines = bgTree("02-parked@220", {}, [], null, (d) => ({ ...d,
    main_background: [{ id: "a", kind: "bash", label: " ", start: null },
      { id: "b", kind: "monitor", label: "", start: NOW - 5 }] }));
  assert.match(lines.at(-2)!, /^├─ 💻🟢 shell$/u);
  assert.match(lines.at(-1)!, /^╰─ 📡🟢 monitor +⌛  5s$/u);
});

test("shells and Monitors count against no cap", () => {
  const capped = bgTree("02-parked@220", { cap: 2 });
  assert.ok(capped.some((l) => /… \d+ more/u.test(l)));
  assert.ok(capped.some((l) => l.includes("Run the plugin tests")));
  assert.ok(capped.some((l) => l.includes("Watch PR #38")));
  const none = bgTree("02-parked@220", { cap: 0 });
  assert.equal(none.filter((l) => /[💻📡]🟢/u.test(l)).length, 2);
});

test("an opened thread leaves its 💻 📡 counts to its rows, and a folded " +
  "one hides the rows and counts them", () => {
  const opened = bgTree("02-parked@220");
  const row = (lines: string[], name: string) =>
    lines.find((l) => l.includes(name))!;
  assert.match(row(opened, "Pine"), /├⊟ 🔩🟡 Pine/u);
  assert.match(row(opened, "Poppy"), /├⊟ 🔩🟡 Poppy/u);
  assert.match(row(opened, "main"), /^⊟ 🧵🟢 main/u);
  const folded = bgTree("02-parked@220", { folds: { p1: true, p2: true } });
  assert.match(row(folded, "Pine"), /├⊞ 🔩🟡 💻1 Pine/u);
  assert.match(row(folded, "Poppy"), /├⊞ 🔩🟡 💻1 📡1 Poppy/u);
  assert.ok(!folded.some((l) => l.includes("Build the docs site")));
  const main = bgTree("02-parked@220", { folds: { main: true } });
  assert.deepEqual(main, [main[0]]);
  assert.match(main[0], /^⊞ 🧵🟢 💻1 📡1 main/u);
});

test("the agent hide path hides the shells and Monitors with the agents",
() => {
  const lines = bgTree("02-parked@220", {}, ["agent"]);
  assert.ok(!lines.some((l) => /[💻📡]🟢/u.test(l)));
});

/** The band's tree over the baseline status document, its turn opened an
 * hour before the clock, with 01-mixed@220's agents, in `phase` and with
 * `rows.subagents.live` at `agents`, as plain lines at 200 columns. */
function bandTree(phase: Phase, agents: Live): string[] {
  const base = readFigures("status", "01-baseline");
  const fig: Dict = { ...base,
    transcript: { ...base.transcript as Dict, turn_s: NOW - 3600 },
    agents: corpusAgents("01-mixed@220", "") };
  const opts: BandOpts = { rate: null, phase, agents,
    live: { turn: "running", agent: "always", session: "always" },
    places: { turn: "above", agent: "above", session: "above" } };
  const rows = treeOf(ST, fig, bandRows(ST, fig, opts), opts, []);
  const keys = fixedKeys(ST, 200, []);
  return rows.map((r) => stripAnsi(join(draw(ST, r, keys, 200, [])))
    .trimEnd());
}

test("between turns live \"always\" keeps the running agents under 🧵 " +
  "and draws no ✅ N done, which the running turn draws", () => {
  const running = bandTree("running", "always");
  assert.ok(running.some((l) => /✅ 4 done/u.test(l)));
  const done = bandTree("done", "always");
  assert.match(done[1], /^╰⊟ 🧵⚫ main/u);
  assert.ok(done.some((l) => /🔍🟢 Marigold/u.test(l)));
  assert.ok(!done.some((l) => l.includes("done")));
  assert.ok(!done.some((l) => l.includes("Daisy")));
});

test("between turns live \"running\" draws no agents", () => {
  assert.ok(bandTree("running", "running").some((l) =>
    l.includes("Marigold")));
  const done = bandTree("done", "running");
  assert.equal(done.length, 2);
  assert.match(done[1], /^╰─ 🧵⚫ main/u);
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
      : "link:" + p.href;
    if (k && out.at(-1) !== k) out.push(k);
  }
  return out;
}

test("every row with children presses its fold, under its key, with its " +
  "default, and every agent's label, 🧵's and 🎤's switch the view", () => {
  const rows = treeOfCase("03-tree@220", { cap: 2 });
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
  const done = treeOfCase("01-mixed@220", {}, NOW - 3600);
  assert.deepEqual(pressesOf(done.at(-1)!), ["fold:main/done:true"]);
});

test("the presses change nothing drawn", () => {
  const keys = fixedKeys(ST, 200, []);
  const bare = (r: Row): Row => ({ ...r, label: r.label.map((p) => ({ ...p,
    spans: p.spans.map((s) => span(s.text, s.colour, s.dim, s.bold,
      s.bg)) })) });
  const rows = treeOfCase("03-tree@220", { repo: "https://github.com/o/r" });
  assert.ok(rows.some((r) => r.label.some((p) => p.spans.some((s) =>
    s.press))));
  assert.deepEqual(rows.map((r) => join(draw(ST, r, keys, 200, []))),
    rows.map((r) => join(draw(ST, bare(r), keys, 200, []))));
});

test("🎮 and 🧵 fold everything under them", () => {
  const root = tree("03-tree@220", { folds: { session: true } });
  assert.equal(root.length, 1);
  assert.match(root[0], /^⊞ 🎮/u);
  const main = tree("03-tree@220", { folds: { main: true } });
  assert.equal(main.length, 2);
  assert.match(main[1], /^╰⊞ 🧵🟢 main/u);
});

test("an opened … N more lists its agents under it, and an opened ✅ N " +
  "done the agents that ended", () => {
  const more = tree("03-tree@220", { cap: 2, folds: { "main/more": false } });
  const at = more.findIndex((l) => l.includes("… 1 more"));
  assert.match(more[at], /^   ╰⊟ … 1 more/u);
  assert.match(more[at + 1], /^      ╰─ 🔍🟢 Moss/u);
  const done = tree("01-mixed@220", { folds: { "main/done": false } }, [],
    NOW - 3600);
  const d = done.findIndex((l) => l.includes("4 done"));
  assert.match(done[d], /^   ╰⊟ ✅ 4 done/u);
  assert.equal(done.length, d + 5);
  for (const name of ["Daisy", "Fern", "Kale", "Elm"]) {
    assert.ok(done.slice(d + 1).some((l) => l.includes(name)), name);
  }
});

test("🎮's 📦 🌿 🔀 link to the repository, its branch and its pull " +
  "request, with the blanks after each pressing nothing", () => {
  const repo = "https://github.com/o/r";
  const root = treeOfCase("03-tree@220", { repo })[0];
  assert.deepEqual(pressesOf(root), ["fold:session:false",
    "link:" + repo, "link:" + repo + "/tree/feat/x",
    "link:" + repo + "/pull/38"]);
  const linked = root.label.flatMap((p) => p.spans).filter((s) =>
    s.press?.kind === "link");
  assert.deepEqual(linked.map((s) => pressedText(s)),
    ["📦repo", "🌿feat/x", "🔀#38"]);
  assert.deepEqual(pressesOf(treeOfCase("03-tree@220")[0]),
    ["fold:session:false"]);
  assert.deepEqual(workspaceLinks(null, null), {});
  assert.deepEqual(workspaceLinks(repo, { project: "r", branch: "",
    dirty: false, dir: "", pr: "", style: "" }),
  { "workspace.project": repo });
});

test("an ended agent's folds go, its grouped rows' with them, and 🎮's " +
  "and 🧵's stay", () => {
  const folds = { session: true, main: false, "main/more": false,
    "main/done": false, t1: true, "t1/more": false, t2: true, gone: true,
    "gone/more": false };
  const tasks = [{ id: "t1", status: "running" },
    { id: "t2", status: "completed" }, { id: "t3", status: "failed" }];
  assert.deepEqual(pruneFolds(folds, tasks), { session: true, main: false,
    "main/more": false, "main/done": false, t1: true, "t1/more": false });
  const kept = { session: true, t1: false };
  assert.equal(pruneFolds(kept, tasks), kept);
  assert.equal(groupFold("t1", "more"), "t1/more");
  assert.equal(foldShut({}, "main/done", true), true);
  assert.equal(foldShut({ "main/done": false }, "main/done", true), false);
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

/** 03-tree@220 with every agent completed. */
const TREE_DONE = Object.fromEntries(
  ["t1", "t2", "t3", "t4", "t5", "m1"].map((id) => [id, "completed"]));

/** Each line's tree line: what stands before its first glyph. */
function lines(drawn: readonly string[]): string[] {
  return drawn.map((l) => /^[ │├╰─⊟⊞]*/u.exec(l)![0]);
}

test("stamped, the tree lists every agent opened, each under the agent " +
  "that started it, with no cap, no grouped rows and no fold marks", () => {
  const drawn = stamped("03-tree@220", null, {}, TREE_DONE);
  assert.deepEqual(lines(drawn), ["", "├─ ", "├─ ", "│  ╰─ ", "├─ ",
    "│  ├─ ", "│  ╰─ ", "│     ╰─ ", "│        ╰─ ", "╰─ "]);
  assert.match(drawn[0], /^🧵⚫ main  Checking the binary/u);
  assert.match(drawn[1], /^├─ 🎤🏁 turn$/u);
  // An ended agent keeps the agents it started, and draws 🏁.
  assert.match(drawn[2], /🏁 Gourd/u);
  assert.match(drawn[3], /🏁 Garlic/u);
  assert.match(drawn[4], /🏁 🤏2 Trunk/u);
  assert.match(drawn[9], /🏁 Moss/u);
  assert.ok(!drawn.some((l) => /more|done|👶🏻/u.test(l)));
  // Folds kept for the band change nothing stamped.
  assert.deepEqual(stamped("03-tree@220", null,
    { folds: { t1: true, main: true } }, TREE_DONE), drawn);
});

test("stamped, an agent still running or paused is left for a later " +
  "receipt, and one it started that has ended hangs from the next one up",
() => {
  const drawn = stamped("03-tree@220");
  assert.deepEqual(lines(drawn), ["", "├─ ", "╰─ ", "   ╰─ "]);
  assert.ok(!drawn.some((l) => /🟢|🟡/u.test(l)));
  // Thorn runs: Tendril, ended, stands under 🧵 with Tip under it.
  const under = stamped("03-tree@220", null, {},
    { t4: "completed", t5: "completed" });
  const at = (name: string): number =>
    under.findIndex((l) => l.includes(name));
  assert.match(lines(under)[at("Tendril")], /^[├╰]─ $/u);
  assert.match(lines(under)[at("Tip")], /^[│ ]  ╰─ $/u);
  assert.equal(at("Tip"), at("Tendril") + 1);
  assert.match(under[at("Tendril")], /🏁 Tendril/u);
  assert.ok(!under.some((l) => /Trunk|Thorn/u.test(l)));
  // One with a running agent under it is still at work: not stamped.
  assert.ok(!stamped("03-tree@220", null, {}, { t3: "completed" })
    .some((l) => l.includes("Thorn")));
});

test("stamped, the tree holds only the agents the turn ran, and 🏁 on " +
  "each that ended, failed or was killed", () => {
  const all = stamped("01-mixed@220");
  for (const name of ["Daisy", "Fern", "Kale", "Elm"]) {
    assert.match(all.find((l) => l.includes(name))!, /🏁 /u, name);
  }
  assert.ok(!all.some((l) => l.includes("⚫") && !l.includes("main")));
  // Started, or last seen, since the turn opened.
  const turn = stamped("01-mixed@220", 1786845500);
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
  const doc = corpusAgents("01-mixed@220", "x");
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
  const rows = treeOfCase("03-tree@220", { stamped: true,
    repo: "https://github.com/o/r" });
  assert.deepEqual(rows.flatMap(pressesOf), []);
  assert.match(stripAnsi(join(rows[0].label.flatMap((p) => p.spans))),
    /^🎮 📦repo/u);
});

/** The tree over 02-parked@220's agents at `now`, with Sage (s1) ended
 * as `status` on its own last report `eta` and its last record 200s
 * before NOW, as plain lines. */
function endedTree(status: string, eta: readonly number[],
  now: number): string[] {
  const doc = corpusAgents("02-parked@220", "");
  const tasks = (doc.tasks as TreeTask[]).map((t) => t.task.id === "s1"
    ? { ...t, task: { ...t.task, status },
      usage: { ...(t.usage as Dict), eta, last_epoch: NOW - 200,
        background: [] } } as TreeTask : t);
  const rows = treeRows(ST, { session: null, main: null, turn: null,
    workspace: null, mainPhase: "🟢", mainInbox: 0, mainProgress: "",
    turnPhase: "🟢", agents: { tasks, limits: LIMITS, now,
      turnStart: NOW - 3600 }, cap: 10,
    folds: { [groupFold(MAIN_FOLD, "done")]: false } }, []);
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

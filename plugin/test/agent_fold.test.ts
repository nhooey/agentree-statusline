// agent_fold.ts: each fixture agent's fold, saved at each line end,
// digests as tests/fixtures/fold-saves.json holds it, which
// plugin/tools/gen-fold-saves.ts writes; and each text, read back, reads on
// to the last.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cr from "../src/claude_records_node.ts";
import {
  AGENT_FOLD_FORMAT, agentFoldOf, agentFoldText, FOLD_CHECK_BYTES,
  foldCandidates, foldDir, slotNames, tailDigest,
} from "../src/agent_fold.ts";
import { digest, foldSaves, lineEnds } from "./fold_saves.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../..");
process.chdir(REPO);

/** Every committed fixture agent transcript. */
const AGENTS = execFileSync("git", ["ls-files", "tests/fixtures"]).toString()
  .split("\n").filter((f) => f.endsWith(".jsonl") &&
    path.basename(f).startsWith("agent-")).sort();

type Fixture = { agent: string; texts: [number, string][] };

function tailAt(data: Uint8Array, k: number): string {
  return tailDigest(data.subarray(Math.max(0, k - FOLD_CHECK_BYTES), k));
}

let folded: Fixture[] | null = null;

/** Each fixture agent's fold, as a first save writes it at each line
 * end. */
function fixtures(): Fixture[] {
  folded ??= AGENTS.map((agent) => {
    const data = fs.readFileSync(agent);
    const f = cr.newAgentFold();
    const texts: [number, string][] = [];
    let at = 0;
    for (const k of lineEnds(data)) {
      cr.foldAgentBytes(f, data.subarray(at, k));
      at = k;
      texts.push([k, agentFoldText(f, 1, tailAt(data, k))]);
    }
    return { agent, texts };
  });
  return folded;
}

// The format honest: a change to the fold, or to what is saved of it,
// fails here until the format is bumped and the digests written again.
test("each fixture agent's fold saves as tests/fixtures/fold-saves.json " +
  "holds it", () => {
  const want = foldSaves("agent-fold");
  assert.ok(AGENTS.length > 0);
  assert.equal(want.format, AGENT_FOLD_FORMAT,
    "run node plugin/tools/gen-fold-saves.ts");
  assert.deepEqual(Object.keys(want.saves).sort(), AGENTS,
    "run node plugin/tools/gen-fold-saves.ts");
  for (const fx of fixtures()) {
    assert.equal(digest(fx.texts), want.saves[fx.agent],
      `${fx.agent}: the fold changed; bump "agent-fold" in ` +
      "plugin/src/state_spec.ts");
  }
});

// The text at each line end, read back, reads on to the last.
test("the saved agent fold reads on here", () => {
  for (const fx of fixtures()) {
    if (!fx.texts.length) continue;
    const data = fs.readFileSync(fx.agent);
    const [end, last] = fx.texts[fx.texts.length - 1];
    for (const [k, text] of fx.texts) {
      const [seq, tail, g] = agentFoldOf(text)!;
      assert.equal(agentFoldText(g, seq, tail), text, `${fx.agent} at ${k}`);
      cr.foldAgentBytes(g, data.subarray(k, end));
      assert.equal(agentFoldText(g, 1, tailAt(data, end)), last,
        `${fx.agent} from ${k}`);
    }
  }
});

// The newer slot first, a torn one passed over, and with neither, the
// highest seq either starts with.
test("the slots are read newest first, past a torn one", () => {
  const fx = fixtures().find((f) => f.texts.length > 1)!;
  const [, older] = fx.texts[0];
  const [, newer] = fx.texts[1];
  const o = older.replace('"seq":1,', '"seq":4,');
  const n = newer.replace('"seq":1,', '"seq":5,');
  assert.deepEqual(foldCandidates([o, n]).folds.map(([s]) => s), [5, 4]);
  assert.deepEqual(foldCandidates([n.slice(0, 40), o]).folds.map(([s]) => s),
    [4]);
  assert.deepEqual(foldCandidates([n.slice(0, 40), null]),
    { folds: [], newest: 5 });
  assert.deepEqual(foldCandidates([null, null]), { folds: [], newest: 0 });
});


// A first save in one slot is read on, and the fold saved to the other.
test("a saved fold is read on from its slot and saved to the other", () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "agent-fold-"));
  const tr = path.join(state, "s.jsonl");
  const agent = path.join(state, "s", "subagents", "agent-x.jsonl");
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.writeFileSync(tr, "");
  const fx = fixtures().find((f) => f.texts.length > 3)!;
  const data = fs.readFileSync(fx.agent);
  const [half, first] = fx.texts[fx.texts.length >> 1];
  const [end, last] = fx.texts[fx.texts.length - 1];
  const dir = foldDir(state, tr);
  const [a, b] = slotNames(agent).map((n) => path.join(dir, n));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(agent, data.subarray(0, half));
  fs.writeFileSync(b, first);
  fs.writeFileSync(agent, data.subarray(0, end));
  const f = cr.agentFoldFile(dir, agent)!;
  assert.equal(agentFoldText(f, 1, tailAt(data, end)), last);
  assert.equal(fs.readFileSync(a, "utf-8"),
    last.replace('"seq":1,', '"seq":2,'));
  fs.rmSync(state, { recursive: true });
});

// JSON has no infinity: an ∞ report is saved, and read back, as one; in
// the message that ends the turn, it parks the agent.
test("an ∞ report parks the agent, and saves and reads back as ∞", () => {
  const stamp = "2026-11-16T12:00:00.000Z";
  const recs = [{ type: "user", timestamp: stamp,
    message: { content: "do a thing" } },
  { type: "assistant", timestamp: stamp, message: { id: "m1",
    content: [{ type: "text",
      text: "⛳ skills/coding-agent-usage-line-report-eta: ETA ∞" }],
    stop_reason: "end_turn" } }];
  const f = cr.newAgentFold();
  cr.foldAgentBytes(f, new TextEncoder().encode(
    recs.map((r) => JSON.stringify(r) + "\n").join("")), true);
  const want = [Date.parse(stamp) / 1000, Infinity];
  assert.deepEqual(f.etaState[0], want);
  assert.equal(f.etaState[1], false, "parked, not done");
  const [, , g] = agentFoldOf(agentFoldText(f, 1, "t"))!;
  assert.deepEqual(g.etaState[0], want);
  assert.equal(g.etaState[1], false);
});

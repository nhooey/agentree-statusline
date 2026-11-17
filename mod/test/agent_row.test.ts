// agent_row.ts: an agent's state marks and its cells.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fm from "../src/formatting.ts";
import * as ar from "../src/agent_row.ts";
import {
  foldAgentBytes, newAgentFold, NO_LIMITS,
} from "../src/claude_records.ts";
import { agentUsageOf } from "../src/subagent_tasks.ts";

test("a waiting agent is paused, on its shell, its Monitor, its agents, " +
  "or else on what it is held for", () => {
  const bg = (kinds: string[]) => ({ eta: [], pending: [],
    background: kinds.map((k, i) => ["b" + i, k]) });
  assert.deepEqual(ar.agentState("waiting", bg(["bash"])), ["🟡", "💻"]);
  assert.deepEqual(ar.agentState("waiting", bg(["monitor"])), ["🟡", "📡"]);
  assert.deepEqual(ar.agentState("waiting", bg([]), true), ["🟡", "💤"]);
  assert.deepEqual(ar.agentState("waiting", bg([])), ["🟡", "📋"]);
  assert.ok(ar.parked("waiting", [], false, []));
});

test("a completed agent is parked on an ETA with time left, and finished " +
  "on its 0s sign-off", () => {
  assert.ok(ar.parked("completed", [1000, 60], false, []));
  assert.ok(!ar.parked("completed", [1000, 0], false, []));
  assert.ok(!ar.parked("completed", [], false, []));
});

test("an ended agent reads its ⛳ at its end: none for a sign-off at zero, " +
  "and an overrun frozen there, not growing, for one that did not", () => {
  const st = fm.settings({}, true, false, 5);
  const NOW = 1786847000;
  const fin = (own: number[], shown: number[] | false, at: number,
    status = "completed"): string => (ar.agentCells(st,
    { id: "f", status, startTime: (NOW - 600) * 1000 },
    { eta: own, last_epoch: NOW - 200 }, {}, {}, NO_LIMITS, at,
    shown as never).eta ?? []).map((s) => s.text).join("");
  assert.equal(fin([NOW - 300, 0], false, NOW), "");
  const late = fin([NOW - 400, 0], [NOW - 600, 280], NOW);
  assert.match(late, /^⛳ +\+2m$/u);
  assert.equal(fin([NOW - 400, 0], [NOW - 600, 280], NOW + 600), late);
  assert.match(fin([NOW - 500, 120], false, NOW + 600, "killed"),
    /^⛳ +\+3m$/u);
});

test("a SubagentHandback ends the agent as a 0s sign-off does; resumed, it " +
  "is live again; parked on a shell with time left, it stays parked", () => {
  const T0 = Date.parse("2026-08-16T01:00:00Z") / 1000;
  const at = (m: number) => `2026-08-16T01:${String(m).padStart(2, "0")}:00Z`;
  const ETA = "⛳ skills/coding-agent-usage-line-report-eta: ETA ";
  const user = (m: number) => ({ type: "user", timestamp: at(m),
    message: { content: "do a thing" } });
  const says = (m: number, text: string, stop?: string) => ({
    type: "assistant", timestamp: at(m), message: { id: `s${m}`,
      content: [{ type: "text", text }], stop_reason: stop } });
  const call = (m: number, id: string, name: string, input = {}) => ({
    type: "assistant", timestamp: at(m), message: { id: `c${m}`,
      content: [{ type: "tool_use", id, name, input }] } });
  const result = (m: number, id: string, extra = {}) => ({ type: "user",
    timestamp: at(m), message: { content: [{ type: "tool_result",
      tool_use_id: id }] }, ...extra });
  const usage = (recs: object[]) => {
    const fold = newAgentFold();
    foldAgentBytes(fold, new TextEncoder().encode(
      recs.map((r) => JSON.stringify(r) + "\n").join("")), true);
    return agentUsageOf(fold);
  };
  // Its last own report has ten minutes left; its 0s is in the report.
  const gave = [user(10), says(11, ETA + "10m"),
    call(12, "hb", "SubagentHandback", { message: "Report.\n" + ETA + "0s" }),
    result(12, "hb")];
  const k = usage(gave);
  assert.deepEqual(k.eta, [T0 + 12 * 60, 0]);
  assert.ok(!ar.parked("completed", k.eta, false, k.background));
  assert.deepEqual(ar.agentState("completed", k), ["⚫", "✅"]);
  const st = fm.settings({}, true, false, 5);
  assert.deepEqual(ar.agentCells(st, { id: "k", status: "completed",
    startTime: (T0 + 600) * 1000 }, k, {}, {}, NO_LIMITS, T0 + 3 * 3600)
    .eta ?? [], []);
  const l = usage([...gave, user(14), says(15, ETA + "5m")]);
  assert.deepEqual(l.eta, [T0 + 15 * 60, 300]);
  assert.equal(ar.agentState("running", l)[0], "🟢");
  const m = usage([user(10), call(11, "t1", "Bash"),
    result(12, "t1", { toolUseResult: { backgroundTaskId: "sh1" } }),
    says(13, ETA + "10m", "end_turn")]);
  assert.deepEqual(m.eta, [T0 + 13 * 60, 600]);
  assert.deepEqual(m.background, [["sh1", "bash"]]);
  assert.ok(ar.parked("completed", m.eta, false, m.background));
  assert.equal(ar.agentState("completed", m)[0], "🟡");
});

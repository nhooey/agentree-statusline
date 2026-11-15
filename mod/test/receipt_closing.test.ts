// Which turns Claude Code closes with no line, and the answer the receipt
// then draws under (closingLine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerText, closingLine } from "../src/receipt.ts";

const done = (durationMs: number, agents = 0, extra = {}) => ({
  type: "system", subtype: "turn_duration", durationMs,
  ...agents ? { pendingBackgroundAgentCount: agents } : {}, ...extra });
const said = (text: string) => ({ type: "assistant",
  message: { content: [{ type: "text", text }] } });
const typed = { type: "user", message: { content: "Go on." },
  origin: { kind: "human" } };
const notice = { type: "user", message: { content: "<task-notification>" },
  origin: { kind: "task-notification" }, promptSource: "system" };

test("a notification's turn waiting on as many agents as the last has no line", () => {
  const recs = [typed, said("Started."), done(1000, 1), notice,
    said("Still"), said("Still running."), done(2000, 1)];
  assert.deepEqual(closingLine(recs, 2000),
    { hidden: true, answer: "Still running." });
  assert.deepEqual(closingLine(recs, 1000),
    { hidden: false, answer: "Started." });
});

test("a prompt the person sent between them brings the line back", () => {
  for (const between of [typed, { type: "attachment", attachment: {
    type: "queued_command", commandMode: "prompt" } }]) {
    const recs = [done(1000, 1), between, said("Ok."), done(2000, 1)];
    assert.equal(closingLine(recs, 2000)?.hidden, false);
  }
  const queuedNotice = { type: "attachment", attachment: {
    type: "queued_command", commandMode: "task-notification" } };
  assert.equal(closingLine([done(1000, 1), queuedNotice, said("Ok."),
    done(2000, 1)], 2000)?.hidden, true);
});

test("no agents waiting, another count, a budget or hidden messages keep the line", () => {
  const after = (d: object) => closingLine([done(1000, 1), notice,
    said("Ok."), d], 2000)?.hidden;
  assert.equal(after(done(2000)), false);
  assert.equal(after(done(2000, 2)), false);
  assert.equal(after(done(2000, 1, { budgetLimit: 5 })), false);
  assert.equal(after(done(2000, 1, { briefHiddenCount: 3 })), false);
  assert.equal(closingLine([notice, said("Ok.")], 2000), null);
});

test("an agent's records are not the turn's", () => {
  const recs = [done(1000, 1), notice, said("Ok."),
    { ...said("Kid."), isSidechain: true },
    { ...done(1500, 1), isSidechain: true }, done(2000, 1)];
  assert.deepEqual(closingLine(recs, 2000), { hidden: true, answer: "Ok." });
});

test("an answer matches its row whatever its whitespace", () => {
  assert.equal(answerText("  Still\n\n  running. "), "Still running.");
});

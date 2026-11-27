// Where the ETA instruction is still owed: the main conversation, read from
// its transcript's records, and a subagent's prompt at its spawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNREAD, carries, conversationKey, isBoundary, isOwed, scanned, spawnPrompt,
} from "../src/eta_instructed.ts";
import type { Rec } from "../src/claude_records.ts";

const TEXT = "For a task over about a minute, the fixture instruction.\n";

// Records as Claude Code writes them, trimmed to the fields read here.
const prompt = (text: string): Rec => ({ type: "user", isSidechain: false,
  message: { role: "user", content: text } });
/** A hook's context, as the transcript keeps it: a prompt's, or a
 * settings hook's such as SessionStart's. */
const context = (content: readonly string[], hookName = "prompt.submit"):
  Rec => ({ type: "attachment", isSidechain: false,
  attachment: { type: "hook_additional_context", content, hookName } });
const compaction: Rec = { type: "system", subtype: "compact_boundary",
  isSidechain: false, content: "Conversation compacted" };
const clear = prompt("<command-name>/clear</command-name>\n" +
  "            <command-message>clear</command-message>\n" +
  "            <command-args></command-args>");

test("a conversation ends at a compaction and at /clear", () => {
  assert.equal(isBoundary(compaction), true);
  assert.equal(isBoundary(clear), true);
  assert.equal(isBoundary(prompt("clear the cache")), false);
  assert.equal(isBoundary(prompt("/clear")), false);
  assert.equal(isBoundary({ ...compaction, isSidechain: true }), false);
});

test("a hook's context carries the instruction, by either route", () => {
  assert.equal(carries(context([TEXT]), TEXT), true);
  assert.equal(carries(context(["other", TEXT.trim()], "SessionStart"), TEXT),
    true);
  assert.equal(carries(context(["other"]), TEXT), false);
  assert.equal(carries(prompt(TEXT), TEXT), false);
  assert.equal(carries({ ...context([TEXT]), isSidechain: true }, TEXT), false);
});

test("the scan counts conversations and whether the last carries it", () => {
  assert.deepEqual(scanned(UNREAD, [], TEXT), UNREAD);
  assert.deepEqual(scanned(UNREAD, [prompt("a"), context([TEXT])], TEXT),
    { boundaries: 0, isCarried: true });
  assert.deepEqual(
    scanned(UNREAD, [context([TEXT]), compaction, prompt("b")], TEXT),
    { boundaries: 1, isCarried: false });
  assert.deepEqual(
    scanned(UNREAD, [compaction, context([TEXT]), clear], TEXT),
    { boundaries: 2, isCarried: false });
});

test("a scan read on in parts is the scan read at once", () => {
  const records = [prompt("a"), context([TEXT]), compaction, prompt("b"),
    context([TEXT]), clear, prompt("c")];
  for (let cut = 0; cut <= records.length; cut++) {
    const parts = scanned(scanned(UNREAD, records.slice(0, cut), TEXT),
      records.slice(cut), TEXT);
    assert.deepEqual(parts, scanned(UNREAD, records, TEXT), `cut at ${cut}`);
  }
});

test("the instruction is owed to a conversation without it, once", () => {
  const scan = scanned(UNREAD, [prompt("a")], TEXT);
  const key = conversationKey("s1", scan);
  assert.equal(key, "s1#0");
  assert.equal(isOwed(scan, key, ""), true);
  assert.equal(isOwed(scan, key, key), false);
  assert.equal(isOwed({ ...scan, isCarried: true }, key, ""), false);
  assert.equal(conversationKey("s1", scanned(scan, [compaction], TEXT)), "s1#1");
});

test("a spawned agent's prompt ends with the instruction", () => {
  const spawn = { prompt: "Read README.md.", subagentType: "general-purpose",
    fork: false };
  assert.equal(spawnPrompt(spawn, TEXT), "Read README.md.\n\n" + TEXT.trim());
});

test("a fork, a resume and a prompt that holds it are left alone", () => {
  const base = { prompt: "Go.", subagentType: "Explore", fork: false };
  assert.equal(spawnPrompt({ ...base, fork: true }, TEXT), null);
  assert.equal(spawnPrompt({ ...base, subagentType: "fork" }, TEXT), null);
  assert.equal(spawnPrompt({ ...base, resume: { agentId: "a1" } }, TEXT), null);
  assert.equal(spawnPrompt({ ...base, prompt: "Go.\n\n" + TEXT }, TEXT), null);
});

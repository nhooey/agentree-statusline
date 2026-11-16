// The ETA instruction against the parser that reads the line it describes.
//
// hooks/eta-instruction.md tells every session how to write the ⛳ line;
// its format line, with a figure in place of `<n><s|m|h>`, must be what
// etaReport reads back, or the instruction and the band have drifted apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { etaReport } from "../src/claude_records.ts";

const TEXT = fs.readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../hooks/eta-instruction.md"), "utf8");
const PLACEHOLDER = "<n><s|m|h>";
const STAMP = "2026-11-16T12:00:00.000Z";

/** The instruction's format line. */
function formatLine(): string {
  const lines = TEXT.split("\n").filter((l) => l.startsWith("⛳ "));
  assert.equal(lines.length, 1, "one format line, at the start of its line");
  assert.ok(lines[0].endsWith(PLACEHOLDER), lines[0]);
  return lines[0];
}

/** What etaReport reads off one assistant message holding `text`. */
function report(text: string): number[] {
  return etaReport([{ type: "assistant", timestamp: STAMP,
    message: { content: [{ type: "text", text }] } }]);
}

test("the instruction opens for a task over about a minute", () => {
  assert.ok(TEXT.startsWith("For a task over about a minute"));
});

test("the format line, with a figure, parses to that figure", () => {
  const line = formatLine();
  const epoch = Date.parse(STAMP) / 1000;
  for (const [figure, secs] of [["45s", 45], ["7m", 420], ["2h", 7200],
    ["0s", 0]] as const) {
    const written = line.replace(PLACEHOLDER, figure);
    assert.deepEqual(report(`Planned.\n\n${written}`), [epoch, secs], written);
  }
});

test("the format line left as written is not a report", () => {
  assert.deepEqual(report(formatLine()), []);
});

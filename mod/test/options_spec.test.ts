// options_spec.ts is generated from spec/options.jsonc; these pin the forms
// the generator writes: the records `as const`, with no default in the spec
// (every option's is the defaults file's alone), and an Options type that
// the defaults file, merged, fills.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { OPTIONS, type Options } from "../src/options_spec.ts";
import { DEFAULTS_REL, merge, optionsOf, parseDefaults } from "../src/config.ts";

test("the records keep their literal values", () => {
  assert.deepEqual(OPTIONS.rows.fields.place.items, ["above", "footer"]);
  assert.equal(OPTIONS["usage-source"].type, "string");
  assert.deepEqual(OPTIONS.rows.rows,
    ["turn", "agent", "session", "tag", "account", "subagents"]);
  assert.equal(OPTIONS["account-period"]["doc-table"], "settings");
});

test("no option has a default in the spec", () => {
  for (const [name, o] of Object.entries(OPTIONS)) {
    assert.ok(!("default" in o), name);
  }
});

test("the defaults file, merged, fills every option", () => {
  const p = path.join(import.meta.dirname, "..", DEFAULTS_REL);
  const options: Options = optionsOf(merge([], [],
    parseDefaults(p, fs.readFileSync(p, "utf8"))));
  const names = Object.keys(OPTIONS)
    .map((name) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()));
  assert.deepEqual(Object.keys(options).sort(), names.sort());
  assert.equal(options.rightEdge, 5);
  assert.equal(options.rows.turn.live, "running");
  assert.equal(options.rows.turn.place, "above");
});

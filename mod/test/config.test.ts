// src/config.ts against the configuration cases,
// tests/fixtures/config/cases.json, which tools/gen-config-cases.ts writes:
// the walk run over a fake file system built from the case's tree, and the
// root, the paths, the merged options that are not default with their
// layers, each table field a file set, and the warnings.
//
// Hermetic: the fake is the only file system the walk is given, the
// environment is the case's, and every path the walk asks for must lie
// under the case's own root, so no developer's config file, state or
// ~/.claude.json can reach a result.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  CONFIG_ENV, DEFAULTS_REL, DefaultsError, dumpsUnicode, jsonLoads,
  merge, nearest, parseDefaults, readDefaults, readFile, stripJsonc,
} from "../src/config.ts";
import type { ConfigFs } from "../src/config.ts";
import { accountHide } from "../src/band.ts";
import { WEEKLY_WINDOWS } from "../src/sources.ts";
import type { WeeklyKey } from "../src/sources.ts";
import {
  CASES_PATH, DEFAULTS_CASES_PATH, ROOT, generate, run,
} from "../tools/gen-config-cases.ts";
import type { Case, DefaultsCase } from "../tools/gen-config-cases.ts";

// The shipped defaults file, read as the mod reads it, under its folder.
const SHIPPED_PATH = path.join(import.meta.dirname, "..", DEFAULTS_REL);
const SHIPPED = fs.readFileSync(SHIPPED_PATH, "utf8");
const DEFAULTS = parseDefaults(SHIPPED_PATH, SHIPPED);

const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf8")) as Case[];

test("the cases are what the generator writes", async () => {
  for (const [p, text] of await generate()) {
    assert.equal(fs.readFileSync(p, "utf8"), text,
      `${path.basename(p)} is stale: run node mod/tools/gen-config-cases.ts`);
  }
});

for (const c of cases) {
  test(`config case ${c.id}: ${c.about}`, async () => {
    for (const name of Object.keys(c.env)) {
      assert.ok((CONFIG_ENV as readonly string[]).includes(name),
        `the case sets ${name}, which the mod does not read`);
    }
    const { expected, asked } = await run(c, DEFAULTS);
    assert.deepEqual(expected, c.expected);
    const outside = asked.filter((p) => !p.startsWith(ROOT + "/"));
    assert.deepEqual(outside, [], "the walk asked outside the case's tree");
  });
}

// The defaults file read strictly: the shipped one passes, and each change
// in tests/fixtures/config/defaults-cases.json fails with its words, naming
// the file and the key.
const defaultsCases = JSON.parse(fs.readFileSync(DEFAULTS_CASES_PATH,
  "utf8")) as DefaultsCase[];

test("the defaults cases include a missing key, an extra key and a wrong type",
  () => {
    const ids = defaultsCases.map((c) => c.id);
    for (const id of ["shipped", "missing-key", "unknown-key", "wrong-type"]) {
      assert.ok(ids.includes(id), id);
    }
    assert.equal(defaultsCases.find((c) => c.id === "shipped")?.text, SHIPPED,
      "defaults-cases.json is stale: run node mod/tools/gen-config-cases.ts");
  });

for (const c of defaultsCases) {
  test(`defaults case ${c.id}: ${c.about}`, () => {
    let got: string | null = null;
    try {
      parseDefaults(c.path, c.text);
    } catch (err) {
      assert.ok(err instanceof DefaultsError);
      got = err.message;
    }
    assert.equal(got, c.expected);
  });
}

test("the shipped defaults hold every option, a derived one null", () => {
  assert.equal(DEFAULTS["usage-source"], "auto");
  assert.equal(DEFAULTS["right-edge"], null);
  const merged = merge([], [], DEFAULTS);
  assert.equal(merged.values["right-edge"], 5);
  assert.equal(merged.layers["right-edge"], "derived");
});

test("a missing or unreadable defaults file is an error", async () => {
  const none: ConfigFs = { stat: async () => null, read: async () => null,
    realPath: async () => null };
  await assert.rejects(readDefaults("/m/defaults/config.jsonc", none),
    new DefaultsError("/m/defaults/config.jsonc: missing"));
  const unreadable: ConfigFs = { ...none,
    stat: async () => ({ kind: "file", size: 1, mtimeMs: 1 }) };
  await assert.rejects(readDefaults("/m/defaults/config.jsonc", unreadable),
    new DefaultsError("/m/defaults/config.jsonc: unreadable"));
});

test("a user file copied from the defaults with one change differs by that " +
  "change alone", async () => {
    const text = SHIPPED.replace('"hint-inset": 2', '"hint-inset": 3');
    const fake: ConfigFs = {
      stat: async () => ({ kind: "file", size: text.length, mtimeMs: 1 }),
      read: async () => text, realPath: async (p) => p };
    const got = await readFile("/u/config.jsonc", fake, DEFAULTS);
    assert.deepEqual(got.warnings, []);
    const mine = merge([{ name: "user", path: "/u/config.jsonc", mtimeMs: 1,
      values: got.values }], [], DEFAULTS);
    const plain = merge([], [], DEFAULTS);
    const changed = Object.keys(plain.values).filter((k) =>
      JSON.stringify(mine.values[k]) !== JSON.stringify(plain.values[k]));
    assert.deepEqual(changed, ["hint-inset"]);
    assert.equal(mine.values["hint-inset"], 3);
    assert.equal(mine.layers["right-edge"], "derived");
  });

test("the other weekly windows stay off under a file's own hide, and a " +
  "file that turns one on leaves the rest off", async () => {
    const read = async (text: string) => {
      const fake: ConfigFs = {
        stat: async () => ({ kind: "file", size: text.length, mtimeMs: 1 }),
        read: async () => text, realPath: async (p) => p };
      const got = await readFile("/u/config.jsonc", fake, DEFAULTS);
      assert.deepEqual(got.warnings, []);
      return merge([{ name: "user", path: "/u/config.jsonc", mtimeMs: 1,
        values: got.values }], [], DEFAULTS);
    };
    const windows = (m: { values: { [k: string]: unknown } }) =>
      m.values["weekly-windows"] as { [key in WeeklyKey]: boolean };
    const all = WEEKLY_WINDOWS.map(([key]) => "account.plan." + key);
    // A file's `hide` replaces the defaults' list, and the windows stay off.
    const hiding = await read('{"hide": ["*.plan.five_hour"]}');
    assert.deepEqual(hiding.values.hide, ["*.plan.five_hour"]);
    assert.deepEqual(accountHide(hiding.values.hide as string[],
      windows(hiding)), ["*.plan.five_hour", ...all]);
    // One window on: the record merges per field.
    const opus = await read('{"weekly-windows": {"opus": true}}');
    assert.deepEqual(windows(opus), { opus: true, sonnet: false,
      omelette: false, oauth_apps: false, cowork: false });
    assert.equal(opus.layers["weekly-windows"], "user");
    assert.deepEqual(accountHide([], windows(opus)),
      all.filter((p) => p !== "account.plan.opus"));
  });

test("the reader reaches no file and no variable but those it is handed",
  () => {
    // Pure: what it reads comes through ConfigFs and ConfigEnv, so the
    // cases above, run over a fake, cannot meet this machine's files.
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "src", "config.ts"), "utf8");
    assert.ok(!/\bprocess\.|from "node:/.test(source),
      "src/config.ts reaches past ConfigFs and ConfigEnv");
  });

test("JSONC: comments and trailing commas outside strings only", () => {
  assert.equal(stripJsonc('{"a": "//x", // c\n "b": [1,],}'),
    '{"a": "//x",     \n "b": [1 ] }');
});

test("json.loads' shapes: key order kept, 1 apart from 1.0", () => {
  const got = jsonLoads('{"2": 1, "1": 1.0, "2": NaN}') as Map<string, unknown>;
  assert.deepEqual([...got.keys()], ["2", "1"]);
  assert.equal(got.get("1"), 1);
  assert.ok(Number.isNaN(got.get("2")));
  assert.equal(jsonLoads("12345678901234567890"), 12345678901234567890n);
  assert.equal(dumpsUnicode(jsonLoads('[2.0, {"é": "\\u0001"}]')),
    '[2.0, {"é": "\\u0001"}]');
});

test("the nearest key: within a third of the word, ties to the first", () => {
  assert.equal(nearest("rwos", ["rows", "hide"]), "rows");
  assert.equal(nearest("ab", ["ac", "ad"]), "ac");
  assert.equal(nearest("zzzzzz", ["rows"]), null);
});

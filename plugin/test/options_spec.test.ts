// options_spec.ts's records, held to the form its head describes, which
// src/config.ts reads: `as const`, with no default in the spec (every
// option's is the defaults file's alone), an Options type that the
// defaults file, merged, fills, and the defaults file holding every option
// in the spec's order.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { OPTIONS, type Options } from "../src/options_spec.ts";
import { DEFAULTS_REL, merge, optionsOf, parseDefaults }
  from "../src/config.ts";
import { parseYaml } from "../src/yaml.ts";
import { DOC_TABLES, withOptionTables } from "../tools/gen-option-docs.ts";

const TYPES = ["bool", "int", "string", "enum", "list", "table", "record"];
// A record's fields: the scalar types, and lists of condition maps
// ({field, op, value, unit}), alone or keyed by name.
const RECORD_FIELDS = ["bool", "string", "enum", "conditions",
  "conditions-by"];
const FIELDS = ["type", "items", "fields", "rows", "derived", "minimum",
  "distinct", "doc-table", "doc-default", "doc"];
const REQUIRED = ["type", "doc-table", "doc"];

type Field = { type: string; items?: readonly string[];
  fixed?: readonly string[]; keys?: readonly string[]; nullable?: boolean };
type Rec = { type: string; items?: readonly string[];
  fields?: { readonly [k: string]: Field }; rows?: readonly string[];
  derived?: { from: string; field?: string; any?: string;
    map: { readonly [k: string]: unknown } };
  minimum?: number; distinct?: boolean; "doc-table": string | null;
  doc: string };
const SPEC = OPTIONS as unknown as { readonly [name: string]: Rec };

const subset = (xs: Iterable<string>, of: readonly string[]): boolean =>
  [...xs].every((x) => of.includes(x));

test("every record is in the form the reader takes", () => {
  for (const [name, o] of Object.entries(SPEC)) {
    const bad = (why: string): string => `${name}: ${why}`;
    assert.match(name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, bad("a name"));
    assert.deepEqual(Object.keys(o), FIELDS.filter((k) => k in o),
      bad("fields known, and in order"));
    for (const k of REQUIRED) assert.ok(k in o, bad(`no ${k}`));
    assert.ok(TYPES.includes(o.type), bad(`unknown type ${o.type}`));
    assert.equal(o.type === "enum", "items" in o,
      bad("items go with an enum, and only with one"));
    assert.equal(["table", "record"].includes(o.type), "fields" in o,
      bad("fields go with a table or a record"));
    assert.equal(o.type === "table", "rows" in o,
      bad("rows go with a table only"));
    assert.equal(typeof o.doc, "string", bad("a doc"));
    if (o.type === "table") {
      const rows = o.rows ?? [];
      assert.ok(rows.length && new Set(rows).size === rows.length,
        bad("a table's rows are distinct names"));
      for (const [k, ft] of Object.entries(o.fields ?? {})) {
        assert.ok(subset(Object.keys(ft), ["type", "items", "fixed"]),
          bad(`field ${k}`));
        assert.ok(subset(ft.fixed ?? [], rows), bad(`field ${k} fixes`));
      }
    }
    if (o.type === "record") {
      for (const [k, ft] of Object.entries(o.fields ?? {})) {
        assert.ok(RECORD_FIELDS.includes(ft.type), bad(`field ${k}`));
        assert.ok(subset(Object.keys(ft),
          ["type", "items", "keys", "nullable"]), bad(`field ${k}`));
        assert.equal(ft.type === "enum", "items" in ft, bad(`field ${k}`));
        assert.equal(ft.type === "conditions-by", "keys" in ft,
          bad(`field ${k}`));
        assert.ok(!ft.nullable || ft.type === "string",
          bad(`field ${k}: only a string is nullable`));
      }
    }
    assert.ok(!("minimum" in o) || o.type === "int",
      bad("only an int has a minimum"));
    assert.ok(!("distinct" in o) || (o.type === "list" && o.distinct === true),
      bad("only a list is distinct, and then true"));
    assert.ok(o["doc-table"] === null ||
      (DOC_TABLES as readonly string[]).includes(o["doc-table"]),
      bad(`no doc table ${o["doc-table"]}`));
  }
});

// A derived option follows a table's field: the map's value for `any`
// when any row the plugin draws (its `live` not "never") has `any` in that
// field, and for the field's other item when none has.  Keyed by both, so
// a default of null always has a value to stand for.
test("every derived option can be worked out", () => {
  for (const [name, o] of Object.entries(SPEC)) {
    const d = o.derived;
    if (d === undefined) continue;
    assert.deepEqual(Object.keys(d), ["from", "field", "any", "map"], name);
    const src = SPEC[d.from];
    assert.equal(src?.type, "table", `${name}: from no table`);
    const ft = src.fields?.[d.field ?? ""];
    assert.ok(ft?.type === "enum" && ft.items?.length === 2,
      `${name}: from no enum of two items`);
    assert.ok(ft.items?.includes(d.any ?? ""), `${name}: any`);
    assert.ok(src.fields?.live?.items?.includes("never"),
      `${name}: no live field to say which rows are drawn`);
    assert.deepEqual(Object.keys(d.map).sort(), [...ft.items ?? []].sort(),
      `${name}: the map is not keyed by every value of the field`);
    for (const v of Object.values(d.map)) {
      const fits = o.type === "int" ? Number.isInteger(v)
        : o.type === "enum" ? o.items?.includes(v as string)
        : o.type === "bool" ? typeof v === "boolean" : typeof v === "string";
      assert.ok(fits, `${name}: derives ${String(v)}, not a ${o.type}`);
    }
  }
});

test("the defaults file holds every option, in the spec's order", () => {
  const p = path.join(import.meta.dirname, "..", DEFAULTS_REL);
  const data = parseYaml(fs.readFileSync(p, "utf8"));
  assert.ok(data instanceof Map);
  assert.deepEqual([...data.keys()], Object.keys(OPTIONS));
});

// gen-option-docs.ts run in memory: docs/options.md's tables are what the
// spec and the defaults file write.
test("docs/options.md's option tables are the spec's", () => {
  const p = path.join(import.meta.dirname, "..", DEFAULTS_REL);
  const defaults = parseDefaults(p, fs.readFileSync(p, "utf8"));
  const doc = fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "docs", "options.md"), "utf8");
  assert.equal(withOptionTables(doc, defaults), doc);
});

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

// An option nothing reads is one a file can set to no effect.  Each is read
// as a field of the merged options, `o.name` or destructured, in a module
// of the plugin's own: not only its spec.
test("every option is read by the plugin", () => {
  const root = path.join(import.meta.dirname, "..");
  const code = ["src", "hooks"].flatMap((dir) =>
    fs.readdirSync(path.join(root, dir))
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("_spec.ts"))
      .map((f) => fs.readFileSync(path.join(root, dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")))
    .join("\n");
  for (const name of Object.keys(OPTIONS)) {
    const camel = name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    // Off the options themselves, `o` or `options()`: a row's field of the
    // same name, `o.rows.account`, is not the option `account`.
    const read = new RegExp(`(?:\\bo|\\boptions\\(\\))\\??\\.${camel}\\b|` +
      `\\bconst\\s*\\{[^{}]*\\b${camel}\\b[^{}]*\\}\\s*=\\s*o\\b`);
    assert.ok(read.test(code), `${name} is read by nothing`);
  }
});

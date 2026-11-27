// src/yaml.ts: each construct the configuration files may use, read; each
// one past them refused at its line and column; YAML 1.2's core schema at
// its edges; and yamlFlow's writing read back as the value written.
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseYaml, quote, resolvePlain, yamlFlow, yamlOption, YamlError }
  from "../src/yaml.ts";
import type { Yaml } from "../src/yaml.ts";

const map = (...entries: [string, Yaml][]) => new Map<string, Yaml>(entries);

/** `text` refused at `line` and `column`, with `what` in the reason. */
function refused(text: string, line: number, column: number, what: string) {
  assert.throws(() => parseYaml(text), (err: unknown) => {
    assert.ok(err instanceof YamlError, String(err));
    assert.deepEqual([err.line, err.column], [line, column],
      `${JSON.stringify(text)}: ${err.message}`);
    assert.ok(err.what.includes(what), `${JSON.stringify(text)}: ${err.message}`);
    assert.equal(err.message, `line ${line}, column ${column}: ${err.what}`);
    return true;
  });
}

// ── Read ──────────────────────────────────────────────────────────────────

test("a block mapping keeps its keys in the order written", () => {
  const got = parseYaml("b: 1\na: 2\n\"1\": 3\n") as Map<string, Yaml>;
  assert.deepEqual([...got.keys()], ["b", "a", "1"]);
  assert.deepEqual(got, map(["b", 1n], ["a", 2n], ["1", 3n]));
});

test("nested block mappings, by indentation", () => {
  assert.deepEqual(parseYaml("a:\n  b:\n    c: x\n  d: y\ne: z\n"),
    map(["a", map(["b", map(["c", "x"])], ["d", "y"])], ["e", "z"]));
});

test("block sequences: indented, at the key's own indentation, compact", () => {
  assert.deepEqual(parseYaml("a:\n  - x\n  - y\n"), map(["a", ["x", "y"]]));
  assert.deepEqual(parseYaml("a:\n- x\n- y\nb: 1\n"),
    map(["a", ["x", "y"]], ["b", 1n]));
  assert.deepEqual(parseYaml("- k: 1\n  j: 2\n- - p\n  - q\n-\n-   r\n"),
    [map(["k", 1n], ["j", 2n]), ["p", "q"], null, "r"]);
  assert.deepEqual(parseYaml("-\n  k: v\n"), [map(["k", "v"])]);
});

test("flow sequences and mappings, nested, over lines, a trailing comma",
  () => {
    assert.deepEqual(parseYaml("a: [x, [y], {k: v, j: [1, 2]}]\n"),
      map(["a", ["x", ["y"], map(["k", "v"], ["j", [1n, 2n]])]]));
    assert.deepEqual(parseYaml("a: {k: 1,\n     j: 2,  # c\n     }\n"),
      map(["a", map(["k", 1n], ["j", 2n])]));
    assert.deepEqual(parseYaml("a: [x,]\nb: []\nc: {}\n"),
      map(["a", ["x"]], ["b", []], ["c", map()]));
    assert.deepEqual(parseYaml("a: {k: , j:}\n"),
      map(["a", map(["k", null], ["j", null])]));
  });

test("JSON is YAML: a JSON object reads as its mapping", () => {
  assert.deepEqual(parseYaml('{"a": [1, 2.5, "x"], "b": {"c": null}}'),
    map(["a", [1n, 2.5, "x"]], ["b", map(["c", null])]));
  assert.deepEqual(parseYaml('{"a":1}'), map(["a", 1n]));
});

test("plain scalars: spaces, colons and # inside kept", () => {
  assert.deepEqual(parseYaml("a: two words\nb: x:y\nc: a#b\nd: cmd:/bin/x\n" +
    "e: http://h/p\n"), map(["a", "two words"], ["b", "x:y"], ["c", "a#b"],
    ["d", "cmd:/bin/x"], ["e", "http://h/p"]));
  assert.deepEqual(parseYaml("a: [x:y, -1, -x]\n"),
    map(["a", ["x:y", -1n, "-x"]]));
});

test("single-quoted scalars: '' is a quote, nothing else escapes", () => {
  assert.deepEqual(parseYaml("a: 'it''s \\n # [x]'\n"),
    map(["a", "it's \\n # [x]"]));
  assert.deepEqual(parseYaml("a: ''\n"), map(["a", ""]));
});

test("double-quoted scalars: every escape", () => {
  assert.deepEqual(parseYaml(String.raw`a: "\0\a\b\t\	\n\v\f\r\e\ \"\/\\\N\_\L\P"`),
    map(["a", "\0\x07\b\t\t\n\v\f\r\x1b \"/\\\x85\xa0\u2028\u2029"]));
  assert.deepEqual(parseYaml(String.raw`a: "\x41\u00e9\U0001F600"`),
    map(["a", "Aé😀"]));
  assert.deepEqual(parseYaml('a: "# not a comment: [x]"\n'),
    map(["a", "# not a comment: [x]"]));
});

test("quoted keys, the ones a plain key cannot be", () => {
  assert.deepEqual(parseYaml('"*.plan.five_hour": 1\n\'a: b\': 2\n'),
    map(["*.plan.five_hour", 1n], ["a: b", 2n]));
  assert.deepEqual(parseYaml('hide: ["*.plan.five_hour"]\n'),
    map(["hide", ["*.plan.five_hour"]]));
  assert.deepEqual(parseYaml('{"*": 1, \'2\': 2}'), map(["*", 1n], ["2", 2n]));
});

test("comments: whole lines, after a value, after a key", () => {
  assert.deepEqual(parseYaml("# top\na: 1  # after\n  # indented\nb: # key\n" +
    "  c: 2\n\n# end\n"), map(["a", 1n], ["b", map(["c", 2n])]));
});

test("an empty value is null, an empty document null, a --- start read",
  () => {
    assert.deepEqual(parseYaml("a:\nb: ~\n"), map(["a", null], ["b", null]));
    assert.equal(parseYaml(""), null);
    assert.equal(parseYaml("# nothing\n\n"), null);
    assert.deepEqual(parseYaml("# c\n---\na: 1\n"), map(["a", 1n]));
  });

test("line breaks of every kind, and a byte-order mark", () => {
  assert.deepEqual(parseYaml("\uFEFFa: 1\r\nb: 2\rc: 3"),
    map(["a", 1n], ["b", 2n], ["c", 3n]));
});

test("a scalar or a flow collection as the whole document", () => {
  assert.equal(parseYaml("hello"), "hello");
  assert.deepEqual(parseYaml("[1, 2]\n"), [1n, 2n]);
});

// ── The core schema ───────────────────────────────────────────────────────

test("core schema: null", () => {
  for (const s of ["", "~", "null", "Null", "NULL"]) {
    assert.equal(resolvePlain(s), null, s);
  }
  assert.equal(resolvePlain("nULL"), "nULL");
});

test("core schema: booleans, and the YAML 1.1 words are strings", () => {
  for (const s of ["true", "True", "TRUE"]) assert.equal(resolvePlain(s), true);
  for (const s of ["false", "False", "FALSE"]) {
    assert.equal(resolvePlain(s), false);
  }
  for (const s of ["no", "No", "yes", "on", "off", "y", "n", "tRUE"]) {
    assert.equal(resolvePlain(s), s);
  }
  assert.deepEqual(parseYaml("a: no\nb: off\n"), map(["a", "no"], ["b", "off"]));
});

test("core schema: integers are bigints, in decimal, octal and hex", () => {
  assert.equal(resolvePlain("0"), 0n);
  assert.equal(resolvePlain("-12"), -12n);
  assert.equal(resolvePlain("+7"), 7n);
  assert.equal(resolvePlain("007"), 7n);
  assert.equal(resolvePlain("0o17"), 15n);
  assert.equal(resolvePlain("0x1F"), 31n);
  assert.equal(resolvePlain("12345678901234567890"), 12345678901234567890n);
  // Past the core schema's forms: strings.
  for (const s of ["0b101", "0O17", "0X1F", "1_000", "0x", "--1", "1.2.3"]) {
    assert.equal(resolvePlain(s), s);
  }
});

test("core schema: floats are numbers, 1.0 told from 1", () => {
  assert.equal(resolvePlain("1.0"), 1);
  assert.equal(typeof resolvePlain("1.0"), "number");
  assert.equal(typeof resolvePlain("1"), "bigint");
  assert.equal(resolvePlain(".5"), 0.5);
  assert.equal(resolvePlain("1."), 1);
  assert.equal(resolvePlain("-2.5e3"), -2500);
  assert.equal(resolvePlain("1e3"), 1000);
  assert.equal(resolvePlain("+.inf"), Infinity);
  assert.equal(resolvePlain("-.Inf"), -Infinity);
  assert.ok(Number.isNaN(resolvePlain(".NaN")));
  for (const s of [".", "e3", "inf", "nan", "-.nan", ".INf"]) {
    assert.equal(resolvePlain(s), s);
  }
});

test("a quoted scalar is a string whatever it holds", () => {
  assert.deepEqual(parseYaml("a: \"1\"\nb: 'true'\nc: \"null\"\nd: '~'\n"),
    map(["a", "1"], ["b", "true"], ["c", "null"], ["d", "~"]));
});

// ── Refused ───────────────────────────────────────────────────────────────

test("anchors, aliases and tags are refused where they stand", () => {
  refused("a: &x 1\n", 1, 4, "anchors (&)");
  refused("a: 1\nb: *x\n", 2, 4, "aliases (*)");
  refused("a: !!str 1\n", 1, 4, "tags (!)");
  refused("a: [1, *x]\n", 1, 8, "aliases (*)");
  refused("- &x a\n", 1, 3, "anchors (&)");
});

test("block scalars are refused", () => {
  refused("a: |\n  text\n", 1, 4, "block scalars");
  refused("a: >-\n  text\n", 1, 4, "block scalars");
});

test("directives, a second document and a node on the --- line are refused",
  () => {
    refused("%YAML 1.2\n---\na: 1\n", 1, 1, "directives (%)");
    refused("a: 1\n---\nb: 2\n", 2, 1, "a second document");
    refused("a: 1\n...\n", 2, 1, "a second document");
    refused("--- {a: 1}\n", 1, 5, "on the --- line");
  });

test("explicit keys, collection keys and keys that are no string are " +
  "refused", () => {
    refused("? a\n: b\n", 1, 1, "explicit keys (?)");
    refused("a: {? b: c}\n", 1, 5, "explicit keys (?)");
    refused("a: {[b]: c}\n", 1, 5, "a collection as a key");
    refused("1: a\n", 1, 1, "the key 1 is no string");
    refused("a:\n  true: b\n", 2, 3, "the key true is no string");
    refused("{null: a}\n", 1, 2, "the key null is no string");
  });

test("a key given twice is refused at its second place", () => {
  refused("a: 1\nb: 2\na: 3\n", 3, 1, 'the key "a" is given twice');
  refused("a: {k: 1, k: 2}\n", 1, 11, 'the key "k" is given twice');
  refused('"a": 1\na: 2\n', 2, 1, "given twice");
});

test("a scalar continued onto another line is refused", () => {
  refused("a: one\n  two\n", 2, 3, "unexpected indentation");
  refused("a: \"one\n  two\"\n", 1, 4, "must close on its own line");
  refused("a: 'one\n", 1, 4, "must close on its own line");
  refused('a: "one\\\n  two"\n', 1, 8, "continued onto the next line");
  refused("a: [one\n  two]\n", 2, 3, "expected , or ]");
});

test("tabs that indent are refused, and a control character", () => {
  refused("a:\n\tb: 1\n", 2, 1, "a tab cannot indent");
  refused("a:\n  \tb: 1\n", 2, 3, "a tab cannot indent");
  refused("a: b\x01c\n", 1, 5, "U+0001");
});

test("malformed blocks are refused at the fault", () => {
  refused("a: 1\n- b\n", 2, 1, "a sequence entry where a mapping key");
  refused("- a\nb: 1\n", 2, 1, "unexpected text after the document");
  refused("a: b: c\n", 1, 4, "a block mapping cannot start on its key's line");
  refused("a: - b\n", 1, 4, "a block sequence cannot start on its key's line");
  refused("a: 1\n  b: 2\n", 2, 3, "unexpected indentation");
  refused("a:\n  - x\n  y: 1\n", 3, 3, "unexpected indentation");
  refused("a: 1\nb\n", 2, 1, "expected a key");
  refused("a: \"x\" y\n", 1, 8, "unexpected text after the value");
  refused("a: [x]# c\n", 1, 7, "a comment (#) must follow a blank");
});

test("malformed flow collections are refused at the fault", () => {
  refused("a: [x, y\n", 1, 4, "this [ is never closed");
  refused("a: {k: v\nb: 1\n", 2, 1, "indented past its block's");
  refused("a: [x,, y]\n", 1, 7, "expected a value");
  refused("a: [k: v]\n", 1, 6, "a key and value in a flow sequence");
  refused("a: {k}\n", 1, 6, "expected : after the key");
  refused("a: {k:1}\n", 1, 8, "expected : after the key");
  refused("a: {k: v w: x}\n", 1, 11, "expected , or }");
  refused("a: [- x]\n", 1, 5, "a block sequence entry (-)");
  refused("a: [x, #c\n]\n", 2, 1, "indented past its block's");
  refused("a: ]\n", 1, 4, "unexpected ]");
});

test("bad escapes are refused at the backslash", () => {
  refused(String.raw`a: "\q"`, 1, 5, "unknown escape \\q");
  refused(String.raw`a: "\x4"`, 1, 5, "\\x takes 2 hexadecimal digits");
  refused(String.raw`a: "\U00110000"`, 1, 5, "is no character");
});

test("reserved indicators are refused", () => {
  refused("a: @x\n", 1, 4, "@ is reserved");
  refused("a: `x\n", 1, 4, "` is reserved");
  refused("a: %x\n", 1, 4, "cannot start with %");
});

// ── Written ───────────────────────────────────────────────────────────────

test("yamlFlow: every string double-quoted, escaped as YAML does", () => {
  for (const [s, w] of [["above", '"above"'],
    ["rows.turn.place", '"rows.turn.place"'], ["two words", '"two words"'],
    ["cmd:/bin/x", '"cmd:/bin/x"'], ["no", '"no"'], ["true", '"true"'],
    ["1", '"1"'], ["", '""'], ["~", '"~"'], ["*.plan", '"*.plan"'],
    ["a: b", '"a: b"'], ["a,b", '"a,b"'], [" a", '" a"'],
    ['say "hi"', '"say \\"hi\\""'], ["é", '"é"'], ["a\nb", '"a\\nb"'],
    ["\x01", '"\\x01"'], ["\\", '"\\\\"']]) {
    assert.equal(yamlFlow(s), w, s);
  }
});

test("yamlFlow: numbers, null, booleans and collections", () => {
  assert.equal(yamlFlow(1n), "1");
  assert.equal(yamlFlow(1), "1.0");
  assert.equal(yamlFlow(2.5), "2.5");
  assert.equal(yamlFlow(NaN), ".nan");
  assert.equal(yamlFlow(-Infinity), "-.inf");
  assert.equal(yamlFlow(null), "null");
  assert.equal(yamlFlow(false), "false");
  assert.equal(yamlFlow([1n, "a", ["b"]]), '[1, "a", ["b"]]');
  assert.equal(yamlFlow(map(["2", 1n], ["1", "x y"])),
    '{"2": 1, "1": "x y"}');
  assert.equal(yamlFlow({ place: "above", live: "never" }),
    '{"place": "above", "live": "never"}');
  assert.equal(yamlOption(2), "2");
  assert.equal(yamlOption(2.5), "2.5");
  assert.equal(yamlOption({ value: 0, op: ">" }), '{"value": 0, "op": ">"}');
});

test("yamlFlow reads back as the value written", () => {
  const values: Yaml[] = ["above", "no", "true", "1", "", "*.p", "a: b",
    "a #b", "é\u2028", "\x00\x7f\ufeff", "'", '"', "-", "?x", "x?", "::",
    "a,b", "[x]", "{x}", "#x", "a\tb", "%", "@", 0n, -5n, 1.5, 1, 1e16,
    1e-7, -0, Infinity, null, true, [], ["a", ["b", 1n]], map(),
    map(["k", map(["j", ["v"]])], ["true", "x"], ["1", 2n])];
  for (const v of values) {
    const back = parseYaml("v: " + yamlFlow(v)) as Map<string, Yaml>;
    assert.deepEqual(back.get("v"), v, yamlFlow(v));
    const top = parseYaml(yamlFlow(map(["v", v])));
    assert.deepEqual(top, map(["v", v]), yamlFlow(map(["v", v])));
  }
});

test("quote shows a string quoted and the rest bare", () => {
  assert.equal(quote(""), '""');
  assert.equal(quote("\n"), '"\\n"');
  assert.equal(quote("  x"), '"  x"');
  assert.equal(quote("null"), '"null"');
  assert.equal(quote("/a b/c"), '"/a b/c"');
  assert.equal(quote(null), "null");
  assert.equal(quote(undefined), "undefined");
  assert.equal(quote(3n), "3");
  assert.equal(quote(2.5), "2.5");
  assert.equal(quote(true), "true");
});

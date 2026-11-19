// exact.ts, helper by helper: each case is one where the plain JavaScript
// form (JSON.stringify, \s, String(x), toFixed, Math.max, path.join, ...)
// gives other bytes, so the reason the helper exists is pinned.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  asciiDigits, baseName, charLen, charSlice, cmpStr, daysFromCivil, daysIn,
  digitsInt, firstMax, firstMin, fixed, floatRepr, general, intText,
  isDigits, joinPath, padField, padRight, parseFloatText, parseIntText,
  parseJson, printableText, scalarEq, splitSpace, stableJson, stripEnd,
  stripSpace, stripStart, toFloat, UNICODE_SPACE, utf8, valueText,
} from "../src/exact.ts";

const BOM_A = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);

test("utf8: the byte-order mark kept on asking, and strict on asking", () => {
  assert.equal(new TextDecoder().decode(BOM_A), "a");
  assert.equal(utf8(BOM_A), "a");
  assert.equal(utf8(BOM_A, false, true), "\ufeffa");
  assert.equal(utf8(new Uint8Array([0xff])), "\ufffd");
  assert.throws(() => utf8(new Uint8Array([0xff]), true));
});

test("UNICODE_SPACE: the separators \\s lacks, without U+FEFF", () => {
  const space = new RegExp(`^[${UNICODE_SPACE}]$`, "u");
  for (const ch of ["\x1c", "\x1f", "\x85"]) {
    assert.ok(space.test(ch), ch);
    assert.ok(!/^\s$/u.test(ch), ch);
  }
  assert.ok(/^\s$/u.test("\ufeff"));
  assert.ok(!space.test("\ufeff"));
});

test("stripSpace, splitSpace, stripEnd, stripStart: by UNICODE_SPACE", () => {
  const s = "\x1c\x85 a\ufeff \u3000";
  assert.equal(stripSpace(s), "a\ufeff");
  assert.notEqual(s.trim(), "a\ufeff");
  assert.deepEqual(splitSpace("\x1fa\x85b\u00a0c "), ["a", "b", "c"]);
  assert.deepEqual(splitSpace(" \x1c "), []);
  assert.deepEqual(" \x1c ".split(/\s+/u), ["", "\x1c", ""]);
  assert.equal(stripEnd("ab\x1d"), "ab");
  assert.equal(stripStart("\x1e z"), "z");
  assert.equal(stripEnd("x😀😀", "😀"), "x");
  assert.equal(stripStart("yyx", "y"), "x");
});

test("asciiDigits: every Unicode decimal digit as its ASCII one", () => {
  assert.equal(asciiDigits("\u0663\uff15\u09ea"), "354");
  assert.ok(Number.isNaN(parseInt("\u0663", 10)));
});

test("charLen, charSlice: by code point, not UTF-16 unit", () => {
  assert.equal(charLen("a😀"), 2);
  assert.equal("a😀".length, 3);
  assert.equal(charSlice("a😀b", -2), "😀b");
  assert.equal(charSlice("a😀b", 1, 2), "😀");
  assert.equal("a😀b".slice(1, 2), "\ud83d");
  assert.equal(charSlice("abc", 5), "");
});

test("padField, padRight: padded to a width in code points", () => {
  assert.equal(padField("😀", 3), "  😀");
  assert.equal("😀".padStart(3), " 😀");
  assert.equal(padField("ab", 4, true), "ab  ");
  assert.equal(padField("ab", -4), "ab  ");
  assert.equal(padRight("😀", 3), "😀  ");
  assert.equal("😀".padEnd(3), "😀 ");
});

test("floatRepr: the shortest round-trip digits, laid out as repr", () => {
  const cases: [number, string, string][] = [
    [1, "1.0", "1"],
    [1e16, "1e+16", "10000000000000000"],
    [1e15, "1000000000000000.0", "1000000000000000"],
    [1e-5, "1e-05", "0.00001"],
    [1e-7, "1e-07", "1e-7"],
    [-0, "-0.0", "0"],
    [NaN, "nan", "NaN"],
    [Infinity, "inf", "Infinity"],
    [-Infinity, "-inf", "-Infinity"],
    [1.5e300, "1.5e+300", "1.5e+300"],
  ];
  for (const [x, want, js] of cases) {
    assert.equal(floatRepr(x), want, String(x));
    assert.equal(String(x), js, String(x));
  }
  assert.equal(floatRepr(0.0001), "0.0001");
  assert.equal(floatRepr(123.456), "123.456");
});

test("fixed: the exact value rounded half to even, at any magnitude", () => {
  const cases: [number, number, string, string][] = [
    [2.5, 0, "2", "3"],
    [0.125, 2, "0.12", "0.13"],
    [1e21, 0, "1000000000000000000000", "1e+21"],
    [-0, 1, "-0.0", "0.0"],
  ];
  for (const [x, p, want, js] of cases) {
    assert.equal(fixed(x, p), want, `${x} ${p}`);
    assert.equal(x.toFixed(p), js, `${x} ${p}`);
  }
  assert.equal(fixed(NaN, 1), "nan");
  assert.equal(fixed(3.7, -1), "4");
});

test("general: six significant digits, half to even, exponent past", () => {
  assert.equal(general(0.15 + 0.15 + 0.15), "0.45");
  assert.equal(String(0.15 + 0.15 + 0.15), "0.44999999999999996");
  assert.equal(general(1e-5), "1e-05");
  assert.equal(general(123456789), "1.23457e+08");
  assert.equal(general(100), "100");
  assert.equal(general(-0), "-0");
  assert.equal(general(NaN), "nan");
});

test("intText: truncated toward zero, every digit written", () => {
  assert.equal(intText(1e21), "1000000000000000000000");
  assert.equal(String(1e21), "1e+21");
  assert.equal(intText(-2.7), "-2");
  assert.equal(intText(-0), "0");
  assert.throws(() => intText(Infinity), RangeError);
  assert.throws(() => intText(NaN), RangeError);
});

test("isDigits, digitsInt: superscripts are digits, but no decimal", () => {
  assert.ok(isDigits("\u00b2"));
  assert.ok(!/^\d+$/u.test("\u00b2"));
  assert.throws(() => digitsInt("\u00b2"), RangeError);
  assert.equal(digitsInt("\u0664\u0662"), 42);
});

test("parseIntText: the whole text an integer, or null", () => {
  assert.equal(parseIntText(" \u0663_4 "), 34);
  assert.equal(parseIntText("+5"), 5);
  assert.equal(parseIntText("1__2"), null);
  assert.equal(parseInt("1__2", 10), 1);
  assert.equal(parseIntText("1.0"), null);
  assert.equal(parseInt("1.0", 10), 1);
});

test("parseFloatText: the whole text a float, inf and nan by name", () => {
  assert.equal(parseFloatText(" 1_000.5 "), 1000.5);
  assert.equal(parseFloat(" 1_000.5 "), 1);
  assert.equal(parseFloatText("Infinity"), Infinity);
  assert.equal(parseFloatText("-inf"), -Infinity);
  assert.ok(Number.isNaN(parseFloatText("nan")));
  assert.equal(parseFloatText("1__0"), null);
  assert.equal(parseFloatText("0x10"), null);
  assert.equal(Number("0x10"), 16);
  assert.equal(parseFloatText(""), null);
  assert.equal(Number(""), 0);
  assert.equal(parseFloatText("\u0661.5"), 1.5);
  assert.equal(parseFloatText(".5e1"), 5);
});

test("toFloat: a bool, a number, a text or ASCII bytes, else null", () => {
  assert.equal(toFloat(true), 1);
  assert.equal(toFloat(new Uint8Array([0x31, 0x2e, 0x35])), 1.5);
  assert.equal(toFloat(new Uint8Array([0xc8])), null);
  assert.equal(toFloat(null), null);
  assert.equal(Number(null), 0);
  assert.equal(toFloat([1]), null);
  assert.equal(Number([1]), 1);
});

const MIXED = ["it's", 'q"', "a\u0000\u007f\u0085\u2028é", true, null,
  { k: [false] }, 1, 2.5, 1e-7];

test("valueText: str() of a value, escaping C0 controls and DEL", () => {
  assert.equal(valueText("x\u0000"), "x\u0000");
  assert.equal(valueText(null), "None");
  assert.equal(valueText(5), "5");
  assert.equal(valueText(MIXED),
    "[\"it's\", 'q\"', 'a\\x00\\x7f\u0085\u2028é', True, None, " +
    "{'k': [False]}, 1, 2.5, 1e-07]");
  assert.equal(String(MIXED[6]), "1");
  assert.equal(String([true]), "true");
});

test("printableText: str() of a value, escaping all isprintable refuses",
  () => {
    assert.equal(printableText("x\u0000"), "x\u0000");
    assert.equal(printableText(MIXED),
      "[\"it's\", 'q\"', 'a\\x00\\x7f\\x85\\u2028é', True, None, " +
      "{'k': [False]}, 1, 2.5, 1e-07]");
    assert.equal(printableText(["\u{e0001}\u00a0 "]), "['\\U000e0001\\xa0 ']");
  });

test("scalarEq: a bool equal to its 0 or 1", () => {
  assert.ok(scalarEq(true, 1));
  assert.ok(scalarEq(false, 0));
  assert.ok(!Object.is(true, 1));
  assert.ok(scalarEq("a", "a"));
  assert.ok(!scalarEq(1, "1"));
  assert.ok(!scalarEq(null, 0));
});

test("firstMax, firstMin: the first of equals, a NaN only when first", () => {
  assert.equal(firstMax([1, NaN]), 1);
  assert.ok(Number.isNaN(Math.max(1, NaN)));
  assert.ok(Number.isNaN(firstMax([NaN, 1])));
  assert.equal(firstMin([1, NaN]), 1);
  assert.ok(Number.isNaN(Math.min(1, NaN)));
  assert.ok(Object.is(firstMax([-0, 0]), -0));
  assert.ok(Object.is(Math.max(-0, 0), 0));
  assert.ok(Object.is(firstMin([0, -0]), 0));
  assert.ok(Object.is(Math.min(0, -0), -0));
  assert.equal(firstMax([3, 7, 5]), 7);
  assert.equal(firstMin([3, 7, 1]), 1);
});

test("parseJson: NaN and the infinities read, objects with no prototype",
  () => {
    const v = parseJson('{"a": NaN, "b": [-Infinity, Infinity]}') as {
      a: number, b: number[] };
    assert.ok(Number.isNaN(v.a));
    assert.deepEqual(v.b, [-Infinity, Infinity]);
    assert.throws(() => JSON.parse('{"a": NaN}'));
    assert.equal(Object.getPrototypeOf(parseJson("{}")), null);
    assert.throws(() => parseJson("[1,]"));
    assert.throws(() => parseJson("1 2"));
  });

test("stableJson: ASCII escapes, code-point key order, ints and floats",
  () => {
    const value = { b: 1, a: [1.5, 2, "x"], "😀": null, "\ue000": true,
      c: { z: 1e-7, y: 1e21, x: -0 } };
    assert.equal(stableJson(value, { sortKeys: true }),
      '{"a":[1.5,2,"x"],"b":1,"c":{"x":0,"y":1000000000000000000000,' +
      '"z":1e-07},"\\ue000":true,"\\ud83d\\ude00":null}');
    assert.notEqual(JSON.stringify(value), stableJson(value));
    assert.equal(stableJson("a\"b\\\n\r\t\b\f\u0001\u007fé😀\ud800/"),
      '"a\\"b\\\\\\n\\r\\t\\b\\f\\u0001\\u007f\\u00e9\\ud83d\\ude00' +
      '\\ud800/"');
    assert.equal(stableJson([NaN, Infinity, -Infinity, 1e16,
      123456789012345680000, 0.1]),
      "[NaN,Infinity,-Infinity,10000000000000000,123456789012345683968,0.1]");
    assert.equal(JSON.stringify([NaN, 1e21]), "[null,1e+21]");
  });

test("stableJson: the keys named in floats written with a fraction", () => {
  assert.equal(stableJson({ period_start: 1700000000, period_end: 2.5, n: 3,
    list: [1, 2] }, { floats: ["period_start", "period_end"] }),
    '{"period_start":1700000000.0,"period_end":2.5,"n":3,"list":[1,2]}');
  assert.equal(stableJson({ files: [[1, 2.5, "a"], 3] },
    { sortKeys: true, floats: [""] }),
    '{"files":[[1.0,2.5,"a"],3.0]}');
});

test("stableJson: a Map spaced, its entries in insertion order", () => {
  const offsets = new Map([["/a/😀é\"\\\n.jsonl", 123],
    ["b\u0001\u007f\ud800", 0], ["z", 9007199254740991]]);
  assert.equal(stableJson(offsets, { spaced: true }),
    '{"/a/\\ud83d\\ude00\\u00e9\\"\\\\\\n.jsonl": 123, ' +
    '"b\\u0001\\u007f\\ud800": 0, "z": 9007199254740991}');
  assert.equal(stableJson(new Map([["b", 1], ["a", 2]]), { spaced: true }),
    '{"b": 1, "a": 2}');
  assert.equal(stableJson(new Map(), { spaced: true }), "{}");
  assert.equal(JSON.stringify(offsets), "{}");
});

test("cmpStr: code-point order, not UTF-16 unit order", () => {
  const xs = ["😀", "\ue000", "a", ""];
  assert.deepEqual([...xs].sort(cmpStr), ["", "a", "\ue000", "😀"]);
  assert.deepEqual([...xs].sort(), ["", "a", "😀", "\ue000"]);
});

test("joinPath, baseName: nothing normalised", () => {
  assert.equal(joinPath("a", "/b"), "/b");
  assert.equal(joinPath("", "b"), "b");
  assert.equal(joinPath("a/", "b"), "a/b");
  assert.equal(joinPath("a//", "./b"), "a//./b");
  assert.equal(path.join("a//", "./b"), "a/b");
  assert.equal(baseName("a/b/"), "");
  assert.equal(path.basename("a/b/"), "b");
  assert.equal(baseName("a/b.jsonl"), "b.jsonl");
});

test("daysFromCivil, daysIn: the proleptic Gregorian calendar", () => {
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.equal(daysFromCivil(1969, 12, 31), -1);
  const year50 = new Date(0);
  year50.setUTCFullYear(50, 0, 1);
  assert.equal(daysFromCivil(50, 1, 1), year50.getTime() / 86400000);
  assert.notEqual(daysFromCivil(50, 1, 1), Date.UTC(50, 0, 1) / 86400000);
  assert.equal(daysIn(2000, 2), 29);
  assert.equal(daysIn(1900, 2), 28);
});

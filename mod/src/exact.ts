// The helpers that decide bytes exactly: one copy for every module.
//
// Each one makes, or reads, text that other bytes are compared with: the
// cache, state and calibration files the mod writes and reads back, the
// inputs of the hashes that name those files and scope their caches, the
// command input a custom usage command is handed, and the fixtures, goldens
// and cases the tests compare the band with byte for byte.  So each keeps
// one exact form, where JavaScript's own (JSON.stringify, \s, String(x),
// toFixed, Math.max, path.join, a UTF-16 index) would give other bytes for
// some input, and is named for the form it makes.  mod/test/exact.test.ts
// holds, for each, the inputs where the two differ.
//
//   - Text: utf8, UNICODE_SPACE and the stripping and splitting over it,
//     asciiDigits, and the code-point helpers (charLen, charSlice,
//     padField, padRight, cmpStr).
//   - Numbers as text: floatRepr, fixed, general, intText.
//   - Numbers from text: isDigits, digitsInt, parseIntText,
//     parseFloatText, toFloat.
//   - Values: valueText, printableText, scalarEq, firstMax, firstMin.
//   - JSON: parseJson and stableJson.
//   - Paths and dates: joinPath, baseName, daysFromCivil, daysIn.

import { isDict } from "./py.ts";
import type { Dict } from "./py.ts";

// ════════════════════════════════════════════════════════════════════════════
// Text.
// ════════════════════════════════════════════════════════════════════════════

/** UTF-8 to a string, strict with `fatal` and with U+FFFD for a bad byte
 * without: a leading byte-order mark kept with `keepBom` and dropped
 * without.
 *
 * Here, and not as TextDecoder's options at each reader, because the mod's
 * runtime takes `fatal` but not `ignoreBOM`: its decoder always drops the
 * mark, so the mark is put back by hand, alike in both runtimes. */
export function utf8(bytes: Uint8Array, fatal = false,
  keepBom = false): string {
  const text = (fatal ? STRICT : REPLACE).decode(bytes);
  return keepBom && bytes[0] === 0xef && bytes[1] === 0xbb &&
    bytes[2] === 0xbf ? "﻿" + text : text;
}

type DecoderWith = new (label: string,
  options: { fatal: boolean }) => TextDecoder;
const STRICT = new (TextDecoder as unknown as DecoderWith)("utf-8",
  { fatal: true });
const REPLACE = new TextDecoder("utf-8");

// Unicode's White_Space plus U+001C..U+001F, for a character class: the
// JavaScript \s has U+FEFF and lacks U+001C..U+001F and U+0085.
export const UNICODE_SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680" +
  "\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP = new RegExp(`^[${UNICODE_SPACE}]+|[${UNICODE_SPACE}]+$`, "gu");

/** `s` without UNICODE_SPACE at either end. */
export function stripSpace(s: string): string {
  return s.replace(STRIP, "");
}

/** The value of a Unicode decimal digit, which `\p{Nd}` matches: every
 * Nd run is 0..9 in order, so a digit's value is how far it sits from the
 * start of its run, modulo ten. */
function digitValue(ch: string): number {
  let cp = ch.codePointAt(0)!;
  if (cp >= 48 && cp <= 57) return cp - 48;
  let n = 0;
  while (/\p{Nd}/u.test(String.fromCodePoint(cp - 1))) {
    cp--;
    n++;
  }
  return n % 10;
}

/** Unicode decimal digits as ASCII ones, for parseInt and parseFloat,
 * which read only ASCII ones. */
export function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (c) => String(digitValue(c)));
}

// ════════════════════════════════════════════════════════════════════════════
// Strings by code point.
//
// A JavaScript string is one of UTF-16 units, so every emoji above U+FFFF
// is two to .length and .slice.  The formatters cut, count and pad by
// character, a code point, and do it here.
// ════════════════════════════════════════════════════════════════════════════

/** The code points in `s`. */
export function charLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** The code points of `s` from `start` to `end`, negative indices from the
 * end and both clamped: an omitted bound is null. */
export function charSlice(s: string, start: number | null = null,
  end: number | null = null): string {
  const cps = Array.from(s);
  const n = cps.length;
  const at = (i: number | null, dflt: number): number => {
    if (i === null) return dflt;
    if (i < 0) return Math.max(0, n + i);
    return Math.min(i, n);
  };
  const a = at(start, 0), b = at(end, n);
  return a < b ? cps.slice(a, b).join("") : "";
}

const RSTRIP_WS = new RegExp(`[${UNICODE_SPACE}]+$`, "u");
const LSTRIP_WS = new RegExp(`^[${UNICODE_SPACE}]+`, "u");

/** `s` without a run at its end of the characters in `chars`, or of
 * UNICODE_SPACE for null. */
export function stripEnd(s: string, chars: string | null = null): string {
  if (chars === null) return s.replace(RSTRIP_WS, "");
  const set = new Set(Array.from(chars));
  const cps = Array.from(s);
  while (cps.length && set.has(cps[cps.length - 1])) cps.pop();
  return cps.join("");
}

/** `s` without a run at its start of the characters in `chars`, or of
 * UNICODE_SPACE for null. */
export function stripStart(s: string, chars: string | null = null): string {
  if (chars === null) return s.replace(LSTRIP_WS, "");
  const set = new Set(Array.from(chars));
  const cps = Array.from(s);
  let i = 0;
  while (i < cps.length && set.has(cps[i])) i++;
  return cps.slice(i).join("");
}

/** The words of `s` between runs of UNICODE_SPACE, none at either end. */
export function splitSpace(s: string): string[] {
  const t = stripSpace(s);
  return t ? t.split(new RegExp(`[${UNICODE_SPACE}]+`, "u")) : [];
}

/** "%*s" % (w, s) when `left` is false, "%-*s" when it is true: padded
 * with blanks to `w` characters, and a negative `w` pads on the right
 * whichever was asked, as a negative star width does. */
export function padField(s: string, w: number, left = false): string {
  const pad = " ".repeat(Math.max(0, Math.abs(w) - charLen(s)));
  return left || w < 0 ? s + pad : pad + s;
}

/** `s` padded with blanks on the right to `w` characters. */
export function padRight(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - charLen(s)));
}

/** Code-point string order.  The default JavaScript order is by UTF-16
 * unit, and puts an astral character before U+E000..U+FFFF. */
export function cmpStr(a: string, b: string): number {
  const ia = a[Symbol.iterator](), ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next(), y = ib.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const cx = x.value.codePointAt(0)!, cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Numbers as text.
// ════════════════════════════════════════════════════════════════════════════

/** A float's shortest digits that round-trip, as String finds them, laid
 * out fixed between 1e-4 and 1e16 with a ".0" when integral, else
 * d.ddde+XX with at least two exponent digits; "nan", "inf", "-0.0". */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mant, e] = x.toExponential().split("e");
  const exp = Number(e);
  const neg = mant.startsWith("-");
  const digits = mant.replace(/^-/, "").replace(".", "");
  let body: string;
  if (exp >= -4 && exp < 16) {
    if (exp < 0) {
      body = "0." + "0".repeat(-exp - 1) + digits;
    } else if (digits.length <= exp + 1) {
      body = digits + "0".repeat(exp + 1 - digits.length) + ".0";
    } else {
      body = digits.slice(0, exp + 1) + "." + digits.slice(exp + 1);
    }
  } else {
    const m = digits.length > 1 ? digits[0] + "." + digits.slice(1)
      : digits;
    const a = Math.abs(exp);
    body = m + "e" + (exp < 0 ? "-" : "+") + (a < 10 ? "0" + a : String(a));
  }
  return (neg ? "-" : "") + body;
}

/** "%.*f" % (prec, x): the double's EXACT value rounded half to even,
 * which toFixed does not do (toFixed takes a tie up, so 2.5 is "3" to it
 * and "2" here), at any magnitude (toFixed turns exponential at 1e21).  A
 * negative zero keeps its sign, "-0.0", and a negative precision is none. */
export function fixed(x: number, prec: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const p = Math.max(0, Math.trunc(prec));
  const neg = x < 0 || Object.is(x, -0);
  // |x| = mant * 2**e, read straight off the IEEE bits.
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0), lo = view.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) {
    e = -1074;
  } else {
    mant |= 1n << 52n;
    e = bexp - 1075;
  }
  let num = mant * 10n ** BigInt(p), den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  let q = num / den;
  const twice = 2n * (num % den);
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  let s = q.toString();
  if (p > 0) {
    s = s.padStart(p + 1, "0");
    s = s.slice(0, -p) + "." + s.slice(-p);
  }
  return (neg ? "-" : "") + s;
}

/** "%g" % v: six significant digits, trailing zeros dropped, and an
 * exponent past them; rounded half to even, as `fixed` rounds. */
export function general(v: number): string {
  if (!Number.isFinite(v)) {
    return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  }
  if (v === 0) return Object.is(v, -0) ? "-0" : "0";
  const exp = parseInt(Math.abs(v).toExponential(5).split("e")[1], 10);
  const strip = (s: string) =>
    s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  if (exp >= -4 && exp < 6) return strip(fixed(v, 5 - exp));
  const [m, e] = v.toExponential(5).split("e");
  const n = parseInt(e, 10);
  return strip(m) + "e" + (n < 0 ? "-" : "+") +
    String(Math.abs(n)).padStart(2, "0");
}

/** "%d" % x: the number truncated toward zero, at any magnitude, where
 * String turns exponential at 1e21.  An infinity or a NaN has no integer,
 * and throws. */
export function intText(x: number): string {
  if (!Number.isFinite(x)) throw new RangeError("cannot convert " + x);
  return BigInt(Math.trunc(x)).toString();
}

// ════════════════════════════════════════════════════════════════════════════
// Numbers from text.
// ════════════════════════════════════════════════════════════════════════════

// The characters that are digits but not decimal ones: the superscripts,
// the subscripts and the circled and parenthesised digits, which are
// Numeric_Type=Digit.  JavaScript has no property for the type, so the
// ranges are written out; they are the ones a status line could plausibly
// be handed.
const DIGIT_NOT_DECIMAL = "\\u00b2\\u00b3\\u00b9\\u2070\\u2074-\\u2079" +
  "\\u2080-\\u2089\\u2460-\\u2468\\u2474-\\u247c\\u2488-\\u2490\\u24ea" +
  "\\u24f5-\\u24fd\\u24ff\\u2776-\\u277e\\u2780-\\u2788\\u278a-\\u2792";
const IS_DIGIT = new RegExp(`^[\\p{Nd}${DIGIT_NOT_DECIMAL}]+$`, "u");
const IS_DECIMAL = /^\p{Nd}+$/u;

/** Is `s` all digits, decimal or not (a superscript is one)? */
export function isDigits(s: string): boolean {
  return IS_DIGIT.test(s);
}

/** The integer a string isDigits passed spells: thrown, where it holds a
 * digit that is not a decimal one. */
export function digitsInt(s: string): number {
  if (!IS_DECIMAL.test(s)) {
    throw new RangeError("invalid literal for int(): " + s);
  }
  return parseInt(asciiDigits(s), 10);
}

const INT_TEXT = /^[+-]?\p{Nd}+(?:_\p{Nd}+)*$/u;

/** The integer the whole of `s` spells, blanks around it and single
 * underscores between digits allowed, or null. */
export function parseIntText(s: string): number | null {
  const t = stripSpace(s);
  if (!INT_TEXT.test(t)) return null;
  return parseInt(asciiDigits(t).replaceAll("_", ""), 10);
}

const DIGITS = "[0-9](?:_?[0-9])*";
const FLOAT_TEXT = new RegExp(
  "^[+-]?(?:(?:" + DIGITS + "(?:\\.(?:" + DIGITS + ")?)?|\\." + DIGITS +
  ")(?:[eE][+-]?" + DIGITS + ")?|inf|infinity|nan)$", "i");

/** The float the whole of `text` spells, or null: any Unicode decimal
 * digit read as its ASCII one, blanks around it and single underscores
 * between digits allowed, and inf, infinity and nan by name in any case. */
export function parseFloatText(text: string): number | null {
  const s = stripSpace(asciiDigits(text));
  if (!FLOAT_TEXT.test(s)) return null;
  const body = s.replace(/^[+-]/, "").toLowerCase();
  const sign = s.startsWith("-") ? -1 : 1;
  if (body === "nan") return NaN;
  if (body === "inf" || body === "infinity") return sign * Infinity;
  return Number(s.replaceAll("_", ""));
}

/** A value as a float: a bool as 0 or 1, a number as itself, a string by
 * parseFloatText, bytes (a plist's <data>) read as ASCII; else null. */
export function toFloat(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloatText(value);
  if (value instanceof Uint8Array) {
    if (value.some((b) => b > 127)) return null;
    return parseFloatText(String.fromCharCode(...value));
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// Values.
// ════════════════════════════════════════════════════════════════════════════

/** A JSON value as text: a string as itself, anything else as valueRepr
 * writes it.  JSON's 5 and 5.0 are one number here, so a whole number
 * prints as an integer. */
export function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  return valueRepr(value);
}

/** A JSON value as a literal: None, True, False, a whole number as an
 * integer and any other by floatRepr, a string quoted with its C0 controls
 * and DEL escaped (and nothing else), lists and objects ", "-separated. */
function valueRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") {
    return Number.isInteger(value) ? BigInt(value).toString()
      : floatRepr(value);
  }
  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let out = "";
    for (const ch of value) {
      const code = ch.codePointAt(0)!;
      if (ch === "\\" || ch === quote) out += "\\" + ch;
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (code < 32 || code === 127) {
        out += "\\x" + code.toString(16).padStart(2, "0");
      } else out += ch;
    }
    return quote + out + quote;
  }
  if (Array.isArray(value)) {
    return "[" + value.map(valueRepr).join(", ") + "]";
  }
  if (isDict(value)) {
    return "{" + Object.entries(value)
      .map(([k, v]) => valueRepr(k) + ": " + valueRepr(v)).join(", ") + "}";
  }
  return String(value);
}

// The characters printableRepr escapes: the C and Z categories but the
// space.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** A JSON value as text: a string as itself, anything else as
 * printableRepr writes it, as `"%s" % v` prints a list or a dict. */
export function printableText(v: unknown): string {
  return typeof v === "string" ? v : printableRepr(v);
}

/** A JSON value as a literal, as valueRepr writes it but with every
 * character UNPRINTABLE matches escaped, as \xXX, \uXXXX or \UXXXXXXXX. */
function printableRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") {
    return Number.isInteger(v) ? BigInt(v).toString() : floatRepr(v);
  }
  if (typeof v === "string") {
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    let out = q;
    for (const ch of v) {
      const cp = ch.codePointAt(0)!;
      if (ch === q || ch === "\\") out += "\\" + ch;
      else if (ch === "\t") out += "\\t";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch !== " " && UNPRINTABLE.test(ch)) {
        const h = cp.toString(16);
        out += cp < 0x100 ? "\\x" + h.padStart(2, "0")
          : cp < 0x10000 ? "\\u" + h.padStart(4, "0")
          : "\\U" + h.padStart(8, "0");
      } else out += ch;
    }
    return out + q;
  }
  if (Array.isArray(v)) return "[" + v.map(printableRepr).join(", ") + "]";
  if (isDict(v)) {
    return "{" + Object.entries(v)
      .map(([k, x]) => printableRepr(k) + ": " + printableRepr(x))
      .join(", ") + "}";
  }
  return String(v);
}

/** Equality of two JSON scalars, a bool equal to its 0 or 1, as a profile
 * id is matched. */
export function scalarEq(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (typeof v === "boolean" ? Number(v) : v);
  return n(a) === n(b);
}

/** The largest of xs, the first of equals, and a NaN only where it comes
 * first, where Math.max takes any NaN.  xs not empty. */
export function firstMax(xs: readonly number[]): number {
  let m = xs[0];
  for (let i = 1; i < xs.length; i++) if (xs[i] > m) m = xs[i];
  return m;
}

/** The smallest of xs, the first of equals, and a NaN only where it comes
 * first, where Math.min takes any NaN.  xs not empty. */
export function firstMin(xs: readonly number[]): number {
  let m = xs[0];
  for (let i = 1; i < xs.length; i++) if (xs[i] < m) m = xs[i];
  return m;
}

// ════════════════════════════════════════════════════════════════════════════
// JSON.
// ════════════════════════════════════════════════════════════════════════════

/** JSON, plus NaN, Infinity and -Infinity, which stableJson writes and
 * JSON.parse refuses: a command printing one would otherwise be a failed
 * reading rather than a reading with that one field missing.  An object
 * comes back with no prototype, so a key "constructor" is its own. */
export function parseJson(text: string): unknown {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError("invalid JSON at " + i);
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
  const value = (): unknown => {
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      const obj: Dict = Object.create(null);
      ws();
      if (text[i] === "}") { i++; return obj; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const key = string();
        ws();
        if (text[i++] !== ":") fail();
        obj[key] = value();
        ws();
        const sep = text[i++];
        if (sep === "}") return obj;
        if (sep !== ",") fail();
      }
    }
    if (ch === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(value());
        ws();
        const sep = text[i++];
        if (sep === "]") return arr;
        if (sep !== ",") fail();
      }
    }
    if (ch === '"') return string();
    for (const [word, val] of [["true", true], ["false", false],
                               ["null", null], ["NaN", NaN],
                               ["Infinity", Infinity],
                               ["-Infinity", -Infinity]] as const) {
      if (text.startsWith(word, i)) { i += word.length; return val; }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) fail();
    i += m![0].length;
    return Number(m![0]);
  };
  const string = (): string => {
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail();
      const ch = text[i++];
      if (ch === '"') return out;
      if (ch < " ") fail();
      if (ch !== "\\") { out += ch; continue; }
      const esc = text[i++];
      const simple: Dict = { '"': '"', "\\": "\\", "/": "/", b: "\b",
                             f: "\f", n: "\n", r: "\r", t: "\t" };
      if (esc !== undefined && Object.hasOwn(simple, esc)) {
        out += simple[esc];
      } else if (esc === "u") {
        const hex = text.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else fail();
    }
  };
  const result = value();
  ws();
  if (i !== text.length) fail();
  return result;
}

/** What stableJson writes beyond its defaults. */
export type StableJsonOptions = {
  /** Each object's keys in cmpStr's order, not as they were set. */
  readonly sortKeys?: boolean;
  /** The keys whose whole numbers are written as floats, with ".0"; ""
   * names the top level and every list's items. */
  readonly floats?: readonly string[];
  /** ", " and ": " between items, not "," and ":". */
  readonly spaced?: boolean;
};

/** A value as JSON in one fixed form: ASCII only, every other character
 * escaped as \uXXXX (an astral one as its two surrogates); a whole number
 * as an integer, every digit written, and any other by floatRepr; NaN,
 * Infinity and -Infinity by name.  A Map is an object, its entries in
 * insertion order. */
export function stableJson(value: unknown,
  options: StableJsonOptions = {}): string {
  const { sortKeys = false, floats = [], spaced = false } = options;
  const comma = spaced ? ", " : ",", colon = spaced ? ": " : ":";
  const write = (v: unknown, key: string): string => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") {
      if (Number.isNaN(v)) return "NaN";
      if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
      if (Number.isInteger(v) && !floats.includes(key)) {
        return BigInt(v).toString();
      }
      return floatRepr(v);
    }
    if (typeof v === "string") return jsonString(v);
    if (Array.isArray(v)) {
      return "[" + v.map((x) => write(x, "")).join(comma) + "]";
    }
    const entries: [string, unknown][] | null = v instanceof Map ? [...v]
      : isDict(v) ? Object.entries(v) : null;
    if (entries === null) throw new TypeError("not JSON serializable");
    if (sortKeys) entries.sort(([a], [b]) => cmpStr(a, b));
    return "{" + entries.map(([k, x]) => jsonString(k) + colon + write(x, k))
      .join(comma) + "}";
  };
  return write(value, "");
}

/** A string as JSON, ASCII only. */
function jsonString(value: string): string {
  let out = '"';
  for (let j = 0; j < value.length; j++) {
    const c = value.charCodeAt(j);
    const ch = value[j];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 32 || c > 126) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else out += ch;
  }
  return out + '"';
}

// ════════════════════════════════════════════════════════════════════════════
// Paths and dates.
// ════════════════════════════════════════════════════════════════════════════

/** Two path parts joined with one "/", which unlike path.join normalises
 * nothing: an absolute `b` replaces `a`, and a `b` after an `a` ending in
 * "/" is appended as it is. */
export function joinPath(a: string, b: string): string {
  if (b.startsWith("/")) return b;
  return a === "" || a.endsWith("/") ? a + b : a + "/" + b;
}

/** The part of `p` after its last "/", which unlike path.basename keeps a
 * trailing slash's empty name. */
export function baseName(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Days from 1970-01-01 to y-m-d in the proleptic Gregorian calendar, any
 * year, where Date.UTC reads a year under 100 as 19xx. */
export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The days in month m of year y. */
export function daysIn(y: number, m: number): number {
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// The YAML the configuration files are written in: a reader for the part
// of YAML 1.2 they need, and a writer of values in YAML's flow style for
// the warnings that quote them.
//
// The reader is a scanner over the text's lines and a recursive descent
// over its nodes.  It reads:
//
//   - block mappings and block sequences, a sequence's compact forms
//     (`- key: value`, `- - item`) among them, and a sequence at its
//     key's own indentation;
//   - flow sequences `[...]` and flow mappings `{...}`, over several lines;
//   - plain, single-quoted and double-quoted scalars, each on one line,
//     with every escape of a double-quoted one;
//   - `#` comments, and one `---` before the document.
//
// A plain scalar is resolved by YAML 1.2's core schema: `null`, `~` and
// nothing are null; `true` and `false`, and their Title and UPPER forms,
// are booleans; an integer (decimal, `0o` or `0x`) is a bigint and a float
// a number, so 1 is told from 1.0; anything else, `no`, `on` and `yes`
// among them, is a string.  A mapping is a Map, whose keys keep the order
// written.
//
// Anything past that part is a YamlError naming its line and column, never
// a value read some other way: anchors, aliases, tags, block scalars (`|`
// and `>`), directives, explicit keys (`?`), a second document, a scalar
// continued onto another line, a tab that indents, a key given twice, and a
// key that is no string.
import { floatRepr } from "./exact.ts";

/** A value the reader gives. */
export type Yaml = null | boolean | bigint | number | string | Yaml[] |
  Map<string, Yaml>;

/** Text that is not YAML the reader reads, at a line and a column, both
 * counted from 1. */
export class YamlError extends SyntaxError {
  readonly line: number;
  readonly column: number;
  readonly what: string;
  constructor(line: number, column: number, what: string) {
    super(`line ${line}, column ${column}: ${what}`);
    this.name = "YamlError";
    this.line = line;
    this.column = column;
    this.what = what;
  }
}

// ── The core schema ───────────────────────────────────────────────────────

const NULLS = new Set(["", "~", "null", "Null", "NULL"]);
const TRUES = new Set(["true", "True", "TRUE"]);
const FALSES = new Set(["false", "False", "FALSE"]);
const INT = /^[-+]?[0-9]+$|^0o[0-7]+$|^0x[0-9a-fA-F]+$/;
const FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const INF = /^[-+]?\.(?:inf|Inf|INF)$/;
const NAN = /^\.(?:nan|NaN|NAN)$/;

/** The value a plain scalar's text stands for, by the core schema. */
export function resolvePlain(text: string): Yaml {
  if (NULLS.has(text)) return null;
  if (TRUES.has(text)) return true;
  if (FALSES.has(text)) return false;
  if (INT.test(text)) {
    return text.startsWith("+") ? BigInt(text.slice(1)) : BigInt(text);
  }
  if (FLOAT.test(text)) return Number(text);
  if (INF.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  if (NAN.test(text)) return NaN;
  return text;
}

// ── The reader ────────────────────────────────────────────────────────────

const FLOW = ",[]{}";
const isWs = (c: string | undefined): boolean => c === " " || c === "\t";

const ESCAPES: { readonly [c: string]: string } = {
  "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v",
  f: "\f", r: "\r", e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\",
  N: "\x85", _: "\xa0", L: " ", P: " " };
const HEX_DIGITS: { readonly [c: string]: number } = { x: 2, u: 4, U: 8 };
const HEX = "0123456789abcdefABCDEF";

/** Whether `code` may stand in a YAML stream: a printable character, a tab
 * or a line break. */
function printable(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x85) {
    return true;
  }
  return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) ||
    code === 0xfffe || code === 0xffff);
}

class Reader {
  private readonly lines: string[];
  private ln = 0;
  private col = 0;

  constructor(text: string) {
    this.lines = (text.startsWith("﻿") ? text.slice(1) : text)
      .split(/\r\n|\r|\n/);
    this.lines.forEach((line, l) => {
      for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i);
        if (!printable(code)) {
          this.fail("the control character U+" +
            code.toString(16).toUpperCase().padStart(4, "0") +
            " is not allowed; write it as an escape in double quotes", l, i);
        }
      }
    });
  }

  private fail(what: string, ln = this.ln, col = this.col): never {
    throw new YamlError(ln + 1, col + 1, what);
  }

  private get line(): string {
    return this.lines[this.ln] ?? "";
  }

  /** The character `ahead` past the cursor, "" past the line's end. */
  private ch(ahead = 0): string {
    return this.line[this.col + ahead] ?? "";
  }

  // ── Lines ───────────────────────────────────────────────────────────

  private indentOf(l: number): number {
    const line = this.lines[l];
    let i = 0;
    while (line[i] === " ") i++;
    return i;
  }

  /** Whether line `l` holds anything but blanks and a comment. */
  private isContent(l: number): boolean {
    const line = this.lines[l];
    let i = 0;
    while (isWs(line[i])) i++;
    return i < line.length && line[i] !== "#";
  }

  /** Whether line `l` is a document marker, `---` or `...`. */
  private isMarker(l: number): boolean {
    const line = this.lines[l];
    return (line.startsWith("---") || line.startsWith("...")) &&
      (line.length === 3 || isWs(line[3]));
  }

  /** Line `l`, a content line, checked for what may not start one. */
  private checkLine(l: number): void {
    const line = this.lines[l];
    if (this.isMarker(l)) {
      this.fail("a second document, or a document end, is not supported",
        l, 0);
    }
    if (line.startsWith("%")) this.fail("directives (%) are not supported", l, 0);
    const ind = this.indentOf(l);
    if (line[ind] === "\t") this.fail("a tab cannot indent; use spaces", l, ind);
  }

  /** The next content line after the cursor's, checked, or -1. */
  private peekLine(): number {
    for (let l = this.ln + 1; l < this.lines.length; l++) {
      if (!this.isContent(l)) continue;
      this.checkLine(l);
      return l;
    }
    return -1;
  }

  /** The cursor to line `l`'s first character past its indentation. */
  private goto(l: number): void {
    this.ln = l;
    this.col = this.indentOf(l);
  }

  /** Past the blanks at the cursor: whether the line ends there, or a
   * comment starts. */
  private restBlank(): boolean {
    while (isWs(this.ch())) this.col++;
    const c = this.ch();
    return c === "" ||
      (c === "#" && (this.col === 0 || isWs(this.line[this.col - 1])));
  }

  private endLine(): void {
    if (this.restBlank()) return;
    if (this.ch() === ":") {
      this.fail("a colon and a blank start a mapping value, which is not " +
        "allowed here; quote the value if it holds one");
    }
    if (this.ch() === "#") this.fail("a comment (#) must follow a blank");
    this.fail("unexpected text after the value");
  }

  private isSeqEntryAt(l: number, col: number): boolean {
    const line = this.lines[l];
    return line[col] === "-" && (col + 1 >= line.length || isWs(line[col + 1]));
  }

  private isSeqEntry(): boolean {
    return this.isSeqEntryAt(this.ln, this.col);
  }

  // ── The document ────────────────────────────────────────────────────

  read(): Yaml {
    let first = -1;
    let started = false;
    for (let l = 0; l < this.lines.length; l++) {
      if (!this.isContent(l)) continue;
      if (!started && this.lines[l].startsWith("---") && this.isMarker(l)) {
        started = true;
        this.ln = l;
        this.col = 3;
        if (!this.restBlank()) {
          this.fail("a node on the --- line is not supported; start it on " +
            "the next line");
        }
        continue;
      }
      this.checkLine(l);
      first = l;
      break;
    }
    if (first < 0) return null;
    this.goto(first);
    const value = this.blockNode(-1);
    this.endLine();
    const l = this.peekLine();
    if (l >= 0) {
      this.fail("unexpected text after the document's node", l,
        this.indentOf(l));
    }
    return value;
  }

  // ── Block nodes ─────────────────────────────────────────────────────

  /** The node at the cursor, inside a block indented `parent`. */
  private blockNode(parent: number): Yaml {
    const n = this.col;
    if (this.isSeqEntry()) return this.blockSeq(n);
    if (this.ch() === "?" && (this.ch(1) === "" || isWs(this.ch(1)))) {
      this.fail("explicit keys (?) are not supported");
    }
    if (this.keyAhead()) return this.blockMap(n);
    return this.inline(parent);
  }

  /** The block mapping whose keys are at column `n`, from the cursor. */
  private blockMap(n: number): Map<string, Yaml> {
    const map = new Map<string, Yaml>();
    for (;;) {
      if (this.isSeqEntry()) {
        this.fail("a sequence entry where a mapping key was expected");
      }
      if (this.ch() === "?" && (this.ch(1) === "" || isWs(this.ch(1)))) {
        this.fail("explicit keys (?) are not supported");
      }
      if (!this.keyAhead()) this.fail("expected a key, a colon and a blank");
      const [kl, kc] = [this.ln, this.col];
      const key = this.key(false);
      if (map.has(key)) {
        this.fail(`the key ${yamlFlow(key)} is given twice`, kl, kc);
      }
      while (isWs(this.ch())) this.col++;
      this.col++; // the colon keyAhead found
      map.set(key, this.valueAfter(n, true));
      this.endLine();
      const l = this.peekLine();
      if (l < 0) break;
      const ind = this.indentOf(l);
      if (ind < n) break;
      if (ind > n) this.fail("unexpected indentation", l, ind);
      this.goto(l);
    }
    return map;
  }

  /** The block sequence whose dashes are at column `n`, from the cursor. */
  private blockSeq(n: number): Yaml[] {
    const seq: Yaml[] = [];
    for (;;) {
      this.col++; // the dash
      seq.push(this.valueAfter(n, false));
      this.endLine();
      const l = this.peekLine();
      if (l < 0) break;
      const ind = this.indentOf(l);
      if (ind < n) break;
      if (ind > n) this.fail("unexpected indentation", l, ind);
      if (!this.isSeqEntryAt(l, ind)) break;
      this.goto(l);
    }
    return seq;
  }

  /** The value after a key's colon (`inMap`) or a sequence's dash, in a
   * block indented `n`: on the line, on the lines under it, or null. */
  private valueAfter(n: number, inMap: boolean): Yaml {
    if (this.restBlank()) {
      const l = this.peekLine();
      if (l < 0) return null;
      const ind = this.indentOf(l);
      if (ind > n) {
        this.goto(l);
        return this.blockNode(n);
      }
      if (inMap && ind === n && this.isSeqEntryAt(l, ind)) {
        this.goto(l);
        return this.blockSeq(n);
      }
      return null;
    }
    if (!inMap) return this.blockNode(n);
    if (this.isSeqEntry()) {
      this.fail("a block sequence cannot start on its key's line");
    }
    if (this.keyAhead()) {
      this.fail("a block mapping cannot start on its key's line");
    }
    return this.inline(n);
  }

  /** Whether a key, a colon and a blank are at the cursor. */
  private keyAhead(): boolean {
    const line = this.line;
    const from = this.col;
    const c = line[from];
    let end: number;
    if (c === '"' || c === "'") {
      end = this.quotedEnd(from);
      if (end < 0) return false;
    } else if (c !== undefined && this.startFault(from, false) === null) {
      end = this.plainEnd(from, false);
    } else {
      return false;
    }
    while (isWs(line[end])) end++;
    return line[end] === ":" && (end + 1 >= line.length || isWs(line[end + 1]));
  }

  /** The key at the cursor, a string. */
  private key(flow: boolean): string {
    const [kl, kc] = [this.ln, this.col];
    const c = this.ch();
    if (c === '"' || c === "'") return this.quoted();
    if (c === "[" || c === "{") {
      this.fail("a collection as a key is not supported");
    }
    const fault = this.startFault(this.col, flow);
    if (fault !== null) this.fail(fault);
    const text = this.plain(flow);
    const value = resolvePlain(text);
    if (typeof value !== "string") {
      this.fail(`the key ${text} is no string; quote it`, kl, kc);
    }
    return value;
  }

  /** A scalar or a flow collection at the cursor, in a block indented
   * `parent`. */
  private inline(parent: number): Yaml {
    const c = this.ch();
    if (c === "[" || c === "{") return this.flow(parent);
    if (c === '"' || c === "'") return this.quoted();
    const fault = this.startFault(this.col, false);
    if (fault !== null) this.fail(fault);
    return resolvePlain(this.plain(false));
  }

  // ── Scalars ─────────────────────────────────────────────────────────

  /** Why a plain scalar cannot start at `from` on the cursor's line, or
   * null when it can. */
  private startFault(from: number, flow: boolean): string | null {
    const line = this.line;
    const c = line[from];
    const next = line[from + 1];
    switch (c) {
      case "&": return "anchors (&) are not supported";
      case "*": return "aliases (*) are not supported";
      case "!": return "tags (!) are not supported";
      case "|":
      case ">": return "block scalars (| and >) are not supported";
      case "%": return "a plain scalar cannot start with %; quote it";
      case "@":
      case "`": return `${c} is reserved; quote the scalar`;
      case "#": return "a comment (#) must follow a blank";
      case ",":
      case "[":
      case "]":
      case "{":
      case "}": return `unexpected ${c}`;
      case "-":
      case "?":
      case ":":
        if (next === undefined || isWs(next) ||
            (flow && FLOW.includes(next))) {
          if (c === "-") {
            return flow ? "a block sequence entry (-) is not allowed in a " +
              "flow collection" : "unexpected -";
          }
          return c === "?" ? "explicit keys (?) are not supported"
            : "unexpected :";
        }
        return null;
      default:
        return null;
    }
  }

  /** Where the plain scalar starting at `from` ends, its trailing blanks
   * left out: at a colon and a blank, at a blank and a #, at the line's
   * end, and in a flow collection at a flow indicator. */
  private plainEnd(from: number, flow: boolean): number {
    const line = this.line;
    let end = from;
    for (let i = from; i < line.length; i++) {
      const c = line[i];
      if (c === ":") {
        const next = line[i + 1];
        if (next === undefined || isWs(next) || (flow && FLOW.includes(next))) {
          break;
        }
      } else if (c === "#" && i > from && isWs(line[i - 1])) {
        break;
      } else if (flow && FLOW.includes(c)) {
        break;
      }
      if (!isWs(c)) end = i + 1;
    }
    return end;
  }

  private plain(flow: boolean): string {
    const end = this.plainEnd(this.col, flow);
    const text = this.line.slice(this.col, end);
    this.col = end;
    return text;
  }

  /** Just past the quoted scalar starting at `from`, or -1 when it does
   * not close on its line. */
  private quotedEnd(from: number): number {
    const line = this.line;
    const q = line[from];
    for (let i = from + 1; i < line.length; i++) {
      if (q === '"' && line[i] === "\\") {
        i++;
      } else if (line[i] === q) {
        if (q === "'" && line[i + 1] === "'") {
          i++;
          continue;
        }
        return i + 1;
      }
    }
    return -1;
  }

  /** The quoted scalar at the cursor. */
  private quoted(): string {
    const q = this.ch();
    const [sl, sc] = [this.ln, this.col];
    this.col++;
    let out = "";
    for (;;) {
      const c = this.ch();
      if (c === "") {
        this.fail("a quoted scalar must close on its own line", sl, sc);
      }
      if (c === q) {
        if (q === "'" && this.ch(1) === "'") {
          out += "'";
          this.col += 2;
          continue;
        }
        this.col++;
        return out;
      }
      if (q === '"' && c === "\\") {
        out += this.escape();
        continue;
      }
      out += c;
      this.col++;
    }
  }

  /** The escape at the cursor, in a double-quoted scalar. */
  private escape(): string {
    const e = this.ch(1);
    if (e === "") {
      this.fail("a quoted scalar continued onto the next line is not " +
        "supported");
    }
    if (Object.hasOwn(ESCAPES, e)) {
      this.col += 2;
      return ESCAPES[e];
    }
    if (Object.hasOwn(HEX_DIGITS, e)) {
      const width = HEX_DIGITS[e];
      const hex = this.line.slice(this.col + 2, this.col + 2 + width);
      if (hex.length !== width || ![...hex].every((h) => HEX.includes(h))) {
        this.fail(`\\${e} takes ${width} hexadecimal digits`);
      }
      const code = parseInt(hex, 16);
      if (code > 0x10ffff) this.fail(`\\${e}${hex} is no character`);
      this.col += 2 + width;
      return String.fromCodePoint(code);
    }
    return this.fail(`unknown escape \\${e}`);
  }

  // ── Flow collections ────────────────────────────────────────────────

  /** Past blanks, comments and line breaks inside a flow collection
   * opened at (`ol`, `oc`), in a block indented `parent`. */
  private flowSkip(parent: number, ol: number, oc: number): void {
    for (;;) {
      const c = this.ch();
      if (isWs(c)) {
        this.col++;
      } else if (c === "#" && (this.col === 0 || isWs(this.line[this.col - 1]))) {
        this.col = this.line.length;
      } else if (c === "") {
        if (this.ln + 1 >= this.lines.length) {
          this.fail(`this ${this.lines[ol][oc]} is never closed`, ol, oc);
        }
        this.ln++;
        this.col = 0;
        if (this.isContent(this.ln)) {
          if (this.isMarker(this.ln)) {
            this.fail(`this ${this.lines[ol][oc]} is never closed`, ol, oc);
          }
          const ind = this.indentOf(this.ln);
          if (ind <= parent) {
            this.fail("a flow collection's lines must be indented past its " +
              "block's", this.ln, ind);
          }
        }
      } else {
        return;
      }
    }
  }

  /** The flow collection at the cursor, in a block indented `parent`. */
  private flow(parent: number): Yaml {
    const [ol, oc] = [this.ln, this.col];
    const open = this.ch();
    this.col++;
    if (open === "[") {
      const seq: Yaml[] = [];
      for (;;) {
        this.flowSkip(parent, ol, oc);
        if (this.ch() === "]") {
          this.col++;
          return seq;
        }
        seq.push(this.flowValue(parent));
        this.flowSkip(parent, ol, oc);
        const c = this.ch();
        this.col++;
        if (c === "]") return seq;
        if (c === ",") continue;
        this.col--;
        if (c === ":") {
          this.fail("a key and value in a flow sequence is not supported; " +
            "write it as {key: value}");
        }
        this.fail("expected , or ] in a flow sequence");
      }
    }
    const map = new Map<string, Yaml>();
    for (;;) {
      this.flowSkip(parent, ol, oc);
      if (this.ch() === "}") {
        this.col++;
        return map;
      }
      const [kl, kc] = [this.ln, this.col];
      if (this.ch() === "?" && (this.ch(1) === "" || isWs(this.ch(1)))) {
        this.fail("explicit keys (?) are not supported");
      }
      if (this.ch() === ",") this.fail("expected a key");
      const key = this.key(true);
      if (map.has(key)) {
        this.fail(`the key ${yamlFlow(key)} is given twice`, kl, kc);
      }
      while (isWs(this.ch())) this.col++;
      if (this.ch() !== ":") this.fail("expected : after the key");
      this.col++;
      this.flowSkip(parent, ol, oc);
      const c = this.ch();
      map.set(key, c === "," || c === "}" ? null : this.flowValue(parent));
      this.flowSkip(parent, ol, oc);
      const sep = this.ch();
      this.col++;
      if (sep === "}") return map;
      if (sep === ",") continue;
      this.col--;
      this.fail("expected , or } in a flow mapping");
    }
  }

  /** A value inside a flow collection, at the cursor. */
  private flowValue(parent: number): Yaml {
    const c = this.ch();
    if (c === "[" || c === "{") return this.flow(parent);
    if (c === '"' || c === "'") return this.quoted();
    if (c === "," || c === "]" || c === "}") this.fail("expected a value");
    const fault = this.startFault(this.col, true);
    if (fault !== null) this.fail(fault);
    return resolvePlain(this.plain(true));
  }
}

/** The one document `text` holds, null for none; a YamlError where the
 * text is not YAML this reads. */
export function parseYaml(text: string): Yaml {
  return new Reader(text).read();
}

// ── The writer ────────────────────────────────────────────────────────────

/** What yamlFlow writes: a value the reader gives, or one of the plain
 * objects and lists the options are kept as. */
export type Flowable = Yaml | readonly Flowable[] |
  { readonly [key: string]: Flowable };

const SHORT_ESCAPES: { readonly [c: string]: string } = {
  "\0": "\\0", "\x07": "\\a", "\b": "\\b", "\t": "\\t", "\n": "\\n",
  "\v": "\\v", "\f": "\\f", "\r": "\\r", "\x1b": "\\e", '"': '\\"',
  "\\": "\\\\", "\x85": "\\N", " ": "\\L", " ": "\\P" };

/** Whether `s` reads back as itself written plain, in a flow collection or
 * after a key. */
function plainSafe(s: string): boolean {
  if (s === "" || typeof resolvePlain(s) !== "string") return false;
  if (isWs(s[0]) || isWs(s[s.length - 1])) return false;
  if ("-?:,[]{}#&*!|>'\"%@`".includes(s[0])) return false;
  if (s.includes(": ") || s.includes(" #") || s.endsWith(":")) return false;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (FLOW.includes(ch) || code < 0x20 || (code >= 0x7f && code <= 0x9f) ||
        code === 0x2028 || code === 0x2029 || code === 0xfeff ||
        (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe ||
        code === 0xffff) {
      return false;
    }
  }
  return true;
}

function doubleQuoted(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (Object.hasOwn(SHORT_ESCAPES, ch)) {
      out += SHORT_ESCAPES[ch];
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      out += "\\x" + code.toString(16).padStart(2, "0");
    } else if (code === 0xfeff || code === 0xfffe || code === 0xffff ||
               (code >= 0xd800 && code <= 0xdfff)) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else {
      out += ch;
    }
  }
  return out + '"';
}

function number(x: number, whole: boolean): string {
  if (Number.isNaN(x)) return ".nan";
  if (!Number.isFinite(x)) return x > 0 ? ".inf" : "-.inf";
  return whole && Number.isInteger(x) ? String(x) : floatRepr(x);
}

function write(value: Flowable, whole: boolean): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return number(value, whole);
  if (typeof value === "string") {
    return plainSafe(value) ? value : doubleQuoted(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => write(v, whole)).join(", ") + "]";
  }
  const entries = value instanceof Map ? [...value]
    : Object.entries(value as { readonly [key: string]: Flowable });
  return "{" + entries.map(([k, v]) => write(k, whole) + ": " +
    write(v, whole)).join(", ") + "}";
}

/** `value` in YAML's flow style, on one line, reading back as itself: a
 * string plain where it can be, else double-quoted, and a number a float,
 * 1.0 told from the bigint 1. */
export function yamlFlow(value: Flowable): string {
  return write(value, false);
}

/** `value` as yamlFlow writes it, but a whole number written as an
 * integer: for the options, whose numbers are kept as numbers. */
export function yamlOption(value: Flowable): string {
  return write(value, true);
}

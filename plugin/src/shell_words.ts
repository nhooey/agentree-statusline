// A shell command split into words as a shell splits it, and the short
// form the band's tree draws a background task's command in (band_tree.ts,
// "The tree" in docs/layout.md).  Pure.
//
// The tokenizer reads the POSIX shell's quoting: single quotes, double
// quotes with their backslash escapes, `$'…'`, a backslash outside quotes,
// `$(…)`, `${…}` and backquotes inside a word, `#` comments and the
// control and redirection operators.  It gives up, null, on what it does
// not read: an unterminated quote or substitution, a here-document
// (`<<`) or a process substitution (`<(`, `>(`).

import { BG_NEWLINE } from "./claude_records.ts";
import { expanded, joined } from "./shell_log.ts";

/** A word: its text as written (`raw`), and as the shell hands it on
 * (`value`), its quotes taken off and its escapes read, with any
 * expansion, `$…` or a backquote, left as written; `plain` where it has
 * no expansion and no unquoted glob character. */
export type Word = {
  readonly kind: "word";
  readonly raw: string;
  readonly value: string;
  readonly plain: boolean;
  readonly at: number;
  readonly end: number;
};

/** A control operator (`&&`, `||`, `|`, `|&`, `;`, `;;`, `&`, `(`, `)`)
 * or a line break, `\n`. */
export type Op = {
  readonly kind: "op";
  readonly op: string;
  readonly at: number;
  readonly end: number;
};

/** A redirection operator, with its file descriptor where one is written
 * (`2>`, `2>&`, `&>`, `>>`, `<`); `out` where it redirects output.  Its
 * target is the next word. */
export type Redirect = {
  readonly kind: "redirect";
  readonly op: string;
  readonly out: boolean;
  readonly at: number;
  readonly end: number;
};

export type Token = Word | Op | Redirect;

/** The control operators, longest first. */
const OPS = ["&&", "||", "|&", ";;", "|", ";", "&", "(", ")", "\n"];

/** The redirection operators after an optional descriptor, longest first;
 * `<<` is a here-document's, which the tokenizer does not read. */
const REDIRECTS = [">>", ">|", ">&", "<<<", "<<", "<>", "<&", ">", "<"];

/** Where the characters that end an unquoted word stand. */
const BREAKS = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")", "<",
  ">"]);

/** The index after the `close` that matches the `open` at `i` (`$(` or
 * `${`, whose `$` is at `i`), past quotes and nested substitutions; -1
 * where none does. */
function closing(s: string, i: number, open: string, close: string):
  number {
  let depth = 0;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === "'") {
      j = s.indexOf("'", j + 1);
      if (j < 0) return -1;
    } else if (c === '"') {
      const k = doubleEnd(s, j);
      if (k < 0) return -1;
      j = k - 1;
    } else if (c === "`") {
      const k = backquoteEnd(s, j);
      if (k < 0) return -1;
      j = k - 1;
    } else if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** The index after the backquote that closes the one at `i`; -1 for
 * none. */
function backquoteEnd(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === "`") return j + 1;
  }
  return -1;
}

/** The index after the double quote that closes the one at `i`, past its
 * escapes and substitutions; -1 for none. */
function doubleEnd(s: string, i: number): number {
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === '"') return j + 1;
    else if (c === "`" || (c === "$" && (s[j + 1] === "(" ||
      s[j + 1] === "{"))) {
      const k = c === "`" ? backquoteEnd(s, j)
        : closing(s, j, s[j + 1], s[j + 1] === "(" ? ")" : "}");
      if (k < 0) return -1;
      j = k - 1;
    }
  }
  return -1;
}

/** The expansion at `i`, `$(…)`, `${…}` or a backquoted command, as
 * written, and the index after it; null where `i` holds none, -1 for one
 * left open. */
function expansionAt(s: string, i: number): number | null {
  if (s[i] === "`") return backquoteEnd(s, i);
  if (s[i] !== "$") return null;
  if (s[i + 1] === "(") return closing(s, i, "(", ")");
  if (s[i + 1] === "{") return closing(s, i, "{", "}");
  return null;
}

/** The operator token at `i`, a control operator or a redirection with
 * the descriptor before it; null where none starts there, and "fail" for
 * one the tokenizer does not read. */
function operatorAt(s: string, i: number): Op | Redirect | null | "fail" {
  const fd = /^(?:\d+|&)?/.exec(s.slice(i))![0];
  const after = i + fd.length;
  const r = REDIRECTS.find((o) => s.startsWith(o, after));
  if (r !== undefined && (fd !== "&" || r[0] === ">")) {
    if (r === "<<") return "fail";
    if ((r === ">" || r === "<") && s[after + 1] === "(") return "fail";
    const op = fd + r;
    return { kind: "redirect", op, out: r[0] === ">", at: i,
      end: i + op.length };
  }
  if (fd && fd !== "&") return null;
  const o = OPS.find((x) => s.startsWith(x, i));
  return o === undefined ? null
    : { kind: "op", op: o, at: i, end: i + o.length };
}

/** The word that starts at `i`, and the index after it; null for a word
 * left open. */
function wordAt(s: string, i: number): Word | null {
  let value = "";
  let plain = true;
  let j = i;
  while (j < s.length && !BREAKS.has(s[j])) {
    const c = s[j];
    if (c === "\\") {
      if (j + 1 >= s.length) return null;
      if (s[j + 1] !== "\n") value += s[j + 1];
      j += 2;
    } else if (c === "'") {
      const k = s.indexOf("'", j + 1);
      if (k < 0) return null;
      value += s.slice(j + 1, k);
      j = k + 1;
    } else if (c === "$" && s[j + 1] === "'") {
      let k = j + 2;
      while (k < s.length && s[k] !== "'") k += s[k] === "\\" ? 2 : 1;
      if (k >= s.length) return null;
      value += s.slice(j, k + 1);
      plain = false;
      j = k + 1;
    } else if (c === '"') {
      const k = doubleEnd(s, j);
      if (k < 0) return null;
      const inner = s.slice(j + 1, k - 1);
      if (/[$`]/.test(inner)) plain = false;
      value += inner.replace(/\\([$`"\\\n])/g, (_m, e: string) =>
        e === "\n" ? "" : e);
      j = k;
    } else {
      const k = expansionAt(s, j);
      if (k === -1) return null;
      if (k !== null) {
        value += s.slice(j, k);
        plain = false;
        j = k;
      } else {
        if ("$*?[".includes(c)) plain = false;
        value += c;
        j++;
      }
    }
  }
  return { kind: "word", raw: s.slice(i, j), value, plain, at: i, end: j };
}

/** The tokens of `s`, as a shell splits it, comments left out; null where
 * it will not split (see the module's head). */
export function shellWords(s: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "\\" && s[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "#") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    const op = operatorAt(s, i);
    if (op === "fail") return null;
    if (op !== null) {
      out.push(op);
      i = op.end;
      continue;
    }
    const w = wordAt(s, i);
    if (w === null) return null;
    out.push(w);
    i = w.end;
  }
  return out;
}

/** What a background task's command is drawn as: `text`, the command
 * short, and `dirs`, the folders the `cd`s lifted off its head change to,
 * in order, each as written (shortCommand). */
export type ShortCommand = {
  readonly text: string;
  readonly dirs: readonly string[];
};

/** The commands whose stage at the end of a pipeline is plumbing for the
 * output, which the short form leaves out. */
const PLUMBING = new Set(["tail", "head", "grep"]);

/** The operators a lifted `cd` may stand before. */
const AFTER_CD = new Set(["&&", ";", "\n"]);

/** The most characters a path keeps in the short form; a longer one is
 * `…/` and its last component. */
export const BG_PATH_SHORT = 24;

/** `tokens` less their trailing output plumbing: an output redirection
 * and its target, a last pipeline stage of `tail`, `head` or `grep`, and
 * a `;`, `&` or line break at the end, as long as one is left. */
function unplumbed(tokens: readonly Token[]): readonly Token[] {
  let t = tokens;
  for (;;) {
    const n = t.length;
    const last = t[n - 1];
    const prev = t[n - 2];
    if (last?.kind === "op" && [";", "&", "\n"].includes(last.op)) {
      t = t.slice(0, -1);
      continue;
    }
    if (last?.kind === "word" && prev?.kind === "redirect" && prev.out) {
      t = t.slice(0, -2);
      continue;
    }
    const back = [...t].reverse().findIndex((x) => x.kind !== "word");
    const bar = back < 0 ? -1 : n - 1 - back;
    const head = t[bar + 1];
    if (bar > 0 && t[bar].kind === "op" &&
      ["|", "|&"].includes((t[bar] as Op).op) && head?.kind === "word" &&
      PLUMBING.has(head.value)) {
      t = t.slice(0, bar);
      continue;
    }
    return t;
  }
}

/** Path `p` as the short form draws it: under `home` as `~`, and longer
 * than BG_PATH_SHORT, `…/` and its last component; null where it is no
 * path or unchanged. */
function shortPath(p: string, home: string): string | null {
  const m = /^\$(?:HOME|\{HOME\})(?=\/|$)/.exec(p);
  const t = m ? "~" + p.slice(m[0].length)
    : home && (p === home || p.startsWith(home + "/"))
      ? "~" + p.slice(home.length) : p;
  if (!t.startsWith("/") && !t.startsWith("~/")) return t === p ? null : t;
  const segs = t.split("/").filter((x) => x);
  const cut = Array.from(t).length > BG_PATH_SHORT && segs.length > 2
    ? "…/" + segs.at(-1) : t;
  return cut === p ? null : cut;
}

/** Word `w` as the short form draws it: as written, or its path short
 * (shortPath), quoted where it holds a blank. */
function shortWord(w: Word, home: string): string {
  const p = shortPath(w.value, home);
  if (p === null) return w.raw;
  return /\s/.test(p) ? '"' + p + '"' : p;
}

/** `command`, a background task's command on one line (BG_NEWLINE parts
 * its lines), short: every leading `cd <dir> &&`, `cd <dir>;` or `cd
 * <dir>` on a line of its own lifted off, into `dirs`; its trailing output
 * plumbing left out (unplumbed); each path under `home` drawn from `~`,
 * and one longer than BG_PATH_SHORT as `…/` and its last component.  Null
 * where it will not split (shellWords) or nothing is left. */
export function shortCommand(command: string, home: string):
  ShortCommand | null {
  const s = command.split(BG_NEWLINE).join("\n");
  const all = shellWords(s);
  if (all === null) return null;
  let t: readonly Token[] = all;
  const dirs: string[] = [];
  for (;;) {
    const [cd, dir, op] = t;
    if (t.length > 3 && cd.kind === "word" && cd.plain &&
      cd.value === "cd" && dir.kind === "word" && op.kind === "op" &&
      AFTER_CD.has(op.op)) {
      dirs.push(dir.value);
      t = t.slice(3);
    } else break;
  }
  t = unplumbed(t);
  if (!t.length) return null;
  const text = t.map((x, i) => {
    const gap = i > 0 && s.slice(t[i - 1].end, x.at).length ? " " : "";
    if (x.kind === "op" && x.op === "\n") return BG_NEWLINE;
    return gap + (x.kind === "word" ? shortWord(x, home) : x.op);
  }).join("").trim();
  return text ? { text, dirs } : null;
}

/** The folder chip of a task whose command changes to `dirs` in turn
 * (shortCommand), started by a thread working in `cwd`: the last component
 * of where they lead, `home` read for `~` and `$HOME`; "" where they lead
 * back to `cwd`, or where it or any of them is not known (an expansion
 * left in it, `cd -`, no `cwd`). */
export function folderChip(dirs: readonly string[], cwd: string,
  home: string): string {
  if (!dirs.length || !cwd) return "";
  let d = joined(cwd, ".");
  const from = d;
  for (const w of dirs) {
    if (!home && /^~(?=\/|$)|\$\{?HOME/.test(w)) return "";
    const e = expanded(w, home);
    if (e === null || e === "-") return "";
    d = joined(d, e);
  }
  return d === from ? "" : d.split("/").filter((x) => x).at(-1) ?? "/";
}

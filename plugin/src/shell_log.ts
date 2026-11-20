// The log band of a background shell: which file holds its log, and its
// last lines as the band draws them.  Pure: the band's hook does the
// reading (register.tsx).

import { BG_NEWLINE } from "./claude_records.ts";

/** The rows the prompt takes in fullscreen, its borders included, which
 * the log band leaves it of the bottom slot's half. */
export const PROMPT_ROWS = 3;

/** The most bytes of a log's tail the band reads. */
export const LOG_TAIL_BYTES = 64 * 1024;

/** The columns between tab stops. */
const TAB = 8;

/** A word of a command, bare or quoted, as the redirect and `cd` patterns
 * take it: group 1 double-quoted, 2 single-quoted, 3 bare. */
const WORD = String.raw`(?:"([^"]+)"|'([^']+)'|([^\s;&|<>()"']+))`;

/** A redirect of stdout: `>`, `>>`, `1>`, `1>>`, `&>` or `&>>`, not one
 * of another stream (`2>`), a duplication (`>&2`, `2>&1`), a process
 * substitution (`>(`) or an arrow (`->`, `=>`), and the word after it. */
const STDOUT_REDIRECT = new RegExp(
  String.raw`(?<![0-9>&<=\-])(?:&>>?|1?>>?)(?![>&|(])[ \t]*` + WORD, "g");

/** A `cd` at the start of the command or after `;`, `&`, `|` or `(`, and
 * its word. */
const CD = new RegExp(String.raw`(?:^|[;&|(])\s*cd[ \t]+` + WORD, "g");

/** The word a WORD match holds. */
const wordOf = (m: RegExpMatchArray): string => m[1] ?? m[2] ?? m[3] ?? "";

/** `path` with `.`, `..` and repeated slashes resolved, absolute. */
function normal(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

/** `path` resolved against folder `dir`: itself where absolute. */
export function joined(dir: string, path: string): string {
  return normal(path.startsWith("/") ? path : dir + "/" + path);
}

/** Word `w` with a leading `~` and `$HOME` or `${HOME}` as `home`; null
 * where any other expansion is left, or the word was cut (`…`). */
function expanded(w: string, home: string): string | null {
  const e = w.replace(/^~(?=\/|$)/, home)
    .replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, home);
  return /[$`*?…]/.test(e) ? null : e;
}

/** The file the last stdout redirect of `command` writes to, resolved
 * against the folder the command stands in by then: `cwd`, moved by each
 * `cd` before the redirect; `home` for `~` and `$HOME`.  Lines kept on
 * one line (BG_NEWLINE) part commands as `;` does.  `/dev/null`, and a
 * target with an expansion left in it, count as no redirect; null for
 * none. */
export function redirectOf(command: string, cwd: string, home: string):
  string | null {
  const cmd = command.split(BG_NEWLINE).join(" ; ");
  const targets = [...cmd.matchAll(STDOUT_REDIRECT)].flatMap((m) => {
    const t = expanded(wordOf(m), home);
    return t === null || t === "/dev/null" ? [] : [{ at: m.index ?? 0, t }];
  });
  const last = targets.at(-1);
  if (last === undefined) return null;
  const dir = [...cmd.matchAll(CD)]
    .filter((m) => (m.index ?? 0) < last.at)
    .reduce((d, m) => {
      const to = expanded(wordOf(m), home);
      return to === null || to === "-" ? d : joined(d, to);
    }, cwd);
  return joined(dir, last.t);
}

/** Line `l` as a row can draw it: what follows its last carriage return,
 * as a terminal would leave it; its escape sequences gone; its tabs as
 * spaces to the next TAB stop; any other control character gone. */
export function drawable(l: string): string {
  const bare = l
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/\r+$/, "");
  const shown = bare.slice(bare.lastIndexOf("\r") + 1);
  let out = "";
  let col = 0;
  for (const c of shown) {
    if (c === "\t") {
      const pad = TAB - col % TAB;
      out += " ".repeat(pad);
      col += pad;
    } else if (!/[\x00-\x1f\x7f-\x9f]/.test(c)) {
      out += c;
      col += 1;
    }
  }
  return out;
}

/** The last `n` lines of `text`, a log's tail, each drawable: its first
 * line left out where the read started inside the file (`cut`), as it may
 * be a line's end alone, and the empty line after a closing line break
 * too. */
export function tailLines(text: string, cut: boolean, n: number): string[] {
  const lines = text.split("\n");
  const whole = cut ? lines.slice(1) : lines;
  const done = whole.at(-1) === "" ? whole.slice(0, -1) : whole;
  return n > 0 ? done.slice(-n).map(drawable) : [];
}

/** How many of a log's lines the band draws, its title row aside, in a
 * terminal `rows` high: half of them, and in fullscreen, where the bottom
 * slot holds at most that half, the prompt and the tree's `treeRows`
 * left out of it; at least one. */
export function logRows(rows: number, fullscreen: boolean,
  treeRows: number): number {
  const half = Math.floor(rows / 2);
  return Math.max(1,
    (fullscreen ? half - PROMPT_ROWS - treeRows : half) - 1);
}

/** Which file the band shows a shell's log from: its output file
 * `output`, where it holds anything (`outputSize` bytes); else the file
 * its command's last stdout redirect writes to (redirectOf); else none,
 * with why. */
export function logFile(output: string, outputSize: number,
  command: string, cwd: string, home: string):
  { readonly path: string } | { readonly path: null; readonly why: string } {
  if (output && outputSize > 0) return { path: output };
  const r = redirectOf(command, cwd, home);
  if (r !== null) return { path: r };
  return { path: null, why: output
    ? "no log: its output file is empty and its command names no file " +
      "it writes to"
    : "no log: no output file is known and its command names no file " +
      "it writes to" };
}

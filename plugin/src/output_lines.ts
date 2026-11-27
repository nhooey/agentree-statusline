// A program's output as a row draws it: one line as a terminal would leave
// it, and the last line with text, which the band's tree draws after a
// background shell's or Monitor's name (band_tree.ts).  Pure.

/** The columns between tab stops. */
const TAB = 8;

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

/** The last line of `text` with anything drawn on it, drawable and its
 * blanks trimmed: a progress line rewritten with carriage returns as it
 * was left, trailing blank lines passed over.  Its first line is left out
 * where the read started inside the file (`cut`), as it may be a line's
 * end alone.  "" for none. */
export function lastLine(text: string, cut = false): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= (cut ? 1 : 0); i--) {
    const l = drawable(lines[i]).trim();
    if (l) return l;
  }
  return "";
}

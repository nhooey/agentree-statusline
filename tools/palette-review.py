#!/usr/bin/env python3
"""Draw mod/src/spec.ts's two colour sets side by side, to review them by
eye in a true-colour terminal.

    python3 tools/palette-review.py > review.ansi       # this tree's sets
    python3 tools/palette-review.py --old origin/master  # beside a revision's
    python3 tools/palette-review.py --nearest 4

One row a colour: its name, its true value, its 256 value with its palette
index, what Claude Code would draw the true value as at 256 colours if it
were handed that and left to round it (chalk's rgbToAnsi256 on the xterm
palette), and the role its comment gives.  Each cell is a block, the text
"841k" and the text "98٪" faint, as a dimmed figure is
drawn, with the faint text's contrast on black; a colour a dim figure takes
is marked * and must clear the floor in mod/test/spec.test.ts.  --nearest adds
that many palette entries closest to each true value.  --old adds a column
for a revision's 256 value.  Then the pairs whose roles must stay apart,
how far apart they are in each set, any two names that share one 256
entry, and real rows drawn at each level: the band and the receipt, true
colour then 256.  The palette, DIMMED and the floor are
mod/test/spec.test.ts's, written again here.
"""
import argparse
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYOUT = "mod/src/spec.ts"
RESET = "\x1b[0m"
# Claude Code's default dark theme's user-message background, which B_MSG
# sits against in the transcript.
PROMPT_BG = ("prompt background", (0, 0, 95), (0, 0, 95))
# Roles a reader compares, so their colours must stay apart.
PAIRS = [("F_LIM_SESS", "F_LIM_WEEK"), ("F_CHAT_U", "F_CHAT_B"),
         ("F_CHAT_U", "F_CRM"), ("F_CHAT_B", "F_SUM"), ("B_DRK", "B_MSG"),
         ("B_MSG", PROMPT_BG), ("F_PRW", "F_ETA"), ("F_PRW", "F_BLU"),
         ("F_BLU", "F_BLU2"), ("F_BLU", "F_PROJ"), ("F_RED", "F_OVER"),
         ("F_AMB", "F_YEL"), ("F_PNK", "F_PNK2"), ("F_PNK", "F_TDN"),
         ("F_TUP", "F_CYN"), ("F_TUP", "F_RATE"), ("F_GRN", "F_RATE"),
         ("F_PUR", "F_ETA"), ("F_PUR", "F_PRW"), ("F_PNK", "F_ETA"),
         ("F_BLU2", "F_CYN"), ("F_PROJ", "F_TDN"), ("F_CRM", "F_TUP"),
         ("F_GRN", "F_AMB"), ("F_RED", "F_PROJ")]
# The environments the rows are drawn under: Claude Code at true colour,
# then at 256 colours.
LEVELS = [("true colour", {"TERM": "xterm-256color", "COLORTERM": "truecolor"}),
          ("256 colours", {"TERM": "xterm-256color"})]
# Real rows: (label, command run from the tree's root).
DRAWINGS = [
    ("the band, 01-baseline at 196",
     ["node", "mod/tools/draw-figures.ts",
      "tests/fixtures/figures/status/01-baseline.json", "--cols", "196"]),
    ("the receipt, 01-plain at 150",
     ["node", "mod/tools/draw-figures.ts",
      "tests/fixtures/figures/cost/01-plain.json", "--cols", "150"]),
]
GOLDENS = [("true colour", "status/true-colour-01@196.txt"),
           ("256 colours", "status/01-baseline@196.txt")]


# The 256-colour palette as Claude Code's renderer rounds to it.
CUBE = (0, 95, 135, 175, 215, 255)


def ansi256(rgb):
    """The index Claude Code's renderer gives rgb under 256 colours."""
    r, g, b = rgb
    if r == g == b:
        if r < 8:
            return 16
        if r > 248:
            return 231
        return round((r - 8) / 247 * 24) + 232
    return 16 + 36 * round(r / 255 * 5) + 6 * round(g / 255 * 5) \
        + round(b / 255 * 5)


def xterm(index):
    """The colour the terminal draws for a 256-colour index from 16 up."""
    if index >= 232:
        return (8 + 10 * (index - 232),) * 3
    i = index - 16
    return CUBE[i // 36], CUBE[i // 6 % 6], CUBE[i % 6]


# The entries that come back as themselves, by index.
PALETTE = [i for i in range(16, 256) if ansi256(xterm(i)) == i]


def linear(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def lab(rgb):
    """CIE L*a*b* (D65) of an sRGB colour."""
    r, g, b = map(linear, rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def delta_e(a, b):
    """CIE76 distance between two sRGB colours."""
    return sum((p - q) ** 2 for p, q in zip(lab(a), lab(b))) ** 0.5


def nearest(rgb, n=1):
    """The n palette indices closest to rgb, nearest first."""
    return sorted(PALETTE, key=lambda i: delta_e(rgb, xterm(i)))[:n]


def contrast(a, b):
    """WCAG contrast ratio of two sRGB colours."""
    def luminance(rgb):
        r, g, b = map(linear, rgb)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def faint(rgb):
    """rgb as a terminal draws it faint on black."""
    return tuple(v // 2 for v in rgb)


DIMMED = {"F_GRN", "F_AMB", "F_RED", "F_TUP", "F_RATE", "F_TDN", "F_YEL",
          "F_PNK", "F_CRM", "F_PRW", "F_ETA", "F_LIM_SESS", "F_LIM_WEEK",
          "F_SHARE"}
FAINT_FLOOR = 2.3

# A colour's line in spec.ts: its hex 256 value or the name it is the same
# as, then its role in the comment; and TRUE_COLOURS' lines.
COLOUR = re.compile(r'^export const ([FB]_\w+) = (?:"#([0-9a-f]{6})"|([FB]_\w+));'
                    r'\s*(?://\s*(.*))?$')
TRUE = re.compile(r'^  "([FB]_\w+)": "#([0-9a-f]{6})",$')


def rgb_of(hex6):
    return tuple(int(hex6[i:i + 2], 16) for i in (0, 2, 4))


def colours(text):
    """{name: (rgb 256, rgb true, alias or None, role)} for every F_ and
    B_ name."""
    lines = text.splitlines()
    trues = {m.group(1): rgb_of(m.group(2))
             for m in map(TRUE.match, lines) if m}
    out = {}
    for line in lines:
        m = COLOUR.match(line)
        if not m:
            continue
        name, hex6, alias, role = m.groups()
        c256 = out[alias][0] if alias else rgb_of(hex6)
        out[name] = (c256, trues.get(name, c256), alias, (role or "").strip())
    return out


def faint_ratio(rgb):
    return contrast(faint(rgb), (0, 0, 0))


def swatch(rgb, name):
    fg = "38;2;%d;%d;%d" % rgb
    if name.startswith("B_"):
        return "\x1b[48;2;%d;%d;%dm\x1b[38;2;255;255;255m 841k 98٪ %s" % (
            *rgb, RESET)
    return "\x1b[%sm██ 841k\x1b[0m \x1b[2;%sm98٪%s" % (fg, fg, RESET)


def cell(rgb, name, index=None):
    tag = "%3d,%3d,%3d" % rgb
    if index is not None:
        tag += " %3d" % index
    if name.startswith("F_"):
        tag += " %4.2f" % faint_ratio(rgb)
    return "%s %s" % (swatch(rgb, name), tag)


def name_of(item):
    return item if isinstance(item, str) else item[0]


def run(argv, env):
    full = {k: v for k, v in os.environ.items()
            if k not in ("TMUX", "TERM_PROGRAM",
                         "FORCE_COLOR", "NO_COLOR", "COLORTERM",
                         "TERM_PROGRAM_VERSION",
                         "CLAUDE_CODE_TMUX_TRUECOLOR")}
    full.update(env)
    p = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                       env=full)
    return p.stdout if p.returncode == 0 else p.stdout + p.stderr


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--old", metavar="REV",
                    help="also show a revision's 256 value")
    ap.add_argument("--nearest", type=int, default=0, metavar="N",
                    help="list the N palette entries nearest each true value")
    ap.add_argument("--no-drawings", action="store_true",
                    help="leave out the real rows")
    args = ap.parse_args()

    with open(os.path.join(REPO, LAYOUT), encoding="utf-8") as fh:
        new = colours(fh.read())
    old = None
    if args.old:
        old = colours(subprocess.run(
            ["git", "show", "%s:%s" % (args.old, LAYOUT)], cwd=REPO,
            check=True, capture_output=True, text=True).stdout)

    out = ["\x1b[1mThe two colour sets\x1b[0m   (true | 256 + index | the "
           "true value as chalk rounds it at 256%s; each: block, text, faint "
           "text, faint contrast on black; * a dim figure takes it, floor "
           "%.1f)" % (" | " + args.old + "'s 256" if old else "",
                      FAINT_FLOOR), ""]
    for name, (c256, ctrue, alias, role) in new.items():
        idx = ansi256(c256)
        rounded = xterm(ansi256(ctrue))
        mark = "*" if name in DIMMED else " "
        line = "%-10s%s %s | %s | %s" % (
            name, mark, cell(ctrue, name), cell(c256, name, idx),
            cell(rounded, name))
        if old:
            line += " | " + cell(old.get(name, new[name])[0], name)
        out.append(line + "  " + (("= " + alias) if alias else role))
        if args.nearest:
            out.append("%-11s nearest: %s" % ("", "  ".join(
                "%3d %s ΔE %.1f" % (i, cell(xterm(i), name),
                                     delta_e(ctrue, xterm(i)))
                for i in nearest(ctrue, args.nearest))))

    out += ["", "\x1b[1mPairs that must stay apart\x1b[0m   (ΔE true, 256)",
            ""]
    for a, b in PAIRS:
        pa = new[a] if isinstance(a, str) else (a[1], a[2])
        pb = new[b] if isinstance(b, str) else (b[1], b[2])
        out.append("%-10s %-17s %5.1f %5.1f  %s  %s  |  %s  %s" % (
            name_of(a), name_of(b), delta_e(pa[1], pb[1]),
            delta_e(pa[0], pb[0]),
            cell(pa[1], name_of(a)), cell(pb[1], name_of(b)),
            cell(pa[0], name_of(a)), cell(pb[0], name_of(b))))

    shared = {}
    for name, (c256, _, alias, _) in new.items():
        if alias is None:
            shared.setdefault(c256, []).append(name)
    out += ["", "\x1b[1mNames sharing one 256 entry\x1b[0m (same_as aside): "
            + ("; ".join(" ".join(v) for v in shared.values() if len(v) > 1)
               or "none")]

    if not args.no_drawings:
        for label, argv in DRAWINGS:
            for level, env in LEVELS:
                out += ["", "\x1b[1m%s, at %s\x1b[0m" % (label, level), ""]
                out.append(run(argv, env).rstrip("\n"))
        for level, golden in GOLDENS:
            out += ["", "\x1b[1mthe status line golden %s, at %s\x1b[0m" % (
                golden, level), ""]
            with open(os.path.join(REPO, "tests", "golden", golden),
                      encoding="utf-8") as fh:
                out.append(fh.read().rstrip("\n"))
    sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

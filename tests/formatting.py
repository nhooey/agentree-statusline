#!/usr/bin/env python3
"""Shared terminal-formatting ownership contract, independent of either agent."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _checks import check, holds, tally  # noqa: E402
from coding_agent_usage_line import formatting as f

check('f.vis_width("🎯") == 2', f.vis_width("🎯"), 2)
check('f.pad_val(4, "🎯") == "  🎯"', f.pad_val(4, "🎯"), "  🎯")
check('f.humanize(1234) == "1.2k"', f.humanize(1234), "1.2k")
check('f.humanize(632) == "632 "', f.humanize(632), "632 ")
# Rounding must roll into the next unit, never print "60m" or "24h".
check('f.dur_fmt(3569) == "59m"', f.dur_fmt(3569), "59m")
check('f.dur_fmt(3570) == "1h"', f.dur_fmt(3570), "1h")
check('f.dur_fmt(3599, 2) == "1h"', f.dur_fmt(3599, 2), "1h")
check('f.dur_fmt(84599) == "23h"', f.dur_fmt(84599), "23h")
check('f.dur_fmt(86399) == "1d"', f.dur_fmt(86399), "1d")
f.set_mark_spacing(False)
check('f.MARK_SP == ""', f.MARK_SP, "")
check('f.C_TOK == f.C_TOK_TIGHT', f.C_TOK, f.C_TOK_TIGHT)
f.set_mark_spacing(True)
check('f.MARK_SP == " "', f.MARK_SP, " ")
check('f.C_TOK == f.C_TOK_TIGHT + 1', f.C_TOK, f.C_TOK_TIGHT + 1)
f.set_subscript_decimals(True)
check('f.sub_dec("1.2") == "1₂"', f.sub_dec("1.2"), "1₂")
f.set_subscript_decimals(False)
# The profile rules, first match wins, read as data since 2026-10-19.
check('f.term_profile({"TMUX": "/tmp/s", "TERM_PROGRAM": "iTerm.app"}) == ...', f.term_profile({"TMUX": "/tmp/s", "TERM_PROGRAM": "iTerm.app"}), "tmux")
check('f.term_profile({"TMUX": ""}) == "unknown"', f.term_profile({"TMUX": ""}), "unknown")
check('f.term_profile({"TERM_PROGRAM": "iTerm.app"}) == "iterm"', f.term_profile({"TERM_PROGRAM": "iTerm.app"}), "iterm")
check('f.term_profile({"TERM_PROGRAM": "ghostty"}) == "unknown"', f.term_profile({"TERM_PROGRAM": "ghostty"}), "unknown")
# The colour level, as Claude Code 2.1.304 decides it: true colour lowered
# to 256 under tmux unless CLAUDE_CODE_TMUX_TRUECOLOR, and lifted on the
# terminals it names.
from coding_agent_usage_line.spans import colour_level  # noqa: E402
check('colour_level({"TERM": "xterm-256color"}) == 2', colour_level({"TERM": "xterm-256color"}), 2)
check('colour_level({"TERM": "xterm-256color", "COLORTERM": "truecolor"}) ...', colour_level({"TERM": "xterm-256color", "COLORTERM": "truecolor"}), 3)
check('colour_level({"TMUX": "/tmp/t,1,0", "COLORTERM": "truecolor"}) == 2', colour_level({"TMUX": "/tmp/t,1,0", "COLORTERM": "truecolor"}), 2)
check('colour_level({"TMUX": "/tmp/t,1,0", "COLORTERM": "truecolor", "CLAU...', colour_level({"TMUX": "/tmp/t,1,0", "COLORTERM": "truecolor",
                     "CLAUDE_CODE_TMUX_TRUECOLOR": "1"}), 3)
check('colour_level({"TERM": "foot"}) == 3', colour_level({"TERM": "foot"}), 3)
check('colour_level({"TERM": "foot", "FORCE_COLOR": "2"}) == 2', colour_level({"TERM": "foot", "FORCE_COLOR": "2"}), 2)
check('colour_level({"TERM_PROGRAM": "vscode", "TERM": "xterm-256color"}) ...', colour_level({"TERM_PROGRAM": "vscode", "TERM": "xterm-256color"}), 3)
check('colour_level({"COLORTERM": "truecolor", "NO_COLOR": "1"}) == 0', colour_level({"COLORTERM": "truecolor", "NO_COLOR": "1"}), 0)
check('colour_level({"TERM_PROGRAM": "iTerm.app"}) == 2', colour_level({"TERM_PROGRAM": "iTerm.app"}), 2)
check('colour_level({"TERM_PROGRAM": "iTerm.app", "TERM_PROGRAM_VERSION": ...', colour_level({"TERM_PROGRAM": "iTerm.app",
                     "TERM_PROGRAM_VERSION": "3.5.10"}), 3)
# Under tmux's limited mode, and wherever the level is in doubt, every colour
# drawn is the 256 set's, one of the palette entries that come back from
# tmux's 256-colour rounding as they went in: never a true value.
import importlib.util  # noqa: E402
import re  # noqa: E402
from coding_agent_usage_line import spans as sp, spec as spec_py  # noqa: E402
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_g = importlib.util.spec_from_file_location(
    "gen_spec", os.path.join(REPO, "tools", "gen-spec.py"))
G = importlib.util.module_from_spec(_g)
_g.loader.exec_module(G)
ROUND_TRIP = {G.xterm(i) for i in G.PALETTE}
NAMES = sorted(spec_py.TRUE_COLOURS)
ALL = [sp.Span(n, colour=n) for n in NAMES if n.startswith("F_")] + [
    sp.Span(n, bg=n) for n in NAMES if n.startswith("B_")]
CODE = re.compile(r"\x1b\[(?:[0-9;]*;)?([34]8);2;(\d+);(\d+);(\d+)m")
LIMITED = [
    {"TMUX": "/tmp/tmux-501/default,1,0", "TERM": "screen-256color"},
    {"TMUX": "/tmp/tmux-501/default,1,0", "TERM": "tmux-256color",
     "COLORTERM": "truecolor"},
    {"TMUX": "/tmp/tmux-501/default,1,0", "TERM": "xterm-kitty"},
    # Doubt: nothing known, an unknown terminal, a FORCE_COLOR not a level.
    {}, {"TERM": "weird"}, {"TERM": "xterm-256color", "FORCE_COLOR": "x"},
]
saved = dict(os.environ)
try:
    for env in LIMITED:
        for k in sp.COLOUR_VARS:
            os.environ.pop(k, None)
        os.environ.update(env)
        holds('sp.colour_level() < 3', sp.colour_level() < 3, env)
        drawn = sp.join(ALL)
        codes = CODE.findall(drawn)
        check('len(codes) == len(ALL)', len(codes), len(ALL), (env, len(codes)))
        for s, (_, r, g, b) in zip(ALL, codes):
            rgb = (int(r), int(g), int(b))
            holds('rgb in ROUND_TRIP', rgb in ROUND_TRIP, (env, s.text, rgb))
        holds('drawn == sp.join(ALL) and all( getattr(spec_py, n) in drawn for n i...', drawn == sp.join(ALL) and all(
            getattr(spec_py, n) in drawn for n in NAMES), env)
    # And lifted, the true set: the test above can tell them apart.
    for k in sp.COLOUR_VARS:
        os.environ.pop(k, None)
    os.environ.update({"TMUX": "/tmp/t,1,0", "COLORTERM": "truecolor",
                       "CLAUDE_CODE_TMUX_TRUECOLOR": "1"})
    holds('spec_py.TRUE_COLOURS["F_RED"] in sp.join(ALL)', spec_py.TRUE_COLOURS["F_RED"] in sp.join(ALL))
finally:
    os.environ.clear()
    os.environ.update(saved)
# spec.py, state_spec.py, options_spec.py, their .ts and the option tables
# of docs/options.md are generated from spec/*.jsonc.
import subprocess
spec = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "tools", "gen-spec.py")
check('subprocess.run([sys.executable, spec, "--check"]).returncode == 0', subprocess.run([sys.executable, spec, "--check"]).returncode, 0)
line, status = tally()
print(line)
sys.exit(status)

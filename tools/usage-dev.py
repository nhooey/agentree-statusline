#!/usr/bin/env python3
"""usage-dev: the commands this repository is built, tested and changed with.

    usage-dev test                      # every suite (tests/all.sh)
    usage-dev test status node          # the suites named
    usage-dev spec --check              # spec/*.jsonc outputs up to date?
    usage-dev figures FILE --cols 160   # draw a figures document
    usage-dev --list                    # every command, one line each

Each command runs one or more scripts under tests/, tools/ or mod/tools/
from the repository root (or mod/), handing the words after the command to
them unchanged, so a script's own options work here as they do there:
`usage-dev figures -- --help` prints draw-figures.ts's help.  A command of
several steps stops at the first that fails.

Exit status: the failing step's own status (tests/all.sh's is the number of
suites that failed), 0 when every step passed, 2 for a usage error, and 127
when a step's program is not on PATH.

Standard-library Python only, so it runs on the 3.9 floor and off the dev
shell: `python3 tools/usage-dev.py ...`.
"""
import argparse
import os
import subprocess
import sys
from collections import namedtuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# One step: a directory under ROOT and the argv to run in it.  The words
# the user gave after the command are appended to each step marked `rest`.
Step = namedtuple("Step", "cwd argv rest")


def step(argv, cwd=".", rest=True):
    return Step(cwd, tuple(argv), rest)


# name -> (category, one-line help, steps).  The order is the --list order,
# grouped by category as the dev shell's menu is.
COMMANDS = {
    # test
    "test": ("test", "run every suite, or those named; --repeat N, --skip A,B",
             [step(["bash", "tests/all.sh"])]),
    "stress": ("test", "rerun suites under CPU load and count failures; "
               "[--runs N] [--jobs J] [--burn B] [SUITE...]",
               [step(["bash", "tools/stress-suites.sh"])]),
    "typecheck": ("test", "type-check the TypeScript port and the mod",
                  [step(["npm", "run", "-s", "typecheck"], cwd="mod",
                        rest=False)]),
    "mod-test": ("test", "run the mod's node --test suites (test/*.test.ts)",
                 [step(["node", "--test", "test/*.test.ts"], cwd="mod",
                       rest=False)]),
    "plugin-test": ("test", "validate the mod and run its harness tests; "
                    "needs the claude CLI",
                    [step(["npm", "run", "-s", "test:plugin"], cwd="mod",
                          rest=False)]),
    # manual: what CI cannot run
    "folds": ("manual", "break the transcript folds over ~/.claude/projects "
              "in both ports; [--largest N] [--seed S] [FILE...]",
              [step(["python3", "tests/fold_real.py"]),
               step(["node", "mod/tools/check-fold.ts"])]),
    "window-costs": ("manual", "time the window-cost scan over "
                     "~/.claude/projects, cold and cached, in both ports; "
                     "[--runs N]",
                     [step(["python3", "tools/time-window-costs.py"]),
                      step(["node", "mod/tools/time-window-costs.ts"])]),
    "compaction-once": ("manual", "replay real sessions: each compaction "
                        "reported once; [TRANSCRIPT...]",
                        [step(["python3", "tests/compaction-once.py"])]),
    "agents-once": ("manual", "replay real sessions: agent spend reported "
                    "late, once; [TRANSCRIPT...]",
                    [step(["python3", "tests/agents-once.py"])]),
    "selftest": ("manual", "measure the layout in this terminal; needs a "
                 "real tty",
                 [step(["python3", "coding-agent-usage-line.py",
                        "--selftest"])]),
    "probe-advance": ("manual", "measure each glyph's cursor advance in "
                      "this terminal; needs a real tty",
                      [step(["bash", "tests/probe-advance.sh"])]),
    # generate
    "spec": ("generate", "regenerate spec.py and spec.ts from "
             "spec/layout.jsonc; --check to compare only",
             [step(["python3", "tools/gen-spec.py"])]),
    "fixtures": ("generate", "rerun the fixture generators of "
                 "tests/fixtures/gen/",
                 [step(["python3", "tests/fixtures/gen/all.py"])]),
    "goldens": ("generate", "re-record the goldens and figures "
                "(run-cases.py --regen); [--suite S]",
                [step(["python3", "tests/run-cases.py", "--regen"])]),
    "grid-cases": ("generate", "regenerate tests/fixtures/grid from the "
                   "TypeScript grid",
                   [step(["node", "mod/tools/gen-grid-cases.ts"])]),
    "row-cases": ("generate", "regenerate the mod's row cases",
                  [step(["node", "mod/tools/gen-row-cases.ts"])]),
    "mod-fixtures": ("generate", "regenerate mod-tests/fixtures.gen.ts for "
                     "the harness tests",
                     [step(["node", "tools/gen-mod-fixtures.ts"],
                           cwd="mod")]),
    # look
    "diff-grid": ("look", "say how tests/fixtures/grid changed since a "
                  "commit; [BASE] [FILE...] [--show N]",
                  [step(["python3", "tools/diff-grid-fixtures.py"])]),
    "figures": ("look", "draw a figures document as the mod's rows; "
                "FILE [--cols N]",
                [step(["node", "mod/tools/draw-figures.ts"])]),
    "mockup": ("look", "draw the layout inside a mocked Claude Code "
               "screen; [--cols N] ...",
               [step(["node", "mod/tools/layout-mockup.ts"])]),
    "palette": ("look", "draw the two colour sets side by side; "
                "[--old REV] [--nearest N]",
                [step(["python3", "tools/palette-review.py"])]),
    "module-reach": ("look", "which entry points reach each Python module; "
                     "[--json]",
                     [step(["python3", "tools/python-module-reach.py"])]),
    # update
    "npm-lock": ("update", "re-resolve mod/package-lock.json from "
                 "mod/package.json",
                 [step(["npm", "install", "--package-lock-only",
                        "--ignore-scripts"], cwd="mod")]),
}


def parser():
    p = argparse.ArgumentParser(
        prog="usage-dev",
        description="The commands this repository is built, tested and "
        "changed with.  The words after a command go to the script it "
        "runs; `usage-dev COMMAND --help` describes the command, and "
        "`usage-dev COMMAND -- --help` asks its script.",
    )
    p.add_argument("--list", action="store_true",
                   help="print every command and its help, one a line")
    p.add_argument("-n", "--dry-run", action="store_true",
                   help="print the steps instead of running them")
    sub = p.add_subparsers(dest="command", metavar="COMMAND")
    for name, (_, text, steps) in COMMANDS.items():
        rest = any(s.rest for s in steps)
        sub.add_parser(name, help=text, description=text,
                       usage="usage-dev %s%s" % (
                           name, " [ARGS...]" if rest else ""))
    return p


def split(argv):
    """(usage-dev's own options, the command or None, the words after it).

    The words after the command are the script's, options and all, so they
    never reach argparse, which would take `--check` for one of its own."""
    for i, word in enumerate(argv):
        if not word.startswith("-"):
            return argv[:i], word, argv[i + 1:]
    return argv, None, []


def listing():
    lines, last = [], None
    for name, (category, text, _) in COMMANDS.items():
        if category != last:
            if last is not None:
                lines.append("")
            lines.append("[%s]" % category)
            last = category
        lines.append("  %-16s %s" % (name, text))
    return "\n".join(lines)


def plan(command, args):
    """The steps `usage-dev COMMAND ARGS...` runs, as (cwd, argv) pairs."""
    if command not in COMMANDS:
        raise KeyError(command)
    if args and args[0] == "--":
        args = args[1:]
    steps = COMMANDS[command][2]
    if args and not any(s.rest for s in steps):
        raise ValueError("%s takes no arguments" % command)
    return [(s.cwd, list(s.argv) + (list(args) if s.rest else []))
            for s in steps]


def run(steps, root=ROOT):
    for cwd, argv in steps:
        try:
            rc = subprocess.call(argv, cwd=os.path.join(root, cwd))
        except FileNotFoundError:
            print("usage-dev: %s: not on PATH" % argv[0], file=sys.stderr)
            return 127
        if rc != 0:
            return rc
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)
    own, command, rest = split(argv)
    p = parser()
    asks_help = rest in (["-h"], ["--help"])
    ns = p.parse_args(own + ([command] if command else [])
                      + (rest if asks_help else []))
    if ns.list:
        print(listing())
        return 0
    if command is None:
        p.print_help(sys.stderr)
        return 2
    try:
        steps = plan(command, rest)
    except ValueError as e:
        p.error(str(e))
    if ns.dry_run:
        for cwd, args in steps:
            print("(cd %s && %s)" % (cwd, " ".join(args)))
        return 0
    return run(steps)


if __name__ == "__main__":
    sys.exit(main())

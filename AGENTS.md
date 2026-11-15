# coding-agent-usage-line

Three readouts for Claude Code that show a session's cost, its plan usage,
where the time went and what each subagent is doing, all on one grid. The
renderer is the Python package in `coding_agent_usage_line/`, run through
`coding-agent-usage-line.py`; the `usage-band` mod in `mod/` (TypeScript)
draws the rows above the prompt and under the footer line. See `README.md`.

## Build and test

Enter the dev shell with `nix develop` (or direnv); it installs the
project's skills into `.agents/skills/`. Then:

- `tests`: every suite, or the ones named (`tests/all.sh`).
- `typecheck`: type-check the mod's TypeScript.
- `check`: `nix flake check`, which checks formatting only (treefmt);
  it doesn't run the tests.

`menu` lists the dev shell's other commands.

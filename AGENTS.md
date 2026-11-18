# agentree-statusline

Three readouts for Claude Code that show a session's cost, its plan usage,
where the time went and what each subagent is doing, all on one grid. They
are the `agentree-statusline` mod in `mod/` (TypeScript), which draws the
rows above the prompt and under the footer line. The Python under `tools/`
is development tooling only. See `README.md`.

## Build and test

Enter the dev shell with `nix develop` (or direnv); it installs the
project's skills into `.agents/skills/`. Then:

- `tests`: every suite, or the ones named (`usage-dev test`).
- `typecheck`: type-check the mod's TypeScript (`usage-dev typecheck`).
- `usage-dev`: every other command: regenerating the spec, fixtures,
  goldens and cases, drawing figures, the manual checks; `usage-dev
  --list` names them.
- `check`: `nix flake check`: formatting (treefmt) and the suites a
  build can run (`nix/check-tests.sh`).

`menu` lists the dev shell's other commands.

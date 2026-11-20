# agentree-statusline

Three readouts for Claude Code that show a session's cost, its plan usage, where the time went and what each subagent is doing, all on one grid.
They are the `agentree-statusline` plugin in `plugin/` (TypeScript), which draws the rows above the prompt and under the footer line.
The Python under `tools/` is development tooling only.
See `README.md`.

## Build and test

Enter the dev shell with `nix develop` (or direnv); it installs the project's skills into `.agents/skills/`.
Then:

- `tests`: every suite, or the ones named (`usage-dev test`).
- `typecheck`: type-check the plugin's TypeScript (`usage-dev typecheck`).
- `usage-dev`: every other command: regenerating the option docs, fixtures, goldens and cases, drawing figures, the manual checks; `usage-dev --list` names them.
- `check`: `nix flake check`: formatting (treefmt) and the suites a build can run (`nix/check-tests.sh`).
- `plugin-build`: build the plugin's runtime files into `result-plugin`, a link into the Nix store. A session started with `claude --plugin-dir result-plugin` runs that build, so edits under `plugin/` reach it only after `plugin-build` and `/reload-plugins` there. A new file needs `git add` before it is built.

`menu` lists the dev shell's other commands.

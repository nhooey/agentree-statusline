# Tests

The suites are the plugin's, run by Node's own test runner and by the engine,
and usage-dev's own. Run the whole deterministic set with `tests` in the dev
shell (`usage-dev test`, or `bash tests/all.sh` outside it), side by side,
with one line per suite on how it went:

```sh
tests                    # every suite, then generated
tests node typecheck     # the ones named
tests --repeat 20 node   # again, until a round fails
tests --skip generated   # all but those named
```

Last comes `generated`: it reruns every generator of committed files,
the plugin's under `plugin/tools/`, and fails if
`git status` then shows any changed or untracked file, so a generator's
output left uncommitted shows here before GitHub's run would miss it. It
exits with the number of suites that failed and prints the end of each
failing one's output. `--repeat N` is for a flaky suite: it stops at the
first round with a failure and exits with that round's status. A flake that
comes only under load wants
`usage-dev stress --runs 30 --jobs 5 plugin-test node`: that many runs,
that many at once, beside a busy loop per CPU (`--burn`), and how many each
suite failed. The plugin's suites want `plugin/node_modules` (`npm ci`), the
engine's types under `plugin/.claude-plugin/types/` and the `claude` CLI;
without them those lines fail and the rest still run. Name one suite to run
it alone, by its name in the table below.

Each suite exits non-zero on failure. They take seconds, use committed
fixtures only, and never read your credentials or your `~/.claude` history.

## The suites

| Suite (`tests NAME`) | Command | Checks | Result line |
|---|---|---|---|
| `usage-dev` | `python3 tests/usage-dev.py` | `tools/usage-dev.py`'s argument parsing, the steps each command runs, and that every script they name exists | unittest `OK` (20 tests) |
| `node` | `cd plugin && node --test 'test/*.test.ts'` | the plugin against the committed cases under `tests/fixtures/`: the spec, the configuration and usage-source readers, the formatters and spans, the accounting, the calibration, the folds and their saves, the band's rows and tree, the grid, and the receipt; and each generator under `plugin/tools/` run again in memory | `ℹ fail 0` |
| `typecheck` | `cd plugin && npm run typecheck` | the plugin's types, with TypeScript and Node's type definitions from the lockfile | no output |
| `typecheck-plugin` | `cd plugin && npm run typecheck:plugin` | the hooks' types against the engine's, which loading the plugin in Claude Code writes | no output |
| `plugin-test` | `cd plugin && npm run test:plugin` | the hooks' own suites, `plugin/plugin-tests/`, run in the engine | `N pass` |
| `plugin-validate` | `cd plugin && claude plugin validate .` | the plugin's manifest | `Validation passed` |

## What CI runs

[`.github/workflows/tests.yml`](../.github/workflows/tests.yml) runs on every
push and pull request:

- **plugin** — the `node` suite, the type check, `docs/options.md`'s
  option table against `node plugin/tools/gen-option-docs.ts`, and
  `usage-dev`.
- **shell** — `bash -n` and `shellcheck -S warning` over `tests/*.sh`.

`nix flake check` runs `tests/all.sh` too, in a build
([`nix/check-tests.sh`](../nix/check-tests.sh)): every suite but the three
that want the `claude` CLI or the types it writes.

## Checks that stay manual

| Command | Why CI cannot run it |
|---|---|
| `usage-dev folds [--largest N] [FILE…]` | breaks the transcript folds over every real transcript; minutes over your whole history |
| `usage-dev probe-advance` | measures every glyph's cursor advance in this terminal; needs a real tty and asserts nothing |

A runner has no Claude history to replay and no real terminal to measure.
See [tests/README.md](../tests/README.md#manual-checks) for how to run each.

## Changing what the readout draws

Edit the plugin, then regenerate the cases it writes and read the diff:

```sh
usage-dev row-cases     # the band's rows and the receipt
usage-dev grid-cases    # the grid
git diff tests/fixtures/
```

Accept the new cases only if every line that moved is one you meant to move,
and commit them with the change: the diff is the review. A change to a saved
fold's text goes with a new format in `plugin/src/state_spec.ts` and
`usage-dev fixtures`; a change to an option, with `usage-dev fixtures` too,
which writes the configuration cases.

[tests/README.md](../tests/README.md) covers each fixture family, which
writes it, what the pinned environment holds still, and what each case is
for.

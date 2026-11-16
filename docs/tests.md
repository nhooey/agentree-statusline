# Tests

Everything is standard-library Python and bash, so there is nothing to install.
Run the whole deterministic set with `tests` in the dev shell (`usage-dev
test`, or `bash tests/all.sh` outside it), the mod's included, side by side,
with one line per suite on how it went:

```sh
tests                    # every suite, then generated, about 45 s
tests status node        # the ones named
tests --repeat 20 node   # again, until a round fails
tests --skip py39-floor  # all but those named
```

Last comes `generated`: it reruns the fixture generators and fails if
`git status` then shows any changed or untracked file, so a generator's output
left uncommitted shows here before GitHub's run would miss it. It exits with the number of suites that failed and prints the end of each
failing one's output. `--repeat N` is for a flaky suite: it stops at the first
round with a failure and exits with that round's status. A flake that comes
only under load wants `usage-dev stress --runs 30 --jobs 5 plugin-test
sources-v1`: that many runs, that many at once, beside a busy loop
per CPU (`--burn`), and how many each suite failed. The mod's suites want `mod/node_modules` (`npm ci`),
the engine's types under `mod/.claude-plugin/types/` and the `claude` CLI;
without them those lines fail and the rest still run. Name one suite to run
it alone, by its name in the table below.

Each suite exits non-zero on failure. They take seconds, use generated fixtures
only, and never read your credentials or your `~/.claude` history.

Run them from a directory macOS does not guard. Under `Documents`, `Downloads`
or `Desktop`, TCC can make Python's imports fail part-way through with
`PermissionError: [Errno 1] Operation not permitted`, which looks like a bug in
the program and is not.

## The suites

| Suite (`tests NAME`) | Checks | Result line |
|---|---|---|
| `panel` | the [subagent rows'](../tests/README.md#subagent-row-cases) 278 render cases, from the committed cases in `tests/fixtures/`; its runner, `tests/run-cases.py`, runs `status` and `cost` below too, each case's [figures](../tests/README.md#figures) and render stages apart | `panel    278 cases   0 files differ` |
| `status` | `--mode status` output, byte for byte, against 141 golden files | `pass 141   fail 0   missing 0` |
| `cost` | `--mode cost` output against 87 golden files | `pass 87   fail 0   missing 0` |
| `py39-floor` | the Python 3.9 floor: compiles everything and renders each mode under 3.9 | `pass 67   fail 0   missing 0` |
| `node` | the TypeScript port against the cases the Python writes under `tests/fixtures/`: the spec, the usage-source reader, the accounting, the calibration, the formatters and spans, and the status line, the receipt and the subagent rows, cell by cell and against every golden | `ℹ fail 0` |
| `typecheck` | the TypeScript port's types, with TypeScript and Node's type definitions from the lockfile | no output |
| `usage-source` | the Claude Usage Tracker reader, `cmd:` sources, and the scoped source cache | `pass 39   fail 0   missing 0` |
| `sources-v1` | the normalized v1 reading: schema, timestamps, separate quota buckets | `ok …` |
| `source-cache` | source precedence, freshness, refresh backoff, cache isolation | `ok …` |
| `http-sources` | admin and experimental HTTP sources against injected transports | `ok …` |
| `app-server` | a fake Codex app-server: framing, buckets, bounded cleanup | `ok …` |
| `claude-sources` | a normalized reading projected onto Claude's limit rows | `ok …` |
| `codex` | Codex rollout accounting, child threads, Stop report state | `ok …` |
| `formatting` | shared width and formatting helpers, display switches | `ok …` |
| `port-cli` | the public CLI end to end, including held-open stdin and concurrent Stops | unittest `OK` (22 tests) |
| `config` | the configuration files: the shared cases of `tests/fixtures/config/`, `--show-config`, a file and a flag agreeing, a bad file still drawing, and the goldens kept off this machine's own files | unittest `OK` (14 tests) |
| `usage-dev` | `tools/usage-dev.py`'s argument parsing, the steps each command runs, and that every script they name exists | unittest `OK` (20 tests) |
| `agents` | agent spend: reading agent files, folding them into turns, the 👥 row, the tool-time partition, the receipt's per-turn share of it with its agents', the cache of each agent file's reading, and the calibration scan's cache of each file's priced requests, and the main thread's open shells and Monitors, and the receipt's turn tag, and a running agent's row waiting for its end | `pass 88   fail 0` |
| `fold` | the main transcript's folds broken anywhere: finished at every record, or with a half-written last line, each reads on as the whole fold; and each fold saved as text to the digest `tests/fixtures/fold-saves.json` holds, read back at every line end and past a torn head | `pass 335   fail 0` |
| `subagent` | the subagent rows: finding an agent's file, billing, window shares, nesting, the reported ETA and its inheritance, the inbox, silence, compactions, open shells and Monitors, API errors and worktree branch, a window share that never starts the calibration scan, row shape | `pass 115   fail 0` |
| `claude-subagent-render` | subagent row rendering with no file or source reads | `ok …` |
| `rate` | the 🛫 token-rate sampler, the Doing cell and the main thread's states, column 2 in the padded profile, and the brightness-as-magnitude cuts, and the 🧠 estimate after a compaction | `pass 71   fail 0` |
| `grid` | `grid.py`, the redesigned grid, against the [cases the TypeScript writes](../tests/README.md#grid-cases), under each profile they name | `pass 22159   fail 0` |

The goldens pin the clock, so every render is the rate sampler's first tick
and there is no rate to show: the Doing figure is 🤖 and how long the corpus
transcript has been quiet. `rate.py` exists to check what the goldens cannot:
it steps the clock itself.

## What CI runs

[`.github/workflows/tests.yml`](../.github/workflows/tests.yml) runs on every
push and pull request:

- **goldens** — every suite in the table above except `py39-floor.sh`, on
  Python 3.9 and 3.13. The two golden scripts call `/usr/bin/python3`
  directly, so they run on the runner's system Python whichever matrix entry
  is active.
- **python 3.9 floor** — `py39-floor.sh`, pointed at a real 3.9 through `PY39`.
- **shell** — `bash -n` and `shellcheck -S warning` over `tests/*.sh`.

`nix flake check` runs `tests/all.sh` too, in a build
([`nix/check-tests.sh`](../nix/check-tests.sh)): every suite but
`py39-floor`, which wants a Python 3.9, and the three that want the
`claude` CLI or the types it writes. The goldens run under the build's
Python, through `TEST_PYTHON`.

`usage-source.py` runs in CI even though it reads a macOS app's preference
store: it builds its own store with `plistlib`, so it needs neither macOS nor
the app.

## Checks that stay manual

| Command | Why CI cannot run it |
|---|---|
| `usage-dev compaction-once [TRANSCRIPT…]` | replays your real sessions to check every compaction is reported exactly once; minutes, not seconds |
| `usage-dev agents-once [TRANSCRIPT…]` | the same for agent spend reported late |
| `usage-dev folds [--largest N] [FILE…]` | breaks the transcript folds over every real transcript, in both ports; minutes over your whole history |
| `usage-dev selftest` | measures the layout in the terminal you run it in; needs a real tty |
| `usage-dev probe-advance` | measures every glyph's cursor advance in this terminal; needs a real tty and asserts nothing |

A runner has no Claude history to replay and no real terminal to measure.
See [tests/README.md](../tests/README.md#manual-checks) for how to run each.

## Changing what the readout draws

Edit the program, then re-record and read the diff:

```sh
usage-dev goldens               # or usage-dev goldens --suite status
git diff tests/golden/
```

A change to a test input goes in its generator under `tests/fixtures/gen/`;
run `usage-dev fixtures` and read `git diff tests/fixtures/`
before re-recording.

Accept the new goldens only if every line that moved is one you meant to move,
and commit them with the change. `--regen` is the step where a regression gets
recorded as the expected output, so the diff is the review.

A failing golden run writes both sides under `tests/out/` (status) or
`tests/out-cost/` (cost) as `NAME.got` and `NAME.want`. A failing panel
case names its file and case;
`usage-dev fixtures` and `git diff tests/fixtures/panel/`
show the rows that moved.

[tests/README.md](../tests/README.md) covers how the goldens are built, what
the pinned environment holds still, what each case is for, and the recorded
behaviours that look like bugs.

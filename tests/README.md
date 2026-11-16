# Tests

How to run the suites, and what CI runs, is in [docs/tests.md](../docs/tests.md).
This file is for someone changing or adding a test: what each fixture family
holds and which side writes it, what the pinned environment holds still, what
each case is for, and which recorded behaviours are deliberate.

- [The committed corpora](#the-committed-corpora)
- [The pinned environment](#the-pinned-environment)
- [Figures](#figures)
- [Status cases](#status-cases)
- [Cost cases](#cost-cases)
- [Subagent row cases](#subagent-row-cases)
- [Grid cases](#grid-cases)
- [Row cases](#row-cases)
- [The folds' saves](#the-folds-saves)
- [The configuration cases](#the-configuration-cases)
- [Manual checks](#manual-checks)
- [Behaviours that look like bugs](#behaviours-that-look-like-bugs)

## The committed corpora

Everything under `fixtures/` is committed, and each family is one of two
kinds: written by a generator under `mod/tools/`, or committed data that no
generator writes, which the mod's tests read as the reference. Payload
paths are `${HOME}` and `${FIXTURES}` placeholders that the tests fill in,
so no fixture carries a username.

```
fixtures/
  cases.json             every case, in order: suite, input, env, figures
  env/<name>.json        clock, zone, locale, terminal, usage source,
                         calibration, tracker store, which repo
  payloads/status/       status-line payloads
  transcripts/status/    the transcripts and agent files they point at
  transcripts/cost/      the Stop hook's transcripts
  transcripts/subagent/  sessions with agents, for the fold and calibration
                         fixtures; see Subagent row cases below
  figures/<suite>/       the figures documents the cases name; see Figures
  panel/inputs.json      prepared subagent tasks; see Subagent row cases
                         below
  records/ calib/ render/ claude/
                         calls of the accounting, the calibration, the cells
                         and the glue, each with its arguments and result
  config/                the configuration files' cases; see The
                         configuration cases below
  formatting/ sources/   calls of the formatters, the spans and the
                         usage-source reader, each with its arguments and
                         result
  grid/<profiles>.json   the grid's layouts and rows; see Grid cases below
  rows/<profiles>.json   the band's and the receipt's rows from the figures;
                         see Row cases below
  fold-saves.json        a digest of each fixture's saved folds; see The
                         folds' saves below
```

| Family | Written by | Read by |
|---|---|---|
| `config/` | `node mod/tools/gen-config-cases.ts` | the node suite |
| `grid/`, `rows/` | `node mod/tools/gen-grid-cases.ts`, `node mod/tools/gen-row-cases.ts` | the node suite, which also runs each generator again and fails on a difference |
| `fold-saves.json` | `node mod/tools/gen-fold-saves.ts` | the node suite |
| everything else | nothing: committed data | the node suite |

A family with a generator changes only through it: a hand edit is lost on
the next run. `tests/all.sh`'s `generated` step reruns them all and fails
on a difference, and the node suite runs each again in memory.

`records/`, `calib/`, `render/cells.json`, `claude/` and
`formatting/values.json` are written once, one case a line, and
`mod/test/cases_once.ts` reads them back into the calls they hold:

- a case whose `cfg` is a list of names stands for one case under each
  of the file's `configurations` it names, which all give its result;
- `{"$": NAME}` is the value the file's `names` holds under NAME, a
  value its cases hold more than once;
- `{"$record": TYPE, ...}` is a record (`Transcript`, `Turn`, `Payload`,
  `Git`, `Limits`, `CacheShares`, `AgentUsage`) with only the fields
  that differ from the defaults the TypeScript builds it with, so a new
  field with a default touches no case.

## The pinned environment

Each case names an environment in `fixtures/env/`, which holds still
everything a case's figures read that is not its input:

| Pinned | Without it |
|---|---|
| `now`, 1786847000 (2026-08-16 02:23:20 UTC) | every duration and both clock cells move |
| `tz`, UTC, and `locale` | 🕐 and 📅 shift by the local offset |
| `calib`, the calibration cache, `{"sess": 5.50, "week": 4.10}` | the window shares depend on your own history |
| `tracker`, a Claude Usage Tracker store | `auto` could read the tracker app installed on this machine |
| `source`, a usage source's version-1 reading with a fixed `as_of` | the plan percentages come from whatever source the host has |
| `terminal`, empty, so the `unknown` profile | the width profile depends on the terminal that runs the suite |
| `repo`, a clean fixture repo (branch `golden-clean`) or a dirty one (`golden-dirty`) | 🌿, 💾 and the project name record your checkout |

The pinned instant is 6.7 minutes before `01-baseline`'s 5-hour reset and 1.9
days before its weekly one, so both 🔜 countdowns draw real figures, and it is
after every generated record, so every elapsed figure is positive.

The cases of one suite share one state directory, in the order
`cases.json` lists them: a payload with `rate_limits` writes the cache that a
later payload without them reads, and the documents record it.

## The input transcripts

The main status transcript is built to reach branches a recorded session only
reaches by accident:

- a **sidechain** request, which is billed but must not set the context
  reading;
- an **interrupted** request, whose all-zero usage must not overwrite the last
  real reading;
- a repeated `requestId`, which must be counted once;
- a question put to the user (`AskUserQuestion`) inside a turn, whose span
  counts under 🚦 rather than 🔧;
- timestamps chosen so the ⌛ row's 🔧 🤖 🚦 partition reads `58m 3h 6h` over
  a 9.3-hour session.

## Figures

A readout runs in two stages:

1. **Figures.** The inputs read -- payload, transcript and agent files, usage
   source, calibration cache, repository, the clock -- and every figure the
   rows draw worked out from them: `statusFigures` in `mod/src/claude.ts`
   for the band, and `costFigures` for the receipt.
   Everything that reads a file or a cache, runs a command or reads the
   clock happens here.
2. **Render.** A figures document drawn into rows at a width, under the
   options and the terminal profile, reading nothing else.

Between them is a figures document. A document has no width and no flags,
so each case names one in `cases.json`'s `figures`, and the cases that come
to the same document name the same one, committed once as
`fixtures/figures/<suite>/<figures>.json`. `mod/test/claude.test.ts` builds
each case's document from its inputs and compares it, field for field,
with the one it names, so a case whose document differs fails, and checks
that the document's records have exactly their fields. The row cases are
drawn from the committed documents. To draw one by hand:

```sh
node mod/tools/draw-figures.ts tests/fixtures/figures/status/<name>.json --cols 160
```

The text is canonical:

- **Keys sorted**, two-space indent, UTF-8 unescaped, a newline at the end.
- **Numbers exact**: the shortest decimal that reads back as the same double,
  positional (`0.00001`, never `1e-05`), and a whole number as an integer
  (`300`, not `300.0`). That is JavaScript's `Number#toString` for every
  figure here. Nothing is rounded, so a port has to sum in the same order.
- **Missing is null**, never 0 or "": a string field with no value, the
  transcript's `cache_pct` of -1 and its epochs of 0 are written null.
- **Times are epochs**; `clock.tz` is the zone the clock cells are drawn in.
- **Paths are placeholders**: `${HOME}`, `${FIXTURES}`, and `${SCRATCH}` for
  the suite's scratch directory (the fixture repos, the `cmd:` sources).
- **No width and no flags.** A document is drawn at any width and under
  any option, so a case names one by its input and environment alone,
  except where the cases' shared state makes them differ: the first cost
  case to run a `cmd:` source records what the command printed, and the
  later ones read it back from the source cache, which keeps less.
- **Committed sparse.** The committed text leaves out `schema`, and each
  field of a record (a `Payload`, `Transcript`, `Git`, `Limits`,
  `CacheShares` or `Turn`) whose value is null, so a schema number touches
  no document and a new record field only the documents that have a value
  for it. `mod/test/figures_doc.ts` puts them back, with the mod's schema
  number. The other nulls, of the document's own shape, stay in the text.

`schema` is 6 and `mode` is `status` or `cost`. Schema 2 (2026-10-19) added
the figures the redesigned grid draws and today's rows do not: the status
document's `turn` and `accounting`, the accounting's time and 💾 figures, the
`Turn`'s lines and the `Transcript`'s main-thread figures. Schema 3, the same
day, added what the decisions in the plan's
[Where each row's figures come from](../agents/plans/closed/redesign.md#where-each-rows-figures-come-from)
need: the status document's `open_turn` and `accounting.open_turn`,
`accounting.own`, the session's `start_s`, the `Transcript`'s `own_parts` and
`own_est` with the compactions in its own cost, and the `Turn`'s `eta`. No row
moved either time. Schema 4 added the `Transcript`'s `session_name` and
`session_color`, which the band's 🎮 row draws, and schema 5 the `Limits`'
weekly Fable window, `fable_pct` and `fable_reset`, which the 💳 row draws as
🦊. Schema 6 added the `Limits`' other weekly windows, `opus_pct`,
`sonnet_pct`, `omelette_pct`, `oauth_apps_pct` and `cowork_pct` with a
`_reset` each, which the 💳 row draws after 🦊 once the option
`weekly-windows` turns them on. Both modes carry:

| Key | Holds |
|---|---|
| `clock` | `now`, the epoch every duration and clock cell is drawn from, and `tz` |
| `context_window` | the window the 🧠 percentages divide by, in tokens |
| `usage.reading` | the version-1 reading the usage source gave ([docs/usage-sources.md](../docs/usage-sources.md)), or null |
| `usage.plan` | the plan figures the accounting divided by: `session_pct`, `weekly_pct`, `session_resets_at`, `weekly_resets_at` |
| `usage.account_text` | the account summary row, when one is drawn |

A status document adds the records the band takes, field for field
as `mod/src/claude_records.ts` defines them:

| Key | Record |
|---|---|
| `payload` | `Payload`: the status-line JSON as read, its strings as given |
| `transcript` | `Transcript`: tokens, cache rate, context, the last exchange, the ⌛ durations and their epochs, ETAs, queue and compactions; and the main thread's own, apart from its agents: `own_tok_up`, `own_tok_down` and `own_cache_pct` over its own requests; `own_parts`, an `[epoch, dollars]` pair for each of those requests and each compaction in the order written, a compaction's stamped where its turn is (at a `/compact` prompt with no calls, else at its boundary); `own_usd`, the parts totalled; `own_est`, true when a compaction is in them, whose summary's cost is an estimate; `lines_added` and `lines_removed` off its own tool results; the `prompt_id` and `turn_index` of the turn opened last; and `session_name` and `session_color`, the session's name and Claude Code's colour for it, off its latest `custom-title` (else `agent-name`) and `agent-color` records |
| `git` | `Git`: branch, dirty, toplevel, worktree |
| `limits` | `Limits`: the window percentages as the source gave them, this session's and this turn's share of each, the weekly Fable window's percentage (`fable_pct`, no shares) and the other weekly windows' (`opus_pct` and the like, no shares), the resets as epochs |
| `cache_shares` | `CacheShares`: 📖 and 📝 for the turn and the session |
| `rate` | the session's token rate per second, or null |
| `turn` | the `Turn` the 🎤 figures are about, the last one with main-thread calls that is not a compaction (`_with_shares`' pick), or null |
| `open_turn` | the `Turn` opened last, whether or not it has called yet (`open_turn`), which the running 🎤 row draws: a fresh turn reads zeros, and its `text` is its opener, a queued message or a notification included; or null |
| `accounting.turn` | `turn`'s accounting, as the cost document's per turn, or null |
| `accounting.open_turn` | `open_turn`'s, the same way, or null |
| `accounting.session` | the same over every turn of the session, with `start_s`, or null |
| `accounting.own` | the main thread's own: `cost_usd`, its `own_usd`, and its `sess_share` and `week_share` of each window over `own_parts` (`parts_shares`), null for a window with no start; or null with no transcript |

A status document's window shares in `accounting` are null when there is no
plan reading, since no calibration is asked for then; `limits` carries the
same shares rounded into its strings.

A cost document adds:

| Key | Holds |
|---|---|
| `turns` | every `Turn` the transcript folds into, in order, agent turns included; each with its `lines_added` and `lines_removed`, the main thread's tool results in the turn and its agents' filed with the requests that read them, and its `eta`, `[epoch, seconds]` off the last ETA the main thread reported in it, kept after the turn ends, or `[]` |
| `calibration` | dollars per point of each window, `sess` and `week`, or null |
| `accounting.turns` | per turn: `cost_usd`, its `sess_share` and `week_share` of each window, the `read_share` and `write_share` of its cost, `model_s` and `tool_s` (`turn_times`, the main thread's and its agents' agent-seconds), the main thread's `blocked_s`, and `lines_added` and `lines_removed` |
| `accounting.session` | the same over every turn, for the totals row: sums, with the shares worked out over the sums; and `start_s`, the earliest turn's stamp, which the 🎮 rows' ⌛ counts the session's age from, or null |

The cost rows read their shares from `accounting` and work out none
themselves, so the render stage takes only the percentages from
`usage.plan`, for the totals row's 💳 figures, and not the window ends.

## Status cases

The status cases are the 19 payloads under the default environment, then:

| Case | What it checks |
|---|---|
| `01-baseline` | a full session: every cell drawn |
| `02-no-limits` | a payload with no `rate_limits` |
| `03-no-transcript` | a transcript path that does not exist |
| `04-pr-and-style` | an output style and a PR number on the chat rows |
| `05-haiku-max` | Haiku at `max` effort with a 200k window |
| `06-zero-cost` | a cost under a dollar, no duration fields, no lines changed |
| `07-big-numbers` | a cost over $1,000 and 99,999 lines added |
| `08-limits-critical` | plan windows nearly spent |
| `09-no-session-id` | no session id, so no per-session state |
| `10-empty-payload` | `{}` |
| `11-sonnet-200k` | a 200k context window |
| `12-root-cwd` | `/` as the working directory |
| `13-empty-transcript` | a transcript file with no records |
| `14-limits-full` | a window at 100٪, drawn 💯 |
| `15-cache-warn`, `16-cache-crit` | 🎯's amber and red tiers |
| `17-rounding-boundary` | 999,600 output tokens, which must print `1M`, not `1000k` |
| `18-agents` | a session whose agents billed |
| `19-queue-and-compact` | two queued messages and a compaction, the 📨 and 🤏 cells |
| `dirty-01` | `01-baseline` inside the dirty repo: 🍂 and `✱` |
| `stale-plan-*` | an explicitly selected `cmd:` source replaces the native reading the main loop left in the cache |
| `straddle-02` | a 5-hour window that opened inside the last turn |
| `uncalibrated-02` | a reading too coarse to calibrate window shares from |
| `model-fable`, `model-mythos` | model families other than Opus, Sonnet and Haiku in the 🤖 cell |
| `fable-own-reset`, `fable-shared-reset` | a weekly Fable window beside the plan's two, resetting after the weekly one and with it, which the 💳 row's cases draw |
| `weekly-windows` | the weekly Opus window resetting with the plan's week and the weekly Sonnet window two days after it, which the 💳 row's cases draw, off as the defaults leave them and on |

The status cases' documents read `--usage-source auto`. `01-baseline`
carries native `rate_limits`, which are cached for 60 seconds, so later
payloads without their own (`02`, `10`) quote that cached reading — `💳 15٪`
and `87٪`.

## Cost cases

`transcripts/cost/` holds eleven transcripts, one per branch of the turn reader:

| Transcript | Branch |
|---|---|
| `01-plain` | several ordinary turns |
| `02-compaction` | an automatic compaction, reported on its own 🤏 row |
| `03-single-turn` | one turn, nothing earlier to subtract |
| `04-tool-result` | a turn ending on a tool result, whose Bash call is 🔧 and not ⌛🤖 |
| `05-sidechain` | a sidechain that is billed but is not the context reading |
| `06-interrupted` | an interrupted request with all-zero usage |
| `07-empty` | an empty file |
| `08-woken` | turns opened by messages nobody typed (task notifications, peer messages), including a batch where only the second message is answered |
| `09-agents` | agent files beside the transcript, and a 👥 row for spend the 🎤 row cannot carry; an `Agent` call the first turn waits on, which is in neither ⌛🤖 nor 🔧, and a Bash call in the second |
| `10-turn-id` | the turn tag: a real `promptId` and a `turnIndex` past 9, and the first turn's ids kept off the second's row |
| `11-turn-id-late` | an opener with no ids, as a queue operation writes it: the tag prints the hash alone |

Each is a case under the `app-41-63` environment, then:

| Case | What it checks |
|---|---|
| `plan-cache-01` | a second planted source reading (15٪ / 87٪) instead of the default 41٪ / 63٪ |
| `plan-full-01`, `plan-full-02` | a window at 99.6٪ and 100٪, drawn 💯 |
| `straddle-01` | a window that opened inside the last turn |
| `uncalibrated-01` | a reading too coarse to calibrate from |

## Subagent row cases

Two families: the sessions under `transcripts/subagent/`, a main
transcript each with its agents' files beside it, which the fold fixtures,
the calibration scan and the band's tree cases read; and the prepared
tasks under `panel/`.

| Session | What it holds |
|---|---|
| `01-mixed` | the running modes (🔧 a tool, 🤖 with a 🛫 rate and quiet in amber, 🚦 a question), ✅ ❌ 🛑, 💥 an API error, a workflow agent one directory down |
| `02-parked` | completed agents only waiting: 💻 a shell, 📡 a Monitor beside one, ⛳ their own ETA, 💤 an agent under them, whose ETA the parent inherits; an ETA gone stale (amber `+`), one signed off at 0s and running over (red `+`) |
| `03-tree` | the tree four deep, past the two levels the grid keeps the chrome for, 🤏 compactions, 📨 messages queued, a finished ancestor, a parent with no file |
| `04-bare` | no agent files: its tasks were shells and a remote agent |
| `05-empty` | no agent files and no tasks |

**Prepared tasks**, `fixtures/panel/inputs.json`, committed data: by group
and name, one case a line, each case's prepared `(task, usage, meta,
shares)` records, at the figures documents' clock. The `corpus` group holds
the inputs prepared from these sessions' task lists, with 🥚 a queued task,
shells, a remote agent, a status never seen, tasks with no id or not an
object, a worktree's 🌿 and a label that repeats the description. The rest
are made by hand for what the corpus does not reach: `states`, `eta`,
`counts`, `tree` (depths, siblings, a missing parent and a loop),
`gauges`, `figures` (the model, cache, context and share cells), `who`
(the name, branch and activity) and `missing` (no usage, a partial one, no
meta or shares, tasks that are skipped). No two cases hold the same tasks.
`mod/tools/gen-row-cases.ts` draws each case as the band's tree, three of
the corpus's at every width and the rest at one (see Row cases below), and
`mod/tools/draw-figures.ts --agents <group>/<name>` draws one by hand.
`tests/fixtures/claude/agent-usage.json`
holds each session's agents' usage, field for field, which
`mod/test/band_tree.test.ts` holds `agentUsageOf` to.

## Grid cases

`fixtures/grid/` pins the redesigned grid
([the plan](../agents/plans/closed/redesign.md)), `mod/src/grid.ts`. They are written by the
TypeScript, with `usage-dev grid-cases`.

The inputs are plain data: the mockup's sample rows by id, each its scope, its
panel depth, its label's pieces (path, spans, drop rank) and its cells as
spans by column key, so a port lays them out without any renderer. Each
`layout` case is a set of rows, `cols`, the `--hide` patterns and the fixed or
from-the-rows grid, with the column keys `layout` keeps; each `draw` case is
one row on those keys, with and without the label's spill, and what `draw`
makes of it as spans; the first draw case in a file also has the joined
line. The matrix is 300 to 6 columns, a wide terminal and then each width
at which a column drops, down to where a label has no room and the chrome
alone runs past the right edge, ten hide sets, both grids, agents to each
depth and both phases' rows, deduplicated. `unknown.json` holds every case.
`iterm-tmux.json`, where `_PAD` widens 🧩, 🧠 and 💰, holds the sample a
profile can change: the layout cases whose columns differ, with their draw
cases, and every draw case at 300 columns. The shapes are in the
generator's header.

`mod/test/grid.test.ts` replays every case under each of its file's
profiles, and `unknown.json`'s layout cases under every other profile but
where that profile's file has the case, and runs the generator again in
memory, failing if what it writes differs from what is committed, so
regenerating and reading the diff is the only way to change them.

## Row cases

`fixtures/rows/` pins the row builders, the step between a figures document
and the grid: `mod/src/band.ts` draws a status document as the band above the
prompt (💳 🎤 🤖💬 🎮 while a turn runs, 💳 🤖💬 once it ends) and
`mod/src/receipt.ts` draws a cost document as the receipt (its 🔺🔖 head, 📊 🎤
and 📊 🎮) and a status document as the 🔻🔖 start line, all through the cells
in `mod/src/cells.ts`. The plan's
[Where each row's figures come from](../agents/plans/closed/redesign.md#where-each-rows-figures-come-from)
says which field each cell reads. Like the grid's, these are written by the
TypeScript, with `usage-dev row-cases`.

The inputs are the committed [figures documents](#figures), by id
(`status/01-baseline`), filled out as `mod/test/figures_doc.ts` fills them.
Each `band` case is a status document
drawn at `cols` under the `--hide` patterns in a `phase`, with `rate`, the 🛫
the mod works out itself and passes in; each `receipt` case is a cost document
at `cols` under `hide`, with the 📦 🌿 of the status document named by
`workspace`, which stands for the band's last one; each `start` case is a
status document's start line. Out come the spans of each row; the first case
of each kind in a file also has its rows joined into escape codes, since
`fixtures/formatting/spans.json` pins the joining for the rest. The matrix is
200, 155, 120 and 80 columns, both phases, three hide sets at 155 and a 🛫 at
200. The tree cases draw `status/01-baseline` above the prompt with the
subagents of each [prepared task](#subagent-row-cases) case, three of the
corpus's at every width and the rest at 160 columns. HOME is `${HOME}`,
the placeholder the documents' paths are written
under, and each clock is drawn in the document's own zone. `unknown.json`
holds the whole matrix. The other profiles hold a sample, the cases a profile
can change: each status document at 155 columns in both phases, and every
receipt, profiles whose samples come out the same sharing one file
(`iterm-tmux.json`); a padded icon is a cell's, not a width's. The start and
account cases, which no profile changes, are written once.

`mod/test/rows.test.ts` replays every case under each of its file's profiles,
the start and account cases under every profile, and runs the generator again
in memory, failing if what it writes differs from what is committed. To look
at the rows in a terminal:

```sh
usage-dev figures tests/fixtures/figures/status/<name>.json --cols 160
usage-dev figures tests/fixtures/figures/cost/<name>.json \
    --status tests/fixtures/figures/status/<name>.json
```

## The folds' saves

`fixtures/fold-saves.json` holds, for each of the mod's three saved folds
(the main transcript's, each agent's, and the inbox's), its format number and
a digest of what it saves of each fixture transcript, which
`node mod/tools/gen-fold-saves.ts` writes; `--show PATH` prints a save's
text, to read a change by running it before and after.
`mod/test/main_fold.test.ts`, `agent_fold.test.ts` and `inbox_fold.test.ts`
save each fold again and fail where its digest differs or its format is not
`mod/src/state_spec.ts`'s, so a change to a fold's text cannot land without a new
format. They also break the folds anywhere: each fixture folded to every
record boundary, finished, and folded on to the end reads as its whole
fold, and so does one with a half-written last line folded on a copy and
then completed; and each save is read back at every line end and read on,
saved a part at a time, and read past a torn head.

## The configuration cases

`fixtures/config/cases.json` holds, for each case, a tree of configuration
files, the environment, the directory the walk starts from, and what
`mod/src/config.ts` makes of them: the project root, each layer's path, the
options a layer above the defaults set, each with its layer, each table
field a file set, and the warnings, word for word.
`fixtures/config/defaults-cases.json` holds the shipped defaults file and
changes to it, each with the error the strict reading gives, or null.
`node mod/tools/gen-config-cases.ts` writes both from the cases in its
source. `mod/test/config.test.ts` runs every case over a fake file system
and fails on any path asked outside the case's tree;
`mod/mod-tests/config.test.ts` checks the read through `$.fs`, its lines in
the mod's log, and that no path the mod asks for lies outside the test's own
world.

## Manual checks

### Breaking the folds over real transcripts

```sh
usage-dev folds [--largest N] [--seed S] [FILE...]  # in the dev shell
node mod/tools/check-fold.ts [...]                  # the same, outside it
```

The node suite breaks the main transcript's folds over the fixtures; this
breaks them over every `*.jsonl` under `~/.claude/projects/`, the agents'
files too, at three seeded record boundaries, either side of every
compaction and once inside a line, and checks each reads on as the whole
fold. One line a file, and a total. Over 4,495 files and 10.1 GB it took
109s; `--largest 3` takes seconds.

### `probe-advance.sh`

```sh
usage-dev probe-advance
```

Prints this terminal's cursor advance for every glyph the mod uses, by
drawing each one and asking the terminal for the cursor position (DSR). The
glyph list is the `E_*` constants and `EAW_WIDE` of `mod/src/spec.ts`,
read with Node. It asserts nothing. Run it after a
terminal update and before changing any glyph or width-table entry. See
[glyphs and terminals](../docs/glyphs-and-terminals.md).

## Behaviours that look like bugs

Each of these is deliberate and recorded in the figures documents and the
row cases.

1. **▴ is a weighted sum and is not truncated per turn.** Flooring each turn
   and summing drifts below the true total; the per-turn rows and the totals
   row would stop agreeing.
2. **Plan percentages come through a source cache.** A reading is fresh for 60
   seconds (300 for admin and experimental sources), so a totals row can lag
   the live figure by up to a minute. The band and the receipt quoting the
   same reading matters more than either being current.
3. **A limit percentage under 1 drops its leading zero** — `.09٪` — to keep
   two significant digits in four columns. Exactly zero is `0٪`.
4. **`13-empty-transcript` shows `🎮 0٪` beside `🎤 ?`.** An empty transcript
   has a session with no spend, but no last turn to take a share of.

The `plan-cache-*` and `stale-plan-*` cases plant `cmd:` source readings,
as described in the tables above; no other plan cache is
involved.

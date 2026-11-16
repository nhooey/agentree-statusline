---
title: Fewer fixtures, and none that a new field rewrites
state: approved
kind: end-state
---

# Fewer fixtures, and none that a new field rewrites

A plan to cut the committed test data from 750 files and 25.7 MB to about
220 files and 9 MB, and to stop a new record field or a format number from
rewriting hundreds of files, while both ports stay checked against the
same cases for as long as there are two ports.

- [The problem](#the-problem)
- [What is committed today](#what-is-committed-today)
- [What makes one change touch every file](#what-makes-one-change-touch-every-file)
- [What repeats](#what-repeats)
- [What the one-panel port changes](#what-the-one-panel-port-changes)
- [Target](#target)
- [Build order](#build-order)
- [What each cut gives up](#what-each-cut-gives-up)

## The problem

`tests/all.sh` ends with `generated`: it reruns the generators and fails
if the tree is then dirty. So every committed file that records a format
number, a schema number or a whole record is rewritten by any change to
that number or record, and the rewrite has to be committed.

The pull request "Draw the session's name and colour on the 🎮 row"
(branch `band-session-name`) adds two `Transcript` fields and raises the
main fold's format. It changes 308 files:

| Part | Files | Why they changed |
| --- | ---: | --- |
| Code, spec, docs, tests, one generator | 25 | the change itself |
| `tests/fixtures/records/` | 4 | new cases and one new input: the change itself |
| `tests/fixtures/figures/` | 230 | `"schema": 3` to `4` in each; 142 gain two `null` fields |
| `tests/fixtures/state/` | 45 | `"format": 6` to `7` twice in each, and three empty fields |
| `tests/fixtures/render/`, `rows/` | 4 | records written whole gain the fields; new cases |

275 of the 308 carry no information a reviewer can use.

## What is committed today

Measured on `master` with `find`, `wc -c` and `md5`. KB is 1,000 bytes.

### Inputs

| Family | Files | KB | Written by | Holds |
| --- | ---: | ---: | --- | --- |
| `transcripts/` | 79 | 141 | `gen/status.py`, `cost.py`, `panel.py` | sessions and agent files |
| `payloads/` | 21 | 21 | `gen/status.py` | status-line payloads |
| `env/` | 11 | 7 | `gen/cases.py` | each case's pinned environment |
| `cases.json` | 1 | 44 | `gen/cases.py` | 230 cases: input, width, flags |
| `records/inputs/` | 35 | 63 | `gen/records.py` | hand-made transcripts |
| `mod/mod-tests/fixtures.gen.ts` | 1 | 81 | `gen-mod-fixtures.ts` | transcripts as base64 |

`gen/` is `tests/fixtures/gen/`. These change only when a case is added.
None of them ripples.

### Expected outputs

| Family | Files | KB | Written by | Read by |
| --- | ---: | ---: | --- | --- |
| `figures/` | 230 | 2,473 | `run-cases.py` | `status`, `cost`, `node`, `gen-row-cases.ts` |
| `tests/golden/` | 230 | 235 | `run-cases.py` | `status`, `cost`, `node` |
| `state/` | 44 | 129 | `gen/state.py` | `fold`, `node` |
| `agent-state/` | 37 | 74 | `gen/state.py` | `fold`, `node` |
| `inbox-state/` | 9 | 19 | `gen/state.py` | `fold`, `node` |
| `records/*.json` | 4 | 2,034 | `gen/records.py` | `node` |
| `calib/` | 4 | 4,225 | `gen/calib.py` | `node` |
| `formatting/` | 3 | 2,601 | `gen/formatting.py` | `node` |
| `render/` | 2 | 1,810 | `gen/render.py` | `node` |
| `panel/` | 22 | 2,684 | `gen/panel.py` | `panel`, `node`, `gen-row-cases.ts` |
| `receipt/` | 1 | 146 | `gen/receipt.py` | `node` |
| `sources/` | 9 | 363 | `gen/sources.py` | `node` |
| `config/` | 2 | 212 | `gen/config.py` | `config`, `node` |
| `claude/` | 1 | 4 | `gen/claude.py` | `node` |
| `grid/` | 2 | 5,315 | `gen-grid-cases.ts` | `node`, `grid` |
| `rows/` | 2 | 3,022 | `gen-row-cases.ts` | `node` |

| Family | Guards |
| --- | --- |
| `figures/` | the accounting, apart from the drawing, in both ports |
| `tests/golden/` | the status line and the receipt, byte for byte, in both ports |
| `state/`, `agent-state/`, `inbox-state/` | each saved fold's text, and its format number |
| `records/*.json` | 1,850 calls of `claude_records` |
| `calib/` | 1,257 calls and 13 scan scenarios |
| `formatting/` | 22,757 formatter calls and 211 span calls |
| `render/` | 2,915 cell calls and 460 status lines |
| `panel/` | 278 subagent panels |
| `receipt/` | 136 receipts under flags the goldens do not reach |
| `sources/`, `config/` | the usage-source and configuration readers |
| `claude/` | 50 calls of the glue's small parts |
| `grid/` | 1,040 layouts and 5,686 drawn rows |
| `rows/` | 1,564 band, receipt and 💳 rows |

Totals: 750 files, 25,700 KB (602 expected-output files, 25,340 KB).

Three kinds of check are in that table:

- **Differential:** the Python writes `{fn, args, out}`, the TypeScript
  replays it. `records`, `calib`, `formatting`, `render`, `panel`,
  `receipt`, `sources`, `config`, `claude`, and `figures` built by each
  port. These are what keep the two ports in agreement.
- **Self-golden:** one port writes what it draws and fails when a rerun
  differs. `tests/golden/`, and `grid/` and `rows/`, which the
  TypeScript writes; `grid/` is also replayed by the Python's `grid.py`.
- **Format guard:** `state/`, `agent-state/`, `inbox-state/`. A saved
  fold's text may not change while `spec/state.jsonc`'s format number
  stays the same, in either port.

### How each family has changed

From `git log --name-only` over the 143 commits that touch a fixture or
a golden. No commit says which file caught a bug, so the measure is how
a family changes: a commit that rewrites most of it, or one that moves a
few files.

| Family | Commits | Rewrote most of it | Moved 3 files or fewer |
| --- | ---: | ---: | ---: |
| `figures/status` (142 files) | 5 | 3 | 1 |
| `figures/cost` (88 files) | 6 | 4 | 1 |
| `state/` (44 files) | 7 | 6 | 1 |
| `agent-state/` (37 files) | 3 | 3 | 0 |
| `golden/status` (142 files) | 24 | 15 | 1 |
| `golden/cost` (88 files) | 12 | 4 | 4 |
| `panel/` (22 files) | 15 | 14 | 1 |
| `rows/` (2 files) | 46 | — | 46 |
| `grid/` (2 files) | 29 | — | 29 |
| `formatting/`, `calib/`, `sources/`, `config/` | 10 to 14 each | — | all, or all but 1 |

- `figures/` and the three saved-fold families have, with one exception
  each, only ever changed all at once. Their per-file diffs have never
  been what showed a change.
- `golden/status` moved in a targeted way in 9 of 24 commits (1 to 64
  files: a width breakpoint, a rounding ladder, one cell). `golden/cost`
  is the family most often changed a few files at a time.
- `rows/` and `grid/` change with every change to the band, as two files
  of 1.5 MB and 2.7 MB each, so the diff is two files but not readable.

## What makes one change touch every file

1. **A version number inside every file.** Each figures document holds
   `"schema"`; each saved fold holds `"format"` and a `head` whose text
   holds `"format"` again.
2. **One file per case where one per input would do.** A figures
   document has no width and no flags, so a case at six widths writes
   six identical documents: the 230 files hold 43 distinct texts (26
   status, 17 cost). A change to one document is six diffs.
3. **Absent fields written as `null`.** The figures text is canonical,
   "missing is null", so a new optional field adds a line to every
   document, 728 `null` lines across the 43 today.
4. **Whole records where a test checks one thing.** A saved fold is
   written in full for 44 transcripts; `render/cells.json` writes each
   record with every field, so a new field touches cases that never
   read it.
5. **The same output in two forms.** `rows/`, `grid/` and `panel/` write
   each row as spans and again joined into escape codes, about half
   their bytes each (1,167 KB and 1,175 KB of `grid/unknown.json`).
6. **The whole matrix per terminal profile.** `rows/` and `grid/` write
   every case under `unknown` and again under `iterm` and `tmux`.

## What repeats

- **Figures, 230 files for 43 documents.** Above.
- **`formatting/values.json`, 22,757 cases.** Each call is written under
  each of 5 configurations. There are 6,398 distinct calls, and 4,922 of
  them give the same result under every configuration. Written once
  with the configurations that agree, the file holds 7,898 results.
- **`render/cells.json`, 2,915 cases.** 592 distinct calls, 1,023
  distinct results.
- **`rows/`.** `start` (52) and `account` (226) are identical in the two
  profile files, and 131 of 385 `band` cases are.
- **`grid/`.** 473 of 520 `layout` cases are identical in the two
  profile files. The `draw` matrix is 13 widths by 8 hide sets by both
  grids.
- **`panel/`.** 22 groups: the corpus at 6 widths, then again under each
  switch and terminal (`corpus-tmux`, `corpus-iterm`, …, 7 files), then
  the mixed panel under each again (`tight`, `subdec`, `tmux`, `iterm`,
  `unknown`). The cells these reach are the ones `rows/`'s tree cases
  draw.
- **`calib/shares.json`, 3,889 KB.** 626 cases whose arguments are 14 KB
  and whose results are 3,641 KB: each case writes the accounting of
  every turn again against each plan snapshot, unit and zone.
- **`records/turns.json`.** 316 KB of its arguments are 138 KB of
  distinct values written more than once.
- **`tests/golden/`.** 19 payloads at 6 widths and 11 transcripts at 5.
  Every status golden is also drawn by the TypeScript
  (`claude_render.test.ts`), by the Python from the run, and by the
  Python again from the figures document: three checks of one file.

## What the one-panel port changes

[One port](one-panel-port.md)'s step `OP5` removes the Python's Claude
modules, `--mode status` and `--mode cost` for Claude, their tests and
their generators. `OP2`, `OP3` and `OP4`, which it waits on, are done.
After it:

- **There is one implementation of the Claude side.** Every differential
  family whose writer is a Python Claude module has no second port to
  agree with: `records`, `calib`, `render`, `panel`, `receipt`,
  `claude`, `figures`, and `grid/`'s Python replay. Their generators go
  with the modules, so each family is either rewritten by the
  TypeScript or frozen as data nobody can regenerate.
- **Agreement still matters where the Python stays for Codex:**
  `config.py`, `sources.py`, `formatting.py`, `spans.py` and the state
  files both ports read (`spec/state.jsonc`). `config/` and `sources/`
  stay differential. `formatting/` stays differential for the functions
  `formatting.py` keeps.
- **The suites `status`, `cost`, `panel`, `claude-sources`, `agents`,
  `fold`, `subagent`, `claude-subagent-render`, `rate` and `grid` load
  those modules,** 10 of the 26 named in `tests/all.sh`, so `OP5`
  removes each or cuts it to what Codex uses, and `py39-floor` keeps
  Codex alone.
- **The goldens pin a layout nobody is shown.** The mod draws the band
  and the receipt through `band.ts`, `band_tree.ts`, `receipt.ts` and
  `cells.ts`. `renderStatusFigures`, `renderCostFigures` and
  `renderTaskRows` are called by tests alone; the mod uses only the
  cell helpers beside them. After `OP5` the 230 goldens, `receipt/`,
  `render/status.json` and `panel/`'s rows check TypeScript that no
  entry reaches.

So the steps below are in two groups: those worth doing before `OP5`,
because they end the ripple now and shrink what `OP5` has to move, and
those that only make sense once the Python twins are gone.

## Target

```text
tests/fixtures/
  cases.json            each case names its figures document
  env/ payloads/ transcripts/ records/inputs/     inputs, as today
  figures/<suite>/<document>.json   one per distinct document, sparse
  fold-saves.json       each fold's format and a digest per transcript
  records/ calib/ formatting/ sources/ config/ claude/   cases, deduplicated
  render/cells.json     the cells
  panel/inputs.json     the subagent tasks the tree cases draw
  grid/ rows/           one form per row, the second profile a sample
```

| Family | Files now | Files after | KB now | KB after |
| --- | ---: | ---: | ---: | ---: |
| `figures/` | 230 | 43 | 2,473 | 435 |
| `state/`, `agent-state/`, `inbox-state/` | 90 | 1 | 221 | 12 |
| `tests/golden/` | 230 | 0 | 235 | 0 |
| `panel/` | 22 | 1 | 2,684 | 150 |
| `receipt/` | 1 | 0 | 146 | 0 |
| `render/` | 2 | 1 | 1,810 | 300 |
| `rows/` | 2 | 2 | 3,022 | 950 |
| `grid/` | 2 | 2 | 5,315 | 2,000 |
| `calib/` | 4 | 4 | 4,225 | 1,300 |
| `formatting/` | 3 | 3 | 2,601 | 1,000 |
| `records/*.json` | 4 | 4 | 2,034 | 1,850 |
| `sources/`, `config/`, `claude/` | 12 | 12 | 579 | 579 |
| Inputs | 148 | 148 | 357 | 357 |
| **Total** | **750** | **221** | **25,700** | **8,900** |

`figures/` and the saved folds are measured (the 43 documents without
their `null` keys are 435 KB). The other "after" sizes are estimates
from the repeats counted above; each step measures its own.

### The session-name pull request under this layout

| Part | Files today | After `TF1`–`TF2` | After every step |
| --- | ---: | ---: | ---: |
| Code, spec, docs, tests, generator | 25 | 25 | 20 |
| `records/` | 4 | 4 | 4 |
| `figures/` | 230 | 0 | 0 |
| Saved folds | 45 | 1 | 1 |
| `render/`, `rows/` | 4 | 4 | 2 |
| **Total** | **308** | **34** | **27** |

`figures/` is 0 because no fixture session has a name, so no sparse
document mentions the new fields. The last column has no Python twin to
edit (5 files) and no `render/` records written whole.

## Build order

Each step is one pull request, with `bash tests/all.sh` green after it.
`TF1` to `TF3` need nothing; `TF4` to `TF7` follow `OP5`.

### Before `OP5`

1. **`TF1` The saved folds as one file of digests.** Done.
   `tests/fixtures/fold-saves.json` holds what `state/`, `agent-state/`
   and `inbox-state/` held:

   ```json
   {"main-fold":  {"format": 7, "saves": {"<transcript>": "<sha256>"}},
    "agent-fold": {"format": 4, "saves": {"<agent file>": "<sha256>"}},
    "inbox-fold": {"format": 1, "saves": {"<file>": "<sha256>"}}}
   ```

   A digest is over the texts those fixtures held, in order (the main
   fold's `parts` and `head`; each `[K, TEXT]` of the other two), each
   written as one line, `TEXT` or `K<tab>TEXT`. `tests/fold.py` and the
   three `mod/test/*_fold.test.ts` each save every fold, digest it and
   compare (`mod/test/fold_saves.ts` is the TypeScript's digest), so:

   - both ports still write each save byte for byte, since both must
     reach one digest;
   - a change to a fold's text still fails until the format is raised
     and the file regenerated;
   - "read each back on to the last" runs on the text the port has just
     written, which the digest shows is the other port's text too.

   `gen/state.py --show PATH` prints one save's text, for reading a
   change by running it before and after. A format change touches 1
   fixture file, not 90.

2. **`TF2` One figures document per distinct document, sparse.** Done.

   - `cases.json` gives each case a `figures` name; cases whose
     documents are the same name the same one (`01-baseline`, not
     `01-baseline@196` … `@none`). 230 files become 43.
   - The committed text leaves out `schema` and every record field
     (of a `Payload`, `Transcript`, `Git`, `Limits`, `CacheShares` or
     `Turn`) whose value is `null`. One loader per port
     (`tests/_figures.py`, `mod/test/figures_doc.ts`) puts back the
     port's own schema number and a `null` for each record field the
     text lacks, so the decoders, which refuse a document with a key
     missing, are unchanged. The document's other `null`s (106 lines
     across the 43: an accounting's `sess_share`, `usage.account_text`,
     a status document's `rate`, `turn` and `open_turn`) stay in the
     text, since a loader knows only the record tables and a new record
     field never adds one; the 43 come to 438 KB.
   - `run-cases.py` compares what each of the 230 runs wrote, made
     sparse the same way, with its named document; `claude.test.ts`
     does the same for the TypeScript. A case whose document differs
     from the one it names fails, so "no width and no flags" is still
     checked.
   - One check in each port that a written document has exactly the
     record tables' keys, since the sparse text no longer shows a key
     that is missing rather than `null`; and one that both ports name
     the same schema number.
   - Readers that name documents by case id follow: `gen/receipt.py`,
     `gen-row-cases.ts` (its `same` lists go), `draw-figures.ts`,
     `tools/palette-review.py`, `band_tree.test.ts`,
     `receipt_duration.test.ts`, `claude_render.test.ts`,
     `claude_cost.test.ts`. `rows/` is regenerated for the new ids.

   A schema number touches no fixture; a new field touches only the
   documents of sessions that have a value for it.

3. **`TF3` `rows/` in one form, the second profile a sample.** Done.

   - Each case keeps its spans and drops the joined `lines`:
     `spans.join` is pinned by `formatting/spans.json`, and one case
     per kind in each file keeps its joined line.
   - `iterm-tmux.json` keeps the cases a profile can change: each
     document once at 155 columns in each phase, and the receipts.
     `start` and `account`, identical under every profile, are written
     once, in `unknown.json`, and `rows.test.ts` replays them under
     every profile.

   2,826 KB to 899 KB, and a band change's diff is one line per case,
   not two.

### After `OP5`

`OP5` itself moves or deletes each Python generator. These steps say
what is left for the TypeScript to write, so `OP5` should move a
generator to Node only where a step below keeps its family.

4. **`TF4` The status line, the old receipt and the panel, removed from
   the TypeScript, with their goldens.** `renderStatus`,
   `renderStatusFigures`, `renderCostLine`, `renderCostFigures` and
   `renderTaskRows` go, with `claude_render.test.ts`,
   `claude_cost.test.ts`, `claude_subagent_render.test.ts`,
   `tests/golden/`, `receipt/`, `render/status.json`, and the cases of
   `cases.json` that differ only in width or in a flag those renderers
   read. The cell helpers the band uses stay, pinned by
   `render/cells.json` and `rows/`.

5. **`TF5` The panel's inputs as tree cases.** `panel/` keeps one file,
   `inputs.json`: the prepared tasks of the corpus sessions and of the
   hand-made groups that reach an agent cell nothing else does
   (`states`, `eta`, `counts`, `gauges`, `missing`, `who`).
   `gen-row-cases.ts` draws each as the band's tree at one width, into
   `rows/`. The groups that vary only the width, the `--hide` paths,
   the terminal or a switch (`widths`, `hide`, `tight`, `subdec`,
   `tmux`, `iterm`, `unknown`, `corpus-*`) go: the grid's cases cover
   widths and hiding, and the profiles are `rows/`'s sample.

6. **`TF6` The differential families, written once.** For the families
   the TypeScript now writes alone (`records`, `calib`, `render/cells`,
   `claude`), and `formatting/` for both ports:

   - a call that gives one result under several configurations is one
     case naming them (`formatting/values.json` 22,757 to 7,898,
     `render/cells.json` 2,915 to 1,023);
   - an argument written more than once is written once under a name,
     as `render/status.json` writes its records (`records/turns.json`);
   - a record in a case is written with the fields that differ from the
     record's defaults, so a new field with a default touches no case;
   - `calib/shares.json` keeps each turn list against one plan
     snapshot, unit and zone in full, and the other snapshots, units
     and zones for the session's totals alone.

   The TypeScript writes each family's `out` from its committed `args`
   (one tool, `mod/tools/gen-cases.ts`, with a `--check` the `node`
   suite runs, as `rows/` and `grid/` have). `config/` and `sources/`
   keep their Python generators.

7. **`TF7` `grid/` in one form, on fewer widths.** Done.

   - Each draw case keeps its spans and drops the joined `line`, as
     `TF3`; the first case in each file keeps its line.
   - `iterm-tmux.json` keeps the cases a profile can change: each layout
     case whose columns differ from `unknown.json`'s, with its draw
     cases, and every draw case at 300 columns. `grid.test.ts` replays
     `unknown.json`'s other layout cases under every profile.
   - 11 of the 13 widths: 300, 160, 150, 125, 100, 80, 60, 40, 20, 11
     and 6. Every width from 150 down to 20 drops a column under some
     hide set and grid, and 160 sheds the 💳 row's clock with every
     column kept, so only 240 and 200 go: every distinct layout (291)
     and every way a row's label and chrome meet its room (the pieces
     kept, whole, cut or gone; 416) is still reached.
   - `tools/diff-grid-fixtures.py` compares spans alone.

   5,289 KB to 1,751 KB.

Then `tests/README.md` and `docs/tests.md` describe the layout as it is,
and this plan moves to `closed/`.

## What each cut gives up

- **Saved folds as digests (`TF1`).**
  - Gives up: reading a saved fold's text, and its diff, in the pull
    request.
  - Still covered by: `--show`, and `records/`, which pins every field
    the fold feeds.
- **Figures per document (`TF2`).**
  - Gives up: nothing; the 187 files removed are copies.
  - Still covered by: every case compared with its document.
- **Figures sparse (`TF2`).**
  - Gives up: seeing in the text that a key is `null` rather than
    absent.
  - Still covered by: the key-set check.
- **`rows/` as spans alone (`TF3`).**
  - Gives up: the escape codes of every row.
  - Still covered by: `formatting/spans.json`, and one joined case per
    kind.
- **`rows/`'s second profile a sample (`TF3`).**
  - Gives up: `iterm` and `tmux` at 200, 120 and 80 columns and under
    each hide set.
  - Still covered by: 155 columns in both phases; a padded icon is a
    cell's, not a width's.
- **Goldens and whole-line renderers (`TF4`).**
  - Gives up: the three-row status line and the `systemMessage` receipt
    at every width.
  - Still covered by: nothing, since no entry draws them after `OP5`.
- **`panel/`'s groups (`TF5`).**
  - Gives up: the panel at 16 widths, under `--hide`, and per terminal
    and switch.
  - Still covered by: `grid/` for widths and hiding, `rows/`'s tree
    cases for the cells.
- **Differential cases written once (`TF6`).**
  - Gives up: nothing for the merged configurations; `calib/` loses
    each turn's shares under the extra snapshots, units and zones.
  - Still covered by: each turn's shares under one, the totals under
    all.
- **`grid/` on fewer widths (`TF7`).**
  - Gives up: 240 and 200 columns, which reach no layout or label rule
    that 300 and 160 do not.
  - Still covered by: every distinct layout and label rule, at the
    widths kept.
- **`grid/` as spans, its second profile a sample (`TF7`).**
  - Gives up: the escape codes of every drawn row, and `iterm` and
    `tmux` drawn at every width.
  - Still covered by: `formatting/spans.json` and one joined case per
    file; the layouts a profile moves, drawn, and 300 columns drawn
    under every hide set.

After `OP5` the ports' agreement is kept exactly where two ports remain:
`config/`, `sources/`, `formatting/` and `fold-saves.json` if the Python
still writes a fold; elsewhere the TypeScript's own cases, with a rerun
check, replace it.

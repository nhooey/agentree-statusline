# Development

The project is one Claude Code mod, `usage-band`, in TypeScript under
`mod/`; [its README](../mod/README.md) says how it is loaded and how its
hooks reach Claude Code. Node 23.6 or later runs its sources directly, with
no build, for the tests and the tools. The only Python is under `tools/`:
`usage-dev.py`, the dev shell's command tool, and two review scripts;
nothing builds or tests the mod with them.

## How the code is laid out

```
mod/
  hooks/       the mod's hooks: register.tsx, and what reads files, the
               transcript, the usage source and the configuration through
               the engine's `$`
  src/         the pure modules the hooks import, and their *_node.ts
               readers for the tests and tools
  defaults/    config.jsonc, every option's default
  test/        node --test suites, against tests/fixtures
  mod-tests/   the hooks' own suites, run in the engine (npm run test:plugin)
  tools/       the generators of committed cases and of docs/options.md's
               option table, and drawing and timing tools
tools/         usage-dev.py, diff-grid-fixtures.py, palette-review.py,
               stress-suites.sh
tests/         all.sh, usage-dev.py, probe-advance.sh, the committed
               fixtures
```

| module | owns |
|---|---|
| `claude_records.ts` | Claude Code's JSONL: payload fields, request deduplication, per-model prices, turns, tool spans, agent files. No terminal output. |
| `claude_calib.ts` | The plan-window shares and their calibration from the window scan. |
| `claude.ts`, `figures.ts` | A readout's figures, worked out from what was read, as a figures document. |
| `band.ts`, `band_tree.ts`, `agent_row.ts`, `receipt.ts`, `cells.ts` | The band's rows and tree, each agent's row, the receipt and the tag lines, built from a figures document out of the cells, which `cells.ts` draws. |
| `grid.ts` | The grid every row is laid out on: the columns kept, hidden and closed up, and each label's room. |
| `main_fold.ts`, `agent_fold.ts`, `inbox_fold.ts` | The transcript's, each agent's and the inbox's folds, read on from where the last read stopped, and their saves. |
| `sources.ts`, `claude_sources.ts`, `credits.ts` | The usage source: the version-1 reading, the payload's own windows, the scoped cache, the custom command, the tracker, and the credits' conditions. See [Usage sources](usage-sources.md). |
| `config.ts` | The configuration files: the walk, the strict defaults file, the merge and its warnings. See [Options](options.md#configuration-files). |
| `formatting.ts`, `spans.ts` | The `S_*` glyph forms and widths, the fixed-width number formats, the dim and tier rules, and `Span`, a run of text with a colour named by its `F_*` constant, joined into escape codes once, where a line is drawn. |
| `state.ts` | Each file the mod keeps in the state directory, named from `mod/src/state_spec.ts`. |

The comments in the code are dense on purpose. These documents cover what is
worth knowing before you open a file; a detail that matters only at one line
— a single field's width, one function's failure mode — lives in the comment
at that line and is not repeated here.

## Boundaries

These hold across the mod.

- **`src/` is pure.** Its modules take what was read and return values; they
  read no file, call no source, touch no cache and read no clock of their
  own. The hooks do the reading through the engine's `$`, and the
  `src/*_node.ts` readers do it for the tests and tools.
- **One reading per document.** A figures document is built from one
  reading of the usage source, so no two figures on it can disagree about
  the reading.
- **Missing is not zero.** An absent metric, token category or quota window
  stays absent and renders blank or `?`. It is never printed as `0`.
- **Display switches are a value.** The terminal profile, the mark spacing
  and the subscript switch are one immutable `Settings`
  (`mod/src/formatting.ts`), built once where a row is drawn and passed to
  everything that measures.
- **Quota buckets keep their shape.** A reading is a set of named buckets,
  each with its own windows. A bucket that is not the default one is not
  squeezed into the 5-hour/weekly pair; it keeps its identity through the
  cache, diagnostics and the generic account output.
- **Estimates stay labelled as estimates.** Claude's turn, session and agent
  shares of a plan window are calibrated estimates (see
  [Accounting](accounting.md)).

## Where to make a change

| change | where | then |
|---|---|---|
| A cell on the mod's rows or its receipt | `mod/src/cells.ts`, and the row builders in `mod/src/band.ts` and `mod/src/receipt.ts` | Regenerate the row cases (`usage-dev row-cases`) and read the diff; `usage-dev figures` draws a figures document to look at; update [Layout](layout.md). |
| A subagent row's state, label or cells | `mod/src/agent_row.ts`, and the cell itself in `mod/src/cells.ts` | Regenerate the row cases and read the diff. |
| A glyph, colour, width or cut | Its constant in `mod/src/spec.ts`; a colour's true value in its `TRUE_COLOURS` | The node suite's `spec.test.ts` holds the colours to the palette. For a glyph, follow [Glyphs and terminals](glyphs-and-terminals.md) and run `usage-dev probe-advance` in a real terminal. For a colour, pick a palette entry; see [Under tmux](layout.md#under-tmux). |
| An option | Its record in `mod/src/options_spec.ts`, its field in `Options` there and its default in `mod/defaults/config.jsonc`, then `usage-dev option-docs`; read it from `Options` | Regenerate the configuration cases (`usage-dev fixtures`) and read the diff; update [Options](options.md). |
| Claude accounting (prices, turns, agents) | `mod/src/claude_records.ts`; window shares and calibration in `mod/src/claude_calib.ts` | The node suite; update [Accounting](accounting.md). |
| A saved fold's text | `mod/src/main_fold.ts`, `agent_fold.ts` or `inbox_fold.ts`, and its format in `mod/src/state_spec.ts` | Run `usage-dev fixtures`; `node mod/tools/gen-fold-saves.ts --show PATH` prints a fixture's saves, to read the change by running it before and after. |
| A usage source | `mod/src/sources.ts`, and `validateSource` for its spec | `mod/test/sources.test.ts`; update [Usage sources](usage-sources.md). |

## Verifying a change

[Tests](tests.md) lists every suite and what it covers. The short version:

```sh
tests          # every suite, side by side
tests node     # the mod's tests alone
```

CI runs the node suite, the type check, the option table's check,
usage-dev's own suite and the shell scripts' lint.

A layout change is supposed to fail the row and grid cases. Regenerate them
(`usage-dev row-cases`, `usage-dev grid-cases`) and commit the new files
only if every change is one you meant. The grid fixtures are too long to
read whole; `usage-dev diff-grid` counts the changed cases and prints the
first few.

Glyph widths cannot be checked in CI: they depend on the terminal drawing
them. `usage-dev probe-advance` needs a real terminal tab.

## Style

- Prefer pure functions over immutable records and prepared snapshots.
- Name glyphs as `E_*` constants in `mod/src/spec.ts` and use the constant.
  The probe finds glyphs by that prefix; a literal elsewhere is invisible to
  it.
- A fixed-width field carries a unit (`1.2k`, `4.5M`, `1.5h`), never more
  digits. See [Layout](layout.md).
- Explain a non-obvious choice in a comment at the line that makes it, with
  the evidence (a measurement, a failing case). Keep history in commit
  messages, not in comments or docs.

## Open issues

**Glyph widths not yet measured in a real terminal.** Each needs a run of
`tests/probe-advance.sh` in Ghostty and in iTerm2, with the result recorded
in [Glyphs and terminals](glyphs-and-terminals.md).

- The subagent-row kind marks, `E_KIND_*`: 🔩 🎩 🔍 📐 📚 📟 🍴 👥 🐚 🔗 🌐
  🎎. They are `E_*` constants, so the next probe run covers them. A wrong
  width here shifts one subagent row.
- The agent-row state marks and 👶🏻, `E_PHASE_*`, `E_MODE_*` and `E_KIDS`:
  🟢 🟡 ⚫, 💤 💻 📡 📋 🥚 ✅ ❌ 🛑 and 👶🏻. They are `E_*` constants, so the next
  probe run covers them. 🟢 and 🟡 are Unicode 12, newer than any other glyph
  on either readout. 👶🏻 is a base and a skin-tone modifier, two codepoints:
  two columns where the terminal folds clusters and four where it does not,
  which `visWidth` already counts; an unprobed terminal that folds them is
  off by two.
- 🛫 `E_RATE` and the superscript digits `E_SUP_DIGITS` (the `⁵` in `O⁵`).
  Both are `E_*` constants, so the next probe run covers them. ¹ ² ³ ⁴ are
  East Asian Width Ambiguous; ⁴ appears on every Haiku 4.x row. A two-column
  ⁴ would push the effort glyph one column into the gap after it.

**Terminal profiles not measured.**

- Bare Ghostty (outside tmux) gets the `unknown` profile, without the icon
  padding `_PAD` gives `iterm` and `tmux`. The redesign's alignment test
  looked right there by eye: every row's columns met and the band ended
  before `[-]`. `tests/probe-advance.sh` has not been run there.

## Direction

Intentions, not designs:

1. More usage sources, behind the same boundaries.
2. A terminal diagnostic tool, in its own repository: drive each terminal and
   multiplexer combination and record which glyphs each one draws at which
   width. `tests/probe-advance.sh` is its seed.
3. A terminal output filter in the same repository, so a program need not
   carry per-terminal width knowledge itself.

Until (3) exists, the width tables, terminal profiles and glyph rules stay in
`mod/src/spec.ts`. They are the first thing to move out when it does.

`mod/src/spec.ts` is where the glyphs, colours, widths and cuts are written,
each beside the comment that explains it, and `mod/test/spec.test.ts` holds
the colours to what a terminal draws. What is computed from the constants,
the `S_*` forms and the widths, is in `mod/src/formatting.ts`.

`mod/src/options_spec.ts` holds every option's record, its type and its
documentation; `usage-dev option-docs` (`mod/tools/gen-option-docs.ts`)
writes the option table of [Options](options.md) from it, and the `generated` suite fails while the
table is out of date.

`mod/src/state_spec.ts` names each file the mod keeps in the state directory, with the format number its
name is keyed by, which `statePath` (`mod/src/state.ts`) builds. Bump a
kind's format when what is written in it changes.

`mod/tools/layout-mockup.ts` draws the [redesign](../agents/plans/closed/redesign.md)'s proposal inside a
mocked Claude Code screen: `usage-dev mockup --cols 150`. It
uses the mod's cell renderers on made-up figures and lays them out
with the grid, `mod/src/grid.ts`; it reads nothing but the terminal. Its
options, `--cols`, `--hide`, `--receipt`, `--phase`, `--labels`, `--grid`,
`--agents`, `--part` and `--plain`, are in its `--help`.

## License

MIT. The full text is in [`LICENSE`](../LICENSE), pasted in whole so that
licence detection (GitHub's included) recognises it.

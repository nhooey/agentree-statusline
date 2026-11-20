---
title: RF1 Nothing exported that nothing imports
state: proposed
kind: implementation
part-of: refactor
touches: [mod/src, mod/hooks]
cost: 1.5M tokens, $1.50, 0.15% of the weekly limit
---

# RF1 Nothing exported that nothing imports

## Now

Measured by word search of each `export`ed name across the repository.

**Used nowhere** but in comments, all in `spec.ts`:

| Name | Why it is still there |
| --- | --- |
| `E_TREE_NODE`, `E_TREE_OPEN`, `E_TREE_END` | the glyphs of Claude Code's own panel, which `probe-advance.sh` measures because they are `E_*` constants ([glyphs and terminals](../../../../docs/glyphs-and-terminals.md)); `grid.ts` draws `◯` inline where it could name `E_TREE_NODE` |
| `E_HUMAN`, `E_BOT`, `E_READ`, `E_WRITE`, `E_COSTLINE`, `E_ROW_PROMPT`, `E_ROW_TOTAL`, `E_ROW_AGENTS` | `probe-advance.sh` measures every `E_*` constant; each glyph is drawn under another name, or not at all |
| `LIM_PCT_W`, `LIM_FIG_W`, `LIM_ACCT_W`, `SHARE_FIG_W` | other constants' comments explain their widths by these |
| `C_CHROME_CONT` | `band.ts`'s `indented` names it for the indent it matches |

**Used only in their own file:** many exports, to be counted when this
starts, most in `claude_records.ts`, `spec.ts`, `config.ts`,
`sources.ts`, `band.ts` and `hooks/plan_usage.ts`. Some are exported for
a test and are read there; the rest are exported for nothing.

## Target

- Each used-nowhere name above removed, or used where its glyph or width
  is drawn, with the comments that cite it reworded.
- Each own-file-only export un-exported, unless a test imports it.
- A `usage-dev` command, `usage-dev exports`, that lists both kinds, run
  by `tests` so a new one fails the suite.

## Checks

`typecheck`; `tests` with fixtures unchanged. `spec.ts`'s names are
checked against the lookups by name before any goes: `spans.ts` reads
the `F_*` colours by name (`spec.TRUE_COLOURS[name]`), and
`probe-advance.sh` every exported `E_*` glyph, so neither has an import.

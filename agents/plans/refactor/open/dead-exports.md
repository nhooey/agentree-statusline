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

Measured on `master` by word search of each `export`ed name across
`mod/src`, `mod/hooks`, `mod/tools`, `mod/test` and `mod/mod-tests`.

**Used nowhere** (only the declaration):

| Name | Where |
| --- | --- |
| `readTurnsSettled` | `claude_records_node.ts:443` |
| `P_IN` | `claude_records.ts:178` |
| `renderState` | `claude_subagent_render.ts:251` (`agent_row.ts` after `UX20`) |
| `configNow` | `hooks/configuration.ts:139` |
| `E_SUM`, `W_MOD`, `E_TREE_NODE`, `E_TREE_OPEN`, `E_TREE_END`, `HIDE_GROUPS` | `spec.ts` |

**Used only in their own file:** 221 exports, most in
`claude_records.ts` (53), `claude_subagent_render.ts` (31), `spec.ts`
(18), `config.ts` (15), `sources.ts` (14), `band.ts` (11) and
`hooks/plan_usage.ts` (10). Some are exported for a test and are read
there; the rest are exported for nothing.

## Target

- The used-nowhere names removed, with what only they reach
  (`readTurnsSettled` takes `SETTLE_S`, `SETTLE_POLL_S` and `_settled`
  with it where nothing else reads them).
- Each own-file-only export un-exported, unless a test imports it.
- A `usage-dev` command, `usage-dev exports`, that lists both kinds, run
  by `tests` so a new one fails the suite.

## Checks

`typecheck`; `tests` with fixtures unchanged. `spec.ts`'s names are
checked against `spans.ts`'s lookups by name (`spec.TRUE_COLOURS[name]`,
`:271`) before any goes: a colour read by its name has no import.

## Waits for

`TF4`, which deletes `claude_render.ts`, `claude_subagent_render.ts`,
`claude_cost.ts` and `claude_cost_render.ts` and with them about 40 of
these exports; measured again after it.

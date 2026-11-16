---
title: Refactor wave 3, after the stack: agents, ETAs, the band, the py accessors
state: proposed
kind: schedule
part-of: refactor
after: [refactor-wave-2, build-schedule]
cost: 39.5M tokens, $39.50, 3.95% of the weekly limit
---

# Refactor wave 3, after the stack: agents, ETAs, the band, the py accessors

Starts once the stack is merged: `UX20` "Draw the band's cells in
cells.ts, its agent rows in agent_row.ts" (f1dd6e8), `TF4` "Remove the
status line, the old receipt and the panel from the mod" (396eaad), the
stacked light column (46c65f6) and `TF5`/`TF6` (31be4eb, 748fa7e). Of
the [integrated schedule](../../open/build-schedule.md) it waits only
for those, not for the rest; and after wave 2, since RF3 types what
`register.tsx` reads.

| Order | Node | Size | Tokens | Dollars | Runs beside |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | [RF1 Dead and over-wide exports](dead-exports.md) | S | 1.5M | $1.50 | — |
| 2 | [RF3 Typed agent tasks and document](typed-documents.md) | L | 8M | $8 | — |
| 3 | [SM1 A subagent's status](agent-status.md) | M | 5M | $5 | — |
| 4 | [SM1b A parked agent keeps its fold](parked-folds.md) | S | 1M | $1 | 5 |
| 5 | [SM9 What a thread is doing](thread-mode.md) | S | 2M | $2 | 4 |
| 6 | [SM8 An ETA's reading](eta-reading.md) | M | 3M | $3 | — |
| 7 | [RF7 The band's modules](band-boundaries.md) | M | 4M | $4 | — |
| 8 | [RF6 Records decoded once](py-accessors.md) | L | 15M | $15 | — |

- RF1 first: it is measured again after `TF4`, and clears what later
  nodes would otherwise type.
- SM1b changes behaviour; the rest go on without it.
- RF6 is about eight PRs, one module each, smallest first, and can start
  on the modules RF3 and RF7 do not touch (`credits.ts`, `spending.ts`,
  `claude_sources.ts`, `sources.ts`) as soon as RF2 and RF4 are in.

Costs as in [wave 1](refactor-wave-1.md#costs).

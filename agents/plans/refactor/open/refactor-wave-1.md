---
title: Refactor wave 1, once the stack merges: visibility, fetches, folds, records
state: proposed
kind: schedule
part-of: refactor
cost: 22M tokens, $22, 2.2% of the weekly limit
---

# Refactor wave 1, once the stack merges: visibility, fetches, folds, records

It starts once the open stack (#100, #124 to #132) has merged, so no
node rebases against it. Its nodes leave alone what "Pack receipts in the
mod's store" changes. One node, one PR, one agent; at most three at once, never two
in the same file.

| Order | Node | Size | Tokens | Dollars | Runs beside |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | [SM7 When a row is drawn](row-visibility.md) | S | 1.5M | $1.50 | 2, 3 |
| 2 | [SM10 The session's credential](credential-kind.md) | S | 1M | $1 | 1, 3 |
| 3 | [RF2 Output-defining helpers named](py-output-helpers.md) | S | 2M | $2 | 1, 2 |
| 4 | [SM6 A reading fetched with backoff](fetch-backoff.md) | M | 3M | $3 | 5 |
| 5 | [SM5 A fold read on from its save](fold-resume.md) | M | 4M | $4 | 4 |
| 6 | [RF4 `claude_records.ts` split](split-claude-records.md) | M | 4M | $4 | 7 |
| 7 | [SM11 Single flights and caches](single-flight.md) | S | 2.5M | $2.50 | 6 |
| 8 | [SM2 The fold states as records](fold-tuples.md) | M | 4M | $4 | — |

- RF2 before RF4: both touch `claude_records.ts`, and RF4's moves are
  easier to review with the renames already in.
- RF4 before SM2 (`needs`): SM2 edits `records/eta.ts` and
  `records/turns.ts`.
- SM6 before SM11: both touch `plan_usage.ts` and `usage.ts`, and SM11's
  single flights wrap SM6's asks.
- SM11 before wave 2: it changes `refresh` in `register.tsx`, which RF5
  moves.

Every PR's acceptance test is `tests` passing with `generated` finding
the tree clean, and `typecheck`.

## Costs

Tokens per node are estimates from the size of the change and the files
to be read. Dollars at about $1 per million tokens: Claude Opus 5.5's
$4 in, $20 out and $0.20 per million cache reads, for an agent run that
is about nine-tenths cache reads. The weekly-limit share assumes a weekly
limit worth $1,000 of API use, which is not recorded anywhere in the
project: the user sets it.

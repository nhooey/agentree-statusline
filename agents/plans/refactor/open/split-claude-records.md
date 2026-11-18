---
title: RF4 claude_records.ts split along its own sections
state: proposed
kind: implementation
part-of: refactor
touches: [mod/src/claude_records.ts, mod/src/records]
cost: 4M tokens, $4, 0.4% of the weekly limit
---

# RF4 claude_records.ts split along its own sections

## Now

`claude_records.ts` is 3,088 lines, a quarter of `mod/src`, and already
marks its seams with section rules:

| Section | Lines | Becomes |
| --- | ---: | --- |
| Python's semantics, prices | 42–204 | `exact.ts` (RF2), `records/prices.ts` |
| Records, payload, transcript reading | 205–682 | `records/read.ts` |
| Tool spans and clocks | 683–1158 | `records/spans.ts` |
| ETA reports | 1159–1327 | `records/eta.ts` |
| Turn boundaries | 1328–1650 | `records/turns.ts` |
| Agent files | 1651–1991 | `records/agents.ts` |
| The inbox | 1992–2125 | `records/inbox.ts` |
| The status line's pass | 2126–2640 | `records/transcript_fold.ts` |
| The cost line's turns | 2641–3088 | `records/turns_fold.ts` |

## Target

The sections as modules under `mod/src/records/`, each importing only
what it reads; `claude_records.ts` re-exports them for one PR, and the
importers move to the new modules in the next, after which it goes.

Moves only: no line inside a function changes.

## Checks

`typecheck`; `tests` with fixtures unchanged; `git diff --stat -M` shows
the moves as renames where git can see them.

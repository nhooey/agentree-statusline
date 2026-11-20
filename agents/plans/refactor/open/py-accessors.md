---
title: RF6 Records decoded once, and the py accessors gone
state: proposed
kind: implementation
part-of: refactor
needs: [typed-documents, split-claude-records]
touches: [mod/src, mod/hooks]
cost: 15M tokens, $15, 1.5% of the weekly limit
---

# RF6 Records decoded once, and the py accessors gone

## Now

The ported code reads every record and document through accessors that
copy Python's dictionary and truthiness rules. Counted over `mod/src`,
`mod/hooks` and `mod/tools`:

| Accessor | Calls | Files |
| --- | ---: | ---: |
| `pyGet` | 410 | 12 |
| `pyTruthy` | 109 | 8 |
| `pyOr` | 83 | 4 |
| `pyStr` | 49 | — |
| `pyStrip` | 37 | 6 |
| `pyDig` | 33 | 1 |
| `pyLen`, `pySlice`, `pyRstrip`, `pyHas`, `pyIsDigit`, … | ~110 | — |

`pyGet(r, "type")` on a `Rec` (`{ [k: string]: unknown }`) is
`r.type`; `pyOr(a, b)` is `a || b` with Python's falsy set (empty arrays
and objects too); `pyTruthy` is that test alone. Each call site so reads
the record's shape anew, and the type checker sees `unknown` throughout.

## Target

- Records are decoded at the edge of each reader (`turnStartText`,
  `isWork`, `etaReport`, `scanToolSpans`, …) into small typed views
  (`UserRec`, `AssistantRec`, `SystemRec`, `ToolUse`, `ToolResult`), with
  the coercions the accessors did made explicit once, in the decoder.
- `pyGet`, `pyOr`, `pyTruthy`, `pyDig`, `pyHas` are deleted; `pyLen`,
  `pySlice`, `pyStrip` and the rest become the `exact.ts` helpers
  where code-point or `isspace` semantics change the bytes, and plain
  string methods where they do not.

## How

One PR per module, smallest first, each byte-identical:
`credits.ts`, `spending.ts`, `subagent_tasks.ts`, `agent_message.ts`,
`claude_sources.ts`, `sources.ts`, then `records/*` one at a time
(after RF4). Where a `pyOr` rests on an empty list being false, the
decoder says so, with a test row.

## Checks

Each PR: `tests` with fixtures unchanged; `typecheck`; the module's
count of `py*` calls goes to zero. Last PR: `rg 'pyGet|pyOr|pyTruthy|
pyDig' mod/` finds nothing.

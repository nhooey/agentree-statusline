---
title: SM7 When a row is drawn, one function of live, place and phase
state: proposed
kind: implementation
part-of: refactor
touches: [mod/src/band.ts, mod/src/options_spec.ts, mod/hooks/register.tsx, mod/test/rows.test.ts]
cost: 1.5M tokens, $1.50, 0.15% of the weekly limit
---

# SM7 When a row is drawn, one function of live, place and phase

## Now

`rows.<row>.live` is `never | running | always`; the band's phase is
`running | done`, computed as `isWorking || held`
(`register.tsx:833`, `:1168`). Whether a row is drawn is

| live \\ phase | running | done |
| --- | --- | --- |
| never | ❌ | ❌ |
| running | ✅ | ❌ |
| always | ✅ | ✅ |

and that table is written out five times:

- `band.ts:569`: the tree's subagents (`opts.agents`).
- `band.ts:604`: `rootDrawn`, which takes `place` and `live` as
  `unknown`.
- `band.ts:646`: `phaseRows`, with the "running" and "footer" defaults
  written inline.
- `register.tsx:858`: `accountedIn`, for 💳.
- `register.tsx:849`: `rootedIn`, through `rootDrawn`.

`Live` is declared in `band.ts:106` and again, as a literal union, six
times in `options_spec.ts:241`–`:266`.

## Target

- `drawnIn(live: Live, phase: Phase): boolean`, in `band.ts`, the one
  copy of the table; `placedIn(places, row, place)` with the "footer"
  default.
- `Live` and `Place` declared once, in `options_spec.ts`, and imported by
  `band.ts`; `rootDrawn` typed.

## Tests

A three-by-two table test of `drawnIn`. `rows.test.ts` and
`band.test.ts` pass unchanged.

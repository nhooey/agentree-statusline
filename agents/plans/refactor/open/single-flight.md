---
title: SM11 Single flights and stamped caches, each written once
state: proposed
kind: implementation
part-of: refactor
touches: [mod/hooks/register.tsx, mod/hooks/senders.ts, mod/hooks/configuration.ts, mod/hooks/calibration.ts, mod/hooks/engine.ts, mod/hooks/inbox.ts, mod/hooks/flight.ts]
cost: 2.5M tokens, $2.50, 0.25% of the weekly limit
---

# SM11 Single flights and stamped caches, each written once

## Now

**Single flights.** An ask that runs once at a time, a second caller
waiting on it or asking for one more after it, is hand-made six times:

| Where | State |
| --- | --- |
| `register.tsx:233` `refresh` | `refreshing` promise, `again` flag |
| `senders.ts:25` `agentsNow` | `agentList`, `agentListAt`, `agentListing` |
| `configuration.ts:134` | `configReading` promise |
| `plan_usage.ts:78` | `plan.asking` |
| `usage.ts:231` | `creditsAsking` |
| `calibration.ts:34` | `scanning` |

Each is idle → asking → idle (→ asking again where a call came in
meanwhile), with the flag and the promise able to disagree.

**Caches keyed by a file's stamp.** `size + ':' + mtimeMs` is built at
`engine.ts:180`, `inbox.ts:136` and `calibration.ts:251`;
`engine.ts:165` `keep` is the one bounded cache (LRU); `githubKept`
(`edges.ts:204`), `pricedKept` (`calibration.ts:242`) and `foldSaved`
(`transcripts.ts:496`) grow for the life of the load.

## Target

- `hooks/flight.ts`: `singleFlight(fn)` (join the ask out) and
  `coalesce(fn)` (join, and run once more after it); the six sites use
  them.
- `fileStamp(stat)` and `keep` used by every stamped cache; the unbounded
  maps bounded by `keep` where an entry can go stale (a decision for
  `githubKept`, which is per repository root and small).

## Tests

A table for `coalesce`: idle, one call, a call during, two calls during.
`band.test.ts`'s refresh and agent-list cases pass unchanged.

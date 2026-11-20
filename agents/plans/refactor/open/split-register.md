---
title: RF5 register.tsx as the event table, its parts in their own modules
state: proposed
kind: implementation
part-of: refactor
touches: [plugin/hooks/register.tsx, plugin/hooks/session.ts, plugin/hooks/receipts.ts, plugin/hooks/draw.tsx]
cost: 4M tokens, $4, 0.4% of the weekly limit
---

# RF5 register.tsx as the event table, its parts in their own modules

## Now

`hooks/register.tsx` is 1,289 lines: module state, the refresh loop, the
receipt's stamping, the drawing primitives and 15 `on(...)` handlers.

| Part | Lines | Becomes |
| --- | --- | --- |
| Settings, options' views (`settingsOf`, `liveOf`, …) | 95–165 | `session.ts` |
| Refresh, tick, clock, start, forget | 187–441 | `session.ts` |
| Store index (`remember`), mode notes | 442–488 | `session.ts` |
| Receipts: keys, `underAnswer`, `stamp`, `stampMissed` | 489–676 | `receipts.ts` |
| Drawing: `line`, `spanStyle`, `partsOf`, `runsOf`, presses | 677–822 | `draw.tsx` |
| `bandNow`, `rootedIn`, `accountedIn`, `home` | 823–866 | `draw.tsx` |
| The handlers | 867–1289 | stay |

## Target

`register.tsx` holds the handlers and nothing else, each a few lines
calling into the three modules; the module state they share is owned by
`session.ts` and read through functions.

Moves only.

## Checks

`typecheck`; `tests`, the `band.test.ts` engine cases and the plugin
test (`plugin/tools/plugin-test.sh`) pass unchanged.

## Waits for

"Pack receipts in the plugin's store and keep fewer of them" (branch
`store-receipts-compact`), which rewrites `remember` and the receipt's
keys in this file.

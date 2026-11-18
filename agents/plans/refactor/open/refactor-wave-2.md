---
title: Refactor wave 2, after the receipts are packed: register.tsx and its machines
state: proposed
kind: schedule
part-of: refactor
after: [refactor-wave-1]
cost: 11M tokens, $11, 1.1% of the weekly limit
---

# Refactor wave 2, after the receipts are packed: register.tsx and its machines

Starts once "Pack receipts in the mod's store and keep fewer of them"
(branch `store-receipts-compact`, 2b310ff) is merged, and after wave 1,
whose SM11 changes `refresh`.

| Order | Node | Size | Tokens | Dollars | Runs beside |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | [RF5 `register.tsx` split](split-register.md) | M | 4M | $4 | — |
| 2 | [SM3 The main thread's turn](turn-life.md) | M | 4M | $4 | 3 |
| 3 | [SM4 A turn's receipt](receipt-stamping.md) | M | 3M | $3 | 2 |

RF5 is moves only and lands alone; SM3 (`session.ts`, `turn_life.ts`)
and SM4 (`receipts.ts`, `receipt.ts`) then touch different files.

Costs as in [wave 1](refactor-wave-1.md#costs).

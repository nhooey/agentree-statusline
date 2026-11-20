---
title: SM10 The session's credential as one kind
state: proposed
kind: implementation
part-of: refactor
touches: [plugin/src/spending.ts, plugin/hooks/edges.ts, plugin/test/spending.test.ts]
cost: 1M tokens, $1, 0.1% of the weekly limit
---

# SM10 The session's credential as one kind

## Now

`Credential` (`spending.ts:44`) is three booleans, `remote`, `apiKey`
and `elsewhere`: eight combinations for four kinds. `payerOf`
(`spending.ts:66`) resolves them by the order it tests them in
(`elsewhere`, then `remote`, then `apiKey`, else the plan), and
`hooks/edges.ts` builds the triple from the environment.

The payer's spell beside it (`nextSpell`, `spending.ts:103`) is already
a pure transition over a readonly record, tested as cases in
`spending.test.ts`: the shape the other machines in this plan take.

## Target

`type Credential = "elsewhere" | "remote" | "key" | "plan"`, decided once
in `edges.ts` in `payerOf`'s present order; `payerOf` switches on it.

## Tests

`spending.test.ts`'s payer cases, rewritten over the four kinds, give
the same payers.

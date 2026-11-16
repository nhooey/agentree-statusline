---
title: RF3 The agent tasks and the figures document typed, decoded once
state: proposed
kind: implementation
part-of: refactor
touches: [mod/src/subagent_tasks.ts, mod/src/band.ts, mod/src/band_tree.ts, mod/src/agent_row.ts, mod/src/receipt.ts, mod/hooks/register.tsx, mod/types/index.d.ts]
cost: 8M tokens, $8, 0.8% of the weekly limit
---

# RF3 The agent tasks and the figures document typed, decoded once

## Now

The figures document goes from the edge (`hooks/edges.ts`) through the
`status` atom to the band as `Dict`, and each reader casts what it reads:
67 `as Dict` in `mod/src` and `mod/hooks` (`receipt.ts` 18, `band.ts`
14, `register.tsx` 13, `sources.ts` 9), and 15 `any`. `TreeTask`
(`subagent_tasks.ts:191`) carries `task: Dict`, `usage: Dict` and
`meta: Dict`, built by `taskOf` (`:207`) with known fields, then read
back through `ua`, `strOr` and `pyGet` with defaults at every use.
`decodeTranscript` and `decodeLimits` (`band.ts`) already decode two
parts of the document; the rest are read raw.

## Target

- `Task`, `AgentUsage` and `AgentMeta` as readonly types, made by
  `taskOf` and `agentUsageOf`; `TreeTask` holds them.
- `FiguresDoc` (`mod/types/index.d.ts`) spelt out to the parts the band reads,
  decoded once in `bandRows` / `treeInput` with the decoders that exist
  joined by `decodeAgents` and `decodeAccounting`.
- The document's JSON is unchanged: the types describe it, they do not
  reshape it.

## Checks

`typecheck`; `tests` with every fixture unchanged.

## Waits for

`UX20` and `TF4`: the readers it types are the ones left after them, in
`cells.ts`, `agent_row.ts` and `band_tree.ts`.

---
title: SM1b A parked agent keeps its fold and its group clock
state: proposed
kind: implementation
part-of: refactor
needs: [agent-status]
touches: [mod/src/band_tree.ts, mod/test/band_tree.test.ts]
cost: 1M tokens, $1, 0.1% of the weekly limit
---

# SM1b A parked agent keeps its fold and its group clock

Changes behaviour: both disagreements are bugs, and this node fixes them.

Once SM1 names the predicates, two of them disagree with the phase the
row is drawn in:

- **`foldKept`**, today `pruneFolds`'s `ENDED` (`band_tree.ts:162`):
  drops the fold of every `completed` agent, parked or not. It becomes
  `phase.kind !== "ended"`, so a parked agent's ⊞ stays folded.
- **`clockRuns` in a group row**, today `running || waiting`
  (`band_tree.ts:751`): becomes the agent row's own, `running || parked`
  (`claude_subagent_render.ts:699`), so `… N more` and `done` sum the
  same ⌛ their rows show.

## Checks

- A `band_tree.test.ts` case: a `completed` agent with ETA left and a
  folded row keeps `folds[id] === true` through `pruneFolds`.
- The tree cases whose group holds a parked agent change their ⌛; no
  other fixture changes. The PR lists each changed case.

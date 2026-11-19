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

Changes behaviour: the disagreement left is a bug, and this node fixes
it.

Once SM1 names the predicates, each must agree with the phase the row is
drawn in:

- **`foldKept`** already agrees: `pruneFolds` keeps the fold of every
  agent the tree draws (`drawnAgents`, over the placement `forestOf`
  shares with the drawing), so a parked agent's ⊞ stays folded.
  `band_tree.test.ts` covers it.
- **`clockRuns` in a group row**, today `running || waiting`
  (`band_tree.ts:751`): becomes the agent row's own, `running || parked`
  (`claude_subagent_render.ts:699`), so `… N more` and `done` sum the
  same ⌛ their rows show.

## Checks

- The tree cases whose group holds a parked agent change their ⌛; no
  other fixture changes. The PR lists each changed case.

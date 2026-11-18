---
title: RF7 The band's modules, each one job
state: proposed
kind: implementation
part-of: refactor
needs: [agent-status, eta-reading]
touches: [mod/src/band.ts, mod/src/band_tree.ts, mod/src/cells.ts, mod/src/agent_row.ts]
cost: 4M tokens, $4, 0.4% of the weekly limit
---

# RF7 The band's modules, each one job

## After the stack

Once `UX20` and the stacked light column (branch
`tree-light-column-stacked`, 46c65f6) land, the band is drawn by four
modules:

- `cells.ts`: each cell's drawing and width (`CELLS`).
- `agent_row.ts`: an agent row's state, cells and label, and the tree's
  shape.
- `band_tree.ts` (772 lines on `master`): the tree's nodes, folds,
  grouped rows, workspace links.
- `band.ts` (905 lines): the four rows, the account line, the document
  decoders, `treeInput`.

Measured on `master`, the seams cross:

- `groupNode` (`band_tree.ts:702`–`:770`) sums its tasks' usage and
  draws the sums through the agent cell renderers itself, a second agent
  row builder beside `agentCells`.
- `band.ts`'s `treeInput` (`:563`) decides the tree's phases
  (`mainPhase`, `turnPhase`) that SM9 moves into the thread mode.
- `band_tree.ts:457` `ended` and `:162` `ENDED` are agent-state rules
  (SM1) kept in the tree.

## Target

- `agent_row.ts` builds every agent-shaped row, a group's sum included
  (`groupRow(tasks)` beside `agentRow(task)`).
- `band_tree.ts` holds the tree only: shape, folds, the lines, links.
- `band.ts` holds the four rows and the document decoders (RF3).

Moves and one extraction; output unchanged.

## Checks

`band_tree.test.ts`, `rows.test.ts`, the row and tree cases unchanged.

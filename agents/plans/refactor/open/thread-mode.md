---
title: SM9 What a thread is doing, one mode for the main thread and its agents
state: proposed
kind: implementation
part-of: refactor
needs: [agent-status]
touches: [mod/src/claude_records.ts, mod/src/cells.ts, mod/src/band.ts, mod/src/agent_row.ts]
cost: 2M tokens, $2, 0.2% of the weekly limit
---

# SM9 What a thread is doing, one mode for the main thread and its agents

Changes behaviour: the main thread ranks a wait before a tool call, as
agents do.

## Now

The main thread's mode is three stamps on `Transcript`, each 0 for none
(`claude_records.ts:276`–`:278`): `tool_at`, `wait_at`, `idle_at`, with
`last_seen` behind them. Three readers rank them:

| Reader | Order |
| --- | --- |
| `mainDoing`, `claude_render.ts:76` (the 🛫 column) | tool, wait, idle, work |
| `treeInput`'s `mainPhase`, `band.ts:575` (🧵's circle) | wait → paused, else running |
| `agentState`, `claude_subagent_render.ts:220` (an agent's) | wait before tool |

So a main thread with a running Bash call and a call in `WAITING_TOOLS`
shows 🔧 in its 🛫 column and 🟡 on its circle; an agent in the same spot
shows 🚦.

## Target

- `type ThreadMode = { kind: "work"; since } | { kind: "tool"; since } |
  { kind: "wait"; since } | { kind: "idle"; since } | { kind: "none" }`,
  read off the fold by one `threadMode(...)` for the main thread and one
  for an agent, both returning the union; the `*_at` fields stay in the
  figures document as they are (its schema is unchanged).
- Each reader keeps its present order through the union.

## Tests

A table per reader: (tool, wait, idle, last seen) → mode. Row cases
unchanged, except those where a wait and a tool call are both open,
whose 🛫 cell changes; the PR lists each one.

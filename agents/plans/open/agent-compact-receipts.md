---
title: Receipts for a subagent's run and a typed /compact
state: approved
kind: end-state
---

# Receipts for a subagent's run and a typed /compact

Approved to build. Its steps are `AR1` … `AR5` in [the schedule](build-schedule.md).

## Why

The mod stamps one receipt per turn of the main thread, on the turn's
closing line. A subagent that finishes gets none: its cost reaches the
transcript only as part of the 🤖 row of the turn that ran it, and a
background agent that finishes after that turn is in no receipt until the
next one. A typed `/compact` gets none either: it opens no turn of the
main thread, and its dollars and tokens are only in 🎮. An automatic
compaction stays as it is, billed in the receipt of the turn it landed in.

## What each receipt is

**A subagent's.** One row on the receipt's grid, at `hint-inset`, dim as
the receipt's rows are:

- **Label:** 🤖 and the agent's name, its `.meta.json` description, else
  its type, as the panel names it.
- **Cells:** 🎤's, from the agent's own records: 💰 its dollars, 🧩 its
  tokens, 🎯 its cache rate, ⌛ how long it ran (`turn.complete`'s
  `durationMs`), its 🤖/🔧 split, its diff lines, and its 🪫 shares of
  the plan windows.
- **Figures:** the agent's records summed from its own file, the one
  whose `agent-<id>.jsonl` names the finished `agentId`, priced per
  record at its own model, as the panel prices them.

**A typed `/compact`'s.** One row the same way, labelled with the
compaction's own label, its cells from the fold's compaction turn,
`/compact (manual)`: 💰 and 🧩 from `preTokens` at the cache-read rate,
marked an estimate as 🎮 marks one, and ⌛ from `durationMs`.

## Where each is drawn

| What finished      | Drawn under                                                               | Keyed by                 |
| ------------------ | ------------------------------------------------------------------------- | ------------------------ |
| A subagent         | its notification's `UserMessage`: `origin` `task-notification`, `task.id` | the `agentId`            |
| A typed `/compact` | its `UserMessage`: `origin` `unclassified`, text `/compact`               | the boundary's timestamp |

Claude Code launches every Agent call in the background: its `ToolResult`
has `status` `async_launched` and an `agentId` whether or not the call asks
for the background, so every subagent ends in a task notification and none
in a `ToolResult` of its own. A `/compact` draws no `CommandOutput`.

An agent continued with SendMessage finishes again under the same
`agentId`; each run is filed under the `agentId` and its count of
finishes, and drawn under the notification of that run.

## When each is filed

- **A subagent's:** on `turn.complete` with `agentId`, once its file holds
  the agent's last request, polled as the main receipt polls, for up to
  `receiptWaitMs`. Filed once per run (`receiptKey`).
- **A `/compact`'s:** once the fold shows a new `/compact (manual)` turn,
  on the next refresh after its `compact_boundary` is written. A
  `/compact` raises no `turn.complete` of its own, and its boundary lands
  some seconds after its `UserMessage` draws.

## Options

`rows.agent-run` and `rows.compact`, each with `transcript` only, both
`true` by default, in `spec/options.jsonc`, the defaults file, both ports'
options and `docs/options.md`. The Python port reads them and draws
nothing for them: its Stop hook's receipt is the main thread's alone.

## The build order

1. **`AR1`, the trial.** Done: the mod logs, once per shape, what Claude
   Code raises when a subagent ends and when `/compact` runs, and a live
   run settled the draw sites and the event a `/compact` is filed on, as
   above. A subagent's end raises `turn.complete` with its `agentId`,
   `reason` `answer` and `durationMs`, about a second before its
   notification draws.
2. **`AR2`, a subagent's figures.** A pure function in `mod/src/receipt.ts`
   from an agent's records to its row, with row cases from fixture agent
   files.
3. **`AR3`, a subagent's receipt.** Filed on `turn.complete` with
   `agentId`; drawn under the notification; the
   options; harness tests for an agent's notification, and for an agent continued
   with SendMessage.
4. **`AR4`, the `/compact` receipt.** Filed and drawn as above, with a
   harness test.
5. **`AR5`, docs and the acceptance check, live.** `docs/layout.md`'s
   receipt section; then in a session here: two agents and a `/compact`
   each get their row where the table
   says, and turning each option off stamps none.

## Files

`mod/hooks/register.tsx` (filing and drawing), `mod/src/receipt.ts` (the
rows), `mod/hooks/transcripts.ts` (an agent's records by id),
`spec/options.jsonc` and its generated files, `mod/defaults/config.jsonc`,
`mod/mod-tests/band.test.ts`, `docs/layout.md`, `docs/options.md`.

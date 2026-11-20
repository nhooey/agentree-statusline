---
title: Refactor: typed lifecycles, one transition each, plain TypeScript
state: proposed
kind: end-state
---

# Refactor: typed lifecycles, one transition each, plain TypeScript

What is true of `mod/` when this plan is done. Every step is
behaviour-preserving unless its node says otherwise: the band, the
receipts, the saved folds and the state files are byte for byte what
they are on `master`.

- [What will be true](#what-will-be-true)
- [How it is checked](#how-it-is-checked)
- [The machines found](#the-machines-found)
- [The other targets](#the-other-targets)
- [Nodes](#nodes)

## What will be true

1. **Each lifecycle is one type.** Every entity that moves through states
   has a discriminated union naming them, so a combination the code never
   means cannot be written: no tuple read by index (`state[1]`), no
   boolean pair or zero-sentinel number standing for a state, no `status`
   read as a bare `string` out of a `Dict`.
2. **Each machine has one transition function,** `next(state, event)`,
   pure, in `mod/src/` (or a pure module beside its hook), and every
   predicate on it (live, ended, parked, drawn) is derived from that
   state, never recomputed from the raw inputs at the call site.
3. **Each machine is tested as a table** of (state, event) → state, one
   row per transition, in the suite for its module.
4. **No Python idiom where the TypeScript one is clearer.** `py.ts` holds
   only what defines bytes the mod writes or compares (`str.isspace`'s
   set, `json.dumps`'s spacing, `repr` of a float, `%.*f`), under names
   that say what they produce. Records are decoded once, at the edge, into
   typed shapes; `pyGet`, `pyOr`, `pyTruthy`, `pyDig` are gone. No comment
   explains a choice by "Python's semantics".
5. **No module over about 900 lines but `spec.ts`.** `claude_records.ts`
   and `hooks/register.tsx` are split along the seams they already mark.
6. **Nothing is exported that nothing imports.**

## How it is checked

- `tests` passes, and its last suite, `generated`, reruns every
  generator and finds the tree clean: the fixtures and goldens are
  unchanged. That is the acceptance test for every behaviour-preserving
  node.
- `typecheck` passes.
- A node that changes behaviour (marked so) changes the fixtures it names
  and nothing else.
- `rg -n 'pyGet|pyOr|pyTruthy|pyDig' mod/` finds nothing;
  `rg -n "Python" mod/src mod/hooks` finds only the names of what
  `py.ts` keeps.

## The machines found

Measured on `master` at 1ac59bc. Lines are `master`'s; the stack of
"Draw the band's cells in cells.ts, its agent rows in agent_row.ts"
(f1dd6e8, `UX20`) and "Remove the status line, the old receipt and the
panel from the mod" (396eaad, `TF4`) moves the subagent ones into
`mod/src/agent_row.ts`.

| Id | Machine | Where the states live | Main problem |
| --- | --- | --- | --- |
| `SM1` | [A subagent's status](agent-status.md) | `task.status`, a `string` in a `Dict` | "live" decided in 11 places, 5 ways |
| `SM2` | [The fold states: ETA, span, turn gate](fold-tuples.md) | `EtaState`, `SpanState`, `TurnGate` tuples | positional, mutated in place |
| `SM3` | [The main thread's turn, in the hooks](turn-life.md) | `turnRunning`, `held`, `pending`, `opened` | four variables, one state |
| `SM4` | [A turn's receipt](receipt-stamping.md) | the poll loop's locals, `stamping`, store keys | transitions inline in a 90-line loop |
| `SM5` | [A fold read on from its save](fold-resume.md) | `Folded`, `AgentFold.pos`, inbox `Kept` | piece loop 3×, slot save 2× |
| `SM6` | [A reading fetched with backoff](fetch-backoff.md) | `Kept` `{fetched_at, retry_at, failures}` | two backoffs, freshness written 4× |
| `SM7` | [When a row is drawn](row-visibility.md) | `Live` × `Phase` | the rule written 5 times |
| `SM8` | [An ETA's reading](eta-reading.md) | `number[]`, `[]` and `null` as states | signed-off computed 3 times |
| `SM9` | [What a thread is doing](thread-mode.md) | `tool_at`, `wait_at`, `idle_at`, 0 for none | main and agent rank modes apart |
| `SM10` | [The session's credential](credential-kind.md) | three booleans | eight combinations for four kinds |
| `SM11` | [Single flights and caches](single-flight.md) | module `let`s and `Map`s | five hand-made single flights |

The payer's spell (`spending.ts`, `nextSpell`) is already the target
shape: a pure transition, a readonly record, a table of tests. It is the
model the others follow, and no node changes it.

## The other targets

| Id | Target | Measure |
| --- | --- | --- |
| `RF1` | [Over-wide exports](dead-exports.md) | exports used only in their own file |
| `RF3` | [Typed agent tasks and figures document](typed-documents.md) | 67 `as Dict`; `TreeTask.task: Dict` |
| `RF4` | [`claude_records.ts` split](split-claude-records.md) | 3,088 lines, 10 sections |
| `RF5` | [`register.tsx` split](split-register.md) | 1,289 lines |
| `RF6` | [Records decoded once; the `py*` accessors gone](py-accessors.md) | ~1,100 calls of `pyGet`/`pyTruthy`/`pyOr`/`pyDig`/… |
| `RF7` | [The band's modules, each one job](band-boundaries.md) | after the stack: `cells`, `agent_row`, `band_tree`, `band` |

## Nodes

One node, one PR, one agent; at most three at once, never two in the
same file. The nodes run in three waves, in this order; a node runs
beside the ones its row names.

| Wave | Order | Node | Size | Tokens | Dollars | Runs beside |
| ---: | ---: | --- | --- | ---: | ---: | --- |
| 1 | 1 | [SM7 When a row is drawn](row-visibility.md) | S | 1.5M | $1.50 | 2 |
| 1 | 2 | [SM10 The session's credential](credential-kind.md) | S | 1M | $1 | 1 |
| 1 | 3 | [SM6 A reading fetched with backoff](fetch-backoff.md) | M | 3M | $3 | 4 |
| 1 | 4 | [SM5 A fold read on from its save](fold-resume.md) | M | 4M | $4 | 3 |
| 1 | 5 | [RF4 `claude_records.ts` split](split-claude-records.md) | M | 4M | $4 | 6 |
| 1 | 6 | [SM11 Single flights and caches](single-flight.md) | S | 2.5M | $2.50 | 5 |
| 1 | 7 | [SM2 The fold states as records](fold-tuples.md) | M | 4M | $4 | — |
| 2 | 1 | [RF5 `register.tsx` split](split-register.md) | M | 4M | $4 | — |
| 2 | 2 | [SM3 The main thread's turn](turn-life.md) | M | 4M | $4 | 3 |
| 2 | 3 | [SM4 A turn's receipt](receipt-stamping.md) | M | 3M | $3 | 2 |
| 3 | 1 | [RF1 Over-wide exports](dead-exports.md) | S | 1.5M | $1.50 | — |
| 3 | 2 | [RF3 Typed agent tasks and document](typed-documents.md) | L | 8M | $8 | — |
| 3 | 3 | [SM1 A subagent's status](agent-status.md) | M | 5M | $5 | — |
| 3 | 4 | [SM1b A parked agent keeps its fold](parked-folds.md) | S | 1M | $1 | 5 |
| 3 | 5 | [SM9 What a thread is doing](thread-mode.md) | S | 2M | $2 | 4 |
| 3 | 6 | [SM8 An ETA's reading](eta-reading.md) | M | 3M | $3 | — |
| 3 | 7 | [RF7 The band's modules](band-boundaries.md) | M | 4M | $4 | — |
| 3 | 8 | [RF6 Records decoded once](py-accessors.md) | L | 15M | $15 | — |

- **RF4 before SM2** (`needs`): SM2 edits `records/eta.ts` and
  `records/turns.ts`.
- **SM6 before SM11:** both touch `plan_usage.ts` and `usage.ts`, and
  SM11's single flights wrap SM6's asks.
- **Wave 1 before wave 2:** SM11 changes `refresh` in `register.tsx`,
  which RF5 moves.
- **RF5 alone:** it is moves only; SM3 (`session.ts`, `turn_life.ts`) and
  SM4 (`receipts.ts`, `receipt.ts`) then touch different files.
- **Wave 2 before wave 3:** RF3 types what `register.tsx` reads.
- **RF1 first in wave 3:** it clears what later nodes would otherwise
  type.
- **SM1b changes behaviour;** the rest go on without it.
- **RF6** is about eight PRs, one module each, smallest first, and can
  start on the modules RF3 and RF7 do not touch (`credits.ts`,
  `spending.ts`, `claude_sources.ts`, `sources.ts`) as soon as RF4 is in.

Every PR's acceptance test is `tests` passing with `generated` finding
the tree clean, and `typecheck`.

The plan comes to 70.5M tokens, about $70.50, 7.05% of the weekly limit.
Tokens per node are estimates from the size of the change and the files
to be read. Dollars at about $1 per million tokens: Claude Opus 5.5's
$4 in, $20 out and $0.20 per million cache reads, for an agent run that
is about nine-tenths cache reads. The weekly-limit share assumes a weekly
limit worth $1,000 of API use, which is not recorded anywhere in the
project: the user sets it.

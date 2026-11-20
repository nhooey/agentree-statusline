# Accounting

Where every figure on the readouts comes from: what is read straight from
Claude Code, what the plugin computes, and what it has to estimate.

## Where each figure comes from

The rows are those of [Layout](layout.md#the-rows): 🎮 the session, 🧵 the
main thread, 🎤 the turn, a row for each subagent, and 💳 the account; the
receipt is the turn's rows frozen as it ended.

| Figure | Rows | Source | Counts agents? |
|---|---|---|---|
| 🧩 ▴ ▾ tokens | 🎮 🎤, receipt | The transcript and every agent file beside it, deduplicated per request. ▴ is weighted input, ▾ is output. See [tokens](#tokens). | yes |
| 🧩 ▴ ▾ tokens | 🧵, subagent | That thread's own requests. | no |
| 🎯 cache rate | every row | Cache reads over all input tokens, from the same requests. | as 🧩 |
| 🛫 token rate | 🎤 | The slope of 🧩's total over samples kept between renders. | yes |
| 🧠 context | 🧵, subagent | The thread's last request's whole input over its window size. | no |
| 🧠 context | 🎤, receipt | How much the context grew or shrank during the turn. | no |
| 💰 cost | every row | List price of every request at its own model's rates. See [dollars](#dollars). | as 🧩 |
| 🔋 🪫 window shares | every row but 💳 | Estimated: cost spent inside the window, divided by a calibrated dollars-per-percent. See [plan-window shares](#plan-window-shares). | as 🧩 |
| 💳 account % | 💳, the receipt's tag | The usage source's plan reading. See [usage sources](usage-sources.md). | — |
| 🔜 reset | 💳 | The usage source's reset time for that window. | — |
| ⌛ 🤖 🔧 🚦 | 🧵, subagent | Timestamps in that thread's own transcript. See [time](#time). | no: an agent's time is on its row |
| ⌛ 🤖 🔧 🚦 | 🎤, receipt | The same rule over the turn's span, plus each agent's own, filed with its requests. See [time](#time). | yes |
| ⌛ 🤖 🔧 🚦 | 🎮 | The session's age, and the agent-seconds of every thread. | yes |
| ⛳ | 🧵 🎤, subagent | The last ETA the thread reported in the current answer, pushed out to the latest of any running descendant's. See [ETA](layout.md#eta). | yes, descendants |
| 💾 diff | every row but 💳 | Lines in the thread's own Edit patches and new-file Writes; summed on 🎮. | as 🧩 |

"Counts agents" means subagents, forks, workflow agents, and agents those
agents spawned. 🧠 never counts them because every agent has its own context
window, and 🧠 is there to tell you when *this* one needs a `/compact`.

## Tokens

A request is counted once. Claude Code writes one transcript line per content
block (thinking, text, each tool call) and repeats the request's whole
`usage` object on every one, and a retried request appears again under the
same id. Records are deduplicated on `requestId` (falling back to
`message.id`), first occurrence wins, within the main transcript and across
all of the agent files.

Requests whose usage is all zero are skipped. That is how Claude Code records
an interrupted request and an API error placeholder (`model: "<synthetic>"`),
and neither was billed. An all-zero record also never replaces the last 🧠
reading, which would otherwise blank the cell.

▴ is not the raw input count. Raw input in a long session is almost all cache
reads, so ▴ weights each input class by its price relative to a fresh token:

| Input class | Weight |
|---|---|
| fresh input | 1 |
| cache write (`cache_creation_input_tokens`) | 2 (the 1-hour cache TTL) |
| cache read (`cache_read_input_tokens`) | 0.1 |

▾ is output tokens, unweighted. 🎯 is `cache_read / (fresh + cache_write +
cache_read)`, recomputed over all requests for a total rather than averaged
over turns.

## Dollars

Every 💰 and the window shares price every request at **its own model's**
list price, so a Sonnet fork inside an Opus turn costs
Sonnet money. Prices per million tokens, from the model catalog built into
Claude Code (`MODEL_PRICE`):

| Model id contains | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| `opus` | 5 | 25 | 0.50 | 10 |
| `fable-5-1` | 10 | 50 | 0.25 | 20 |
| `fable` | 10 | 50 | 1.00 | 20 |
| `sonnet-5` | 2 | 10 | 0.20 | 4 |
| `sonnet` | 3 | 15 | 0.30 | 6 |
| `haiku` | 1 | 5 | 0.10 | 2 |

The first matching row wins, so specific rows sit above their family. An
unrecognised model is priced as Opus, deliberately the high side.

These are API list prices. On a subscription they are a measure of how much
work was done, not what you paid; the plan-window shares are what map them
onto a subscription.

A compaction issues no usage record. Its cost is estimated from the boundary
record Claude Code writes instead: `preTokens` at the Opus cache-read rate,
plus a summary of `len(summary) / 4` tokens at the Opus output rate.

## Turns

🎤 and the receipt describe one turn. A turn opens on any of these:

* **A prompt the user sent**: a `type: user` record from
  `userType: external` that is not `isMeta`, with `promptSource` of `typed`,
  `sdk` (sent through the SDK, as `claude -p` does), `suggestion_accepted`
  or none, and text that does not start with `<`. The text is the content
  string, or for a prompt with an image pasted in, the text blocks of its
  list of text and image blocks.
* **A slash command the model answers**, a skill or a prompt command: the
  same record, its text starting with `<command-message>`, followed by an
  `isMeta` record holding what the command expands to. 🎤 prints it as it
  was typed, the `<command-name>` and its `<command-args>`. A command Claude
  Code runs itself, such as `/login`, `/config` or `/reload-plugins`, gets no
  answer and opens nothing: its record starts with `<command-name>`, and its
  output is a `<local-command-stdout>`. `/compact` is one of these, and its
  turn is the compaction's.
* **A message delivered to an idle session**: `type: user` with
  `promptSource: "system"`. Claude Code writes four kinds this way — a
  `<task-notification>` from a finished background task, a message from
  another session, a cross-session idle notice, and a usage-limit reset. The
  session answers each as it would a prompt and bills the answer the same
  way.
* **A prompt typed while the assistant was busy**: it goes through a queue.
  Current Claude Code hands it over with a `dequeue` that carries no text,
  then writes it as a `type: user` record with `promptSource: "queued"`,
  which opens the turn as a typed prompt does. Older transcripts have no such
  record, and the turn opens on the `queue-operation` record that delivered
  it (`remove` or `dequeue`), stamped when the model received it rather
  than when it was typed. Queue entries starting with `<` are machinery and
  open nothing, and a `popAll` is the queue pulled back into the editor, so
  its text was never answered and opens nothing either.

A message delivered into a turn that is still running opens nothing: a
`promptSource: "system"` record whose `turnPosition.turnIndex` is the open
turn's, before that turn's answer has ended. Claude Code numbers a batch of
messages delivered together, or a subagent's report that lands between a
prompt and the first request of its answer, into the turn already open, and
the answer is that turn's. A wake after the answer ended can carry the same
number, and opens a turn of its own.

A prompt typed while the answer runs, and handed to it between two of its
requests, opens nothing either. Claude Code writes it in one of two ways:

* A `queue-operation` removal with `reason: "absorbed_mid_turn"`, and a
  `queued_command` attachment carrying the text.
* A `dequeue`, then a `type: user` record with `promptSource: "queued"` and
  a `promptId` and `turnPosition.turnIndex` of its own, written after a tool
  result or an assistant record whose `stop_reason` is `tool_use` or not
  yet set, before the answer has ended (an assistant `end_turn`, a
  `stop_hook_summary` or a `turn_duration`).

Claude Code ends no turn before either, and answers the prompt in the turn
still running. So the turn runs from the prompt that opened it to the
end of its answer: it keeps that prompt's text, its `promptId` and its
clock, and every request after the mid-turn prompt is the turn's, on the
🎤 row and on the receipt alike. A `"queued"` record after the answer
ended, or after an interrupt, opens a turn of its own.

A `promptSource: "system"` record with no `turnPosition` opens nothing once
any earlier record in the transcript has carried a `turnPosition`. Claude
Code numbers every message it delivers as a turn of its own; the ones it
leaves unnumbered are folded into the next request it sends and never
answered alone, and their records belong to the turn before. A transcript
that never shows `turnPosition`, from a Claude Code before the field, opens
a turn on every such record.

The summary `/compact` injects (`isCompactSummary`), tool results and system
reminders never open a turn. A prompt recorded both as queued and as typed
opens one turn, not two. Requests that appear before the first turn opener
have no turn and are dropped.

A turn ends at the last record the answer produced: an assistant or system
record, or a tool result. Records the user causes later — the next enqueue, a
slash command's caveat — do not extend it, so time spent reading and typing is
not charged as answering time.

**Which turn is reported** is the last one that made main-thread requests and
is not a compaction or an agents' turn. The live 🎤 and the receipt's use the
same rule, so they always describe the same prompt.

**Waiting for the transcript.** Claude Code writes a turn's last records
after the turn ends, so the receipt waits for them before it is stamped;
see [the receipt](layout.md#the-receipt).

## Agents

Nothing an agent bills is in the session's own transcript. Claude Code writes
it to files beside it:

```
<project>/<session-id>.jsonl                                   the session
<project>/<session-id>/subagents/agent-<id>.jsonl              Agent tool, forks, and agents they spawn
<project>/<session-id>/subagents/agent-<id>.meta.json          sidecar: agentType, parentAgentId, spawnDepth, …
<project>/<session-id>/subagents/workflows/wf_<id>/agent-<id>.jsonl   a workflow's agents
```

A nested agent sits in the same directory as its parent and differs from a
sibling only by `parentAgentId` (and `spawnDepth`) in its sidecar.

**Filing agent spend under a turn.** Each agent request is filed under the
turn whose `promptId` appears on the agent's most recent user record — the
prompt that spawned it, or a later one that resumed it with `SendMessage`.
That id is matched against every user record of the main transcript, tool
results included. Filing by timestamp instead would put a background agent's
spend on whichever prompt happened to be open when it finished. Where no main
record carries the id (workflow agents, which run under ids of their own, and
old transcripts) the request goes to the last non-compaction turn open at its
timestamp.

An agent's requests add to the turn's tokens, dollars and call count. They do
not change the turn's 🧠 reading or its end time, because agents have their
own windows and run in parallel with the answer.

**Subagent rows** read one agent's own transcript: its tokens, cost,
context, cache rate, diff and time are its own and do not include its
children. See [time](#time) for how the row splits ⌛.

### Agents on the receipt

A turn's receipt draws, under its 🎤, every agent the turn ran that had
finished when it was stamped, each with what it billed. One still running
is owed a row, which the first receipt stamped after it ends draws. The
main transcript says when an agent finished: a `<task-notification>` for
its id that carries a `<status>`, for a background agent, or the Agent
call's result with its `agentId` and a terminal status, for a foreground
one. An agent resumed by SendMessage after it ended is running again until
its next end. See [the receipt](layout.md#the-receipt) for how the tree is
drawn.

### Agent folds

Every read reads every agent file of the session, and a long session can
have hundreds of them. So each file's fold is saved, per session, in
`claude-agent-fold-<digest>/` in private state, as `plugin/src/state_spec.ts`'s
`agent-fold` row names it, and a read takes only the lines written since.
A saved fold is read only while the 4 KiB before its offset are the bytes
it was folded from, so a file rewritten in place is read afresh. Requests
are deduped across files after the folds, on every read, so a saved fold
never changes which requests are counted.

## Time

🧵 and every subagent row split one thread's age by the same rule
(`threadClock`), reading that thread's own transcript alone:

| Mark | Meaning | How it is measured |
|---|---|---|
| 🤖 | the model thinking | Its working spans, minus every tool call it made. |
| 🔧 | inside a tool | Its tool calls, from the assistant record that asks for one to the `tool_result` with the matching `tool_use_id`, minus the waiting calls below. |
| 🚦 | waiting | Everything else: on you to type or to answer, on an agent it started, or parked until something wakes it. |

The three do not overlap and add up to the age exactly. **The thread's age**
is now minus its first timestamped record. For an agent it is the earlier of
its first record and the task's `startTime`, because Claude Code restarts
`startTime` when it resumes an agent. It runs to now while the agent is
running or parked, and stops at its last record once it has finished.
**Parked** means Claude Code marks the agent completed, but its last message
still carries a live ETA, or an agent under it is still running.

**Working spans** run from the record that opens an answer to the last
record it produced. An agent's span closes when its answer ends its turn, so
one resumed later by `SendMessage` contributes two spans, and the wait
between them is 🚦. Spans are unioned, never summed.

**Waiting calls** are tool calls whose span is someone else's time
(`WAITING_TOOLS`, matched by name). `AskUserQuestion` and `ExitPlanMode` are
you reading. `Agent` and `Task` are another agent working, whose time is on
its own row. The subtraction is `union(all tool spans) − union(waiting
spans)`, which is exact because the waiting spans are a subset. Where a
waiting call overlaps an ordinary one, the overlap is waiting. Permission
prompts are not moved: nothing in the transcript marks one, and a tool that
waited for approval did hold up the thread.

**A call still running** counts to now: a running agent's, and the main
thread's while its turn runs. An agent that has finished counts only calls
that returned.

**Why its own thread alone.** Were 🧵 to union every agent's spans into
its busy clock, or an agent row to add its children's tool time to its 🔧,
a coordinator parked on five background agents would read as fully busy
the whole time it sat waiting on them. Waiting on an agent is 🚦, and the
agent's work shows on its own row.

On every row the split is drawn as three Braille gauges of ⌛ rather than
as figures. They hold eight dots between them, shared by largest remainder,
and a share of at least 1% always gets a dot. The figures come off records
and ⌛ off the clock as well, so they can overrun it by a moment. The shares
are then of their sum.

**🎤 and the receipt** split each turn by the same rule (`turnClock`), over
the turn's span from opener to last answer record rather than over the
age. 🔧 is the turn's tool calls less its waiting calls, and 🤖 is the span
less both. Each call is filed under the turn its result arrives in and
clipped to that turn's span. Summed over the turns, for a transcript whose
calls all returned, this main-thread part equals 🧵's 🤖 and 🔧; each turn
then adds its agents' time (below).

A compaction's 🤖 is the `durationMs` its boundary records, and its 🔧 is
zero, since the summariser runs no tool.

**Agents** add their own 🤖 and 🔧 to the turn that bills them. Each
agent's clock, by its row's rule, is cut at every request it bills: a
request carries the agent's time since the one before it, and time after
its last request is left for the request that follows. The time is then
filed with the request, exactly as its tokens are, so it is counted once.
The main thread's wait on an `Agent` call is in neither figure, so no agent
second is counted twice. Agents run beside the answer and beside each
other, so these are agent-seconds: a turn can read more than it took, and
🎮's 🤖 and 🔧 are 🧵's plus every agent's.

## Plan-window shares

Claude's subscription meters report only whole-account percentages. Every 🎤,
🎮 and agent-row share of the 5-hour (🔋) and weekly (🪫) windows is derived:

```
dollars per percent  =  list-price cost of every request on this machine in the window
                        ÷  the window's current account percentage
share                =  cost this turn / session / agent spent in the window
                        ÷  dollars per percent
```

**The window.** Each window's start is its reset time minus its length (5
hours or 7 days). Both come from the [usage source's](usage-sources.md)
reading.

**The machine's cost** is a scan of every transcript under
`~/.claude/projects/` (override with `AGENTREE_STATUSLINE_CLAUDE_PROJECTS_DIR`)
and every agent file beside them, deduplicated on request id and priced per
model. Agent files are included because the account percentage includes agent
use. Files last modified more than a day before the weekly window opened are
skipped, which bounds the scan by window length rather than history.

**Caching.** The scan's two costs are cached together with the two
percentages read at the same moment, keyed by the source, account, period and
window boundaries, for 300 seconds. The division is redone on each render
against the cached pair. Dividing a cached cost by a live percentage is wrong
right after a reset, when the cost is seconds old and the percentage is
climbing, and can make a turn's share larger than the account's.

Each file's priced requests are kept between scans in one
`claude-window-costs-<sha256>.cache` in private state, with the offset of the
last complete line read and a digest of the 4 KiB before it. A scan reads only
what was appended since. A file that shrank, or whose bytes before the offset
changed, is read again from the start. Reading everything took 6.2 seconds on
a week of 836 MB; a scan from the cache takes a tenth of a second. The plugin
writes it through a temporary file renamed over it. Its name is a digest of
its format in `plugin/src/state_spec.ts`, which moves when the prices or what is
billed do, so only such a change starts it cold.

**Too small to divide by.** Percentages arrive as whole numbers, so a reading
of 1% means anywhere from 0.5% to 1.5%. Below 2% (`CALIB_MIN_PCT`) no rate is
derived and the shares print `?`. This affects the first minutes of each
5-hour window and the first hours of each week.

**The steps.** Rounding to whole points is half a point either way, about 8٪
of a reading of 6. But at the moment a reading steps up a point, the true
figure is at the same place in its band every time. So each scan where a
window's reading has risen since the last one notes that reading and the
window's spending then. Once the steps span 2 points (`CALIB_TICK_SPAN`), the
rate is the spending between the first and the last step divided by the
points between them. The rounding cancels out of that, and so does anything
used before the first step, here or elsewhere. A reading that moves is
scanned at once, not after `CALIB_TTL`. A step counts only when the reading
before it was seen at most 10 minutes earlier (`CALIB_TICK_GAP_S`): after a
longer gap, the step happened at some unknown moment in it. The last 16 steps
of each window are kept in the calibration cache (`sess_ticks` and
`week_ticks`). The week's steps last across its 5-hour windows, and survive a
source rounding the reset to a different minute, up to 10 minutes.

**Splitting at the boundary.** A turn can straddle a reset. Its cost is summed
per request by timestamp, so only the part billed after the window opened
counts. A request whose timestamp does not parse is counted in. A compaction
has no per-request parts and counts in or out by its own timestamp.

Because the turn, the session and the scan use the same boundary, the same
prices and the same reading, a limit row reads 🎤 ≤ 🎮 ≤ 💳.

**Caveats.**

* It assumes plan consumption is proportional to list-price cost. Anthropic
  does not publish the real weighting.
* The scan sees only this machine. Use from a phone, the web app or another
  computer raises the account percentage without adding to the scanned cost,
  so the rate comes out low and every share comes out **high**.

The share is not computed as "account percentage now minus account percentage
when the session started". That difference includes every other session's use
over the same period, and becomes the whole account total once the window
resets under a running session.

## One reading per render

Each render takes one plan reading from the selected usage source, and
everything that needs it — the 💳 percentages, the window boundaries, and the
calibration's percentages — uses that same reading (`seedLimitsSnapshot`).
Mixing readings taken at different times can put a boundary from an expired
window beside a percentage from the current one. An explicitly selected source
that fails leaves the cells blank rather than falling back to another source.
See [usage sources](usage-sources.md) for how the reading is chosen and how
old it may be.

## State kept between loads

The plugin keeps what it has learnt in files in its private state directory
(see [refresh and storage](usage-sources.md#refresh-and-storage)), so a
reload or a new session starts from it: the calibration and the window scan
(see [caching](#plan-window-shares)), the transcript's and each agent's
folds, the inbox's, and the last usage-source reading. Each kind, its name
and its format are in `plugin/src/state_spec.ts`; a session's files are named by a
SHA-256 digest of its key.

## Compactions

A compaction writes no usage record. It is read from the
`compact_boundary` record instead: `preTokens` (the context that was
summarised), `durationMs`, and whether it was manual or automatic. A
`/compact` is a turn of its own, or fills the `/compact` prompt's turn when
that prompt made no requests. An automatic compaction lands inside another
turn, and is billed to that turn's 🎤 and receipt, its dollars and tokens
with the rest of what the turn spent. A subagent row counts its thread's
compactions under 🤏.

The turn after a compaction reports the drop in context across it (`🧠-195k
-19٪`): the context change is measured from the last turn that had a
reading, skipping the compaction turn, which has none.

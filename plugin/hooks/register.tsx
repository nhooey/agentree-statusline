// The usage band: the usage line's grid drawn in Claude Code's own screen.
//
// docs/layout.md has what is drawn.  Three places are drawn:
//
//   AbovePrompt   the band, bandLines over the last status document, at the
//                 body's width plus the five columns the gutter takes,
//                 under a rule in the session's colour (band-rule); its
//                 tree's fold marks and labels take a press, and 🎮's
//                 📦 🌿 🔀 are links (pressLine);
//   TurnDuration  the turn's closing line: the turn's receipt, blank until
//                 it is stamped;
//   AssistantMessage  under the answer of a turn Claude Code closes with
//                 no line, the turn's receipt (underAnswer);
//   UserMessage   under a prompt typed at the composer, its turn's tag;
//                 and a message another agent sent, folded, as that
//                 agent's task and the message's first line;
//   AgentRow      Claude Code's agent panel row of each agent the band's
//                 tree draws, hidden (agent-panel-dedupe).
//
// The band's 🎤 and 🎮 rows are live while a turn runs; once the turn has
// ended and Claude Code has written its records, the plugin stamps them,
// frozen, as the receipt its closing line draws (stamp).  A load stamps
// the last finished turn if the load before stopped short of it
// (stampMissed).
//
// The handlers do the reading (edges.ts and the modules it reads with) and
// file what they read: the status document in `$.state`, so a new one
// redraws the band, and each start line in `$.store`, so it outlives the
// module and a reload draws it again.  The drawings read only what was
// filed.  What a handler catches goes to the plugin's log (log.ts), never to
// the engine.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { FiguresDoc } from '../types'
import { settings } from '../src/formatting.ts'
import type { Env, Settings } from '../src/formatting.ts'
import { hexOf } from '../src/spans.ts'
import type { Press, Span } from '../src/spans.ts'
import {
  bgPath, drawnAgents, foldShut, foldsKey, heldFolds, keptFolds, pruneFolds,
  stampedSplit,
} from '../src/band_tree.ts'
import { LOG_TAIL_BYTES, logFile, logRows, tailLines } from '../src/shell_log.ts'
import { _recordsOf } from '../src/claude_records.ts'
import type { Turn } from '../src/claude_records.ts'
import {
  ROW_NAMES, accountHide, accountLine, bandRows, bandRule, bandScoped,
  drawnIn, footerRuler, footerTail,
  modeOfHint, rootDrawn, ruleDrawn, treeAgentIds, treeAgents,
} from '../src/band.ts'
import type { BandOpts, RowsLive, RowsPlace } from '../src/band.ts'
import {
  answerText, billedNothing, closingLine, newestBilled, receiptScoped,
  stampedOf, startTag, tagsHidden, turnKey,
  withEngineDuration,
} from '../src/receipt.ts'
import type { TurnEnd } from '../src/receipt.ts'
import type { Options, Place } from '../src/options_spec.ts'
import { messageBlock, messageSpans, taskOf } from '../src/agent_message.ts'
import { sha256Hex } from '../src/sha256.ts'
import type { Dict } from '../src/py.ts'
import { CONFIG } from './config.ts'
import {
  fileSize, forgetPlaces, placesFor, readRange, steps,
} from './engine.ts'
import {
  drawEnd, drawNext, drawStart, ioSinceLast, ioText, noteDrawing,
} from './profile.ts'
import { agentsChanged, agentsNow, senderOf } from './senders.ts'
import {
  defaultsError, options, optionsFor, readConfig,
} from './configuration.ts'
import {
  costDoc, lastFinishedMs, permissionModeOf, pruneSessions, seen, statusDoc,
  transcriptPath, turnsNow,
} from './edges.ts'
import { log } from './log.ts'
import { instructEta } from './eta_instruction.ts'

type $ = EngineInterface

// Bumped by each load, so the timer an earlier load started stops.
const generation = atom(
  { plugin: 'agentree-statusline', key: 'generation' } as const, 0)
const status = atom(
  { plugin: 'agentree-statusline', key: 'status' } as const, null)
const rate = atom(
  { plugin: 'agentree-statusline', key: 'rate' } as const, null)
const filed = atom(
  { plugin: 'agentree-statusline', key: 'filed' } as const, 0)
// Bumped by each receipt filed under its turn's answer (underAnswer), so
// the answers draw again only then, and not on every receipt.
const answered = atom(
  { plugin: 'agentree-statusline', key: 'answered' } as const, 0)
const clockNow = atom(
  { plugin: 'agentree-statusline', key: 'now' } as const, 0)
const held = atom(
  { plugin: 'agentree-statusline', key: 'held' } as const, false)
// Bumped by each read of the configuration files that changes the
// options, so every drawing that reads it draws again with them.
const configured = atom(
  { plugin: 'agentree-statusline', key: 'configured' } as const, 0)
// The band tree's folds the person left, by key, and the session they are
// of, read back through heldFolds (band_tree.ts).
const folds = atom(
  { plugin: 'agentree-statusline', key: 'folds' } as const, {})
// The background shell whose log band is open, by its task id, or null
// for none (shellBand).
const shellLog = atom(
  { plugin: 'agentree-statusline', key: 'shellLog' } as const, null)

/** The store's key for a start line: its prompt's text. */
export const startKey = (text: string) =>
  'start:' + sha256Hex(text).slice(0, 32)

/** The band's rows with `plugin`'s first and the others after them in the
 * order they came, each row itself as it came, since the engine refuses a
 * row changed or repeated; `rows` itself where `plugin` has none, or its
 * are first already. */
export function ownRowFirst<R extends { readonly plugin: string }>(
  rows: readonly R[], plugin: string): readonly R[] {
  const own = rows.filter((r) => r.plugin === plugin)
  if (!own.length || own.every((r, i) => rows[i] === r)) return rows
  return [...own, ...rows.filter((r) => r.plugin !== plugin)]
}

let st: Settings | null = null
// The options `st` was made under.
let stKey = ''

/** The settings the rows are drawn under `o`, made again when the
 * options they take have changed. */
async function settingsOf($: $, o: Options): Promise<Settings> {
  // right-edge: derived from rows.*.place, 2 with every row under the
  // footer line, where there is no [-], and 5 with any above the prompt,
  // where the band's [-] stands.
  const key = JSON.stringify([o.markSpacing, o.subscriptDecimals,
    o.rightEdge])
  if (st && key === stKey) return st
  const env: { [k: string]: string | undefined } = {}
  // The variables formatting.settings reads for the terminal's profile.
  env.TMUX = await $.env.get('TMUX')
  env.TERM_PROGRAM = await $.env.get('TERM_PROGRAM')
  // And the ones it reads for the colour level Claude Code draws at, from
  // the same process environment Claude Code read it from
  // (spans.COLOUR_VARS).
  env.FORCE_COLOR = await $.env.get('FORCE_COLOR')
  env.NO_COLOR = await $.env.get('NO_COLOR')
  env.TERM = await $.env.get('TERM')
  env.COLORTERM = await $.env.get('COLORTERM')
  env.TERM_PROGRAM_VERSION = await $.env.get('TERM_PROGRAM_VERSION')
  env.CLAUDE_CODE_TMUX_TRUECOLOR = await $.env.get('CLAUDE_CODE_TMUX_TRUECOLOR')
  st = settings(env as Env, o.markSpacing, o.subscriptDecimals, o.rightEdge)
  stKey = key
  return st
}

/** When each of the band's rows is drawn, from the options' rows. */
function liveOf(o: Options): RowsLive {
  return { turn: o.rows.turn.live, agent: o.rows.agent.live,
    session: o.rows.session.live }
}

/** Where each of the band's rows is drawn, from the options' rows. */
function rowPlacesOf(o: Options): RowsPlace {
  return { turn: o.rows.turn.place, agent: o.rows.agent.place,
    session: o.rows.session.place }
}

/** Whether the turn's tag lines are drawn, 🔻🔖 under the prompt and the
 * receipt's 🔺🔖: rows.tag.transcript, and not the hide path `name.tag`;
 * never with no options. */
function tagsShown(o: Options | null): boolean {
  return o !== null && o.rows.tag.transcript && !tagsHidden(o.hide)
}

/** How many start lines and receipts are kept: the option
 * starts-kept, and with no options every one, until they come. */
const keptMost = (): number => options()?.startsKept ?? Infinity

/** The configuration files read again where they have changed, or the
 * session's root has moved: a change draws everything again under the
 * new options, and reads the figures again, whose source or account may
 * be what changed. */
async function reconfigure($: $): Promise<void> {
  if (!await readConfig($)) return
  await update($, configured, (n) => n + 1)
  void refresh($).catch((err) => log($, 'refresh', err))
}

/** `p`, or a rejection naming `what` once CONFIG.readLimitMs has passed
 * with it still running.  The step goes on, and what it gives is dropped:
 * nothing can stop a read the runtime has started. */
async function inTime<T>($: $, what: string, p: Promise<T>): Promise<T> {
  p.catch(() => {})
  const stop = new AbortController()
  const limit = $.clock.sleep(CONFIG.readLimitMs, { signal: stop.signal })
    .then(() => {
      const done = Object.entries(steps).map(([k, v]) => `${k} ${v}`)
      throw new Error(`${what} still running after ` +
        `${CONFIG.readLimitMs / 1000}s, dropped` +
        (done.length ? ` (done: ${done.join(', ')})` : ''))
    }, () => new Promise<never>(() => {}))
  try {
    return await Promise.race([p, limit])
  } finally {
    stop.abort()
  }
}

// What the receipts trial has logged, so each shape is logged once
// (agents/plans/open/agent-compact-receipts.md, AR1).
const tried = new Set<string>()

/** `what` and `shape`, logged the first time that pair is seen. */
async function trial($: $, what: string, shape: Dict): Promise<void> {
  const line = what + ' ' + JSON.stringify(shape)
  if (tried.has(line)) return
  tried.add(line)
  await log($, 'trial: ' + line)
}

let refreshing: Promise<void> | null = null
let again = false
// When the last read finished and how long it took, in ms, and whether a
// main-thread turn runs: the tick's pace.
let readAt = 0
let readMs = 0
let turnRunning = false
// When the last slow read's toast was shown, in ms.
let toastAt = 0

/** A read that took `ms`: logged, with each step's ms, and shown as a
 * toast at most once per slowToastMs under the option slow-toast, so a slow
 * read is seen as it happens: the plugin times itself and warns when it is
 * slow.  Off by default: the toast takes the footer's line, hiding the 💳
 * account at its right end. */
async function slow($: $, ms: number, used: string): Promise<void> {
  const parts = Object.entries(steps).map(([k, v]) => `${k} ${v}`)
  const text = `slow read: ${Math.round(ms)}ms (${parts.join(', ')}; ` +
    `${used})`
  await log($, text)
  const now = await $.clock.now()
  if (options()?.slowToast && now - toastAt >= CONFIG.slowToastMs) {
    toastAt = now
    $.ui.toast(text)
  }
}
// The prompt a turn opened with, until the transcript holds its record:
// its text, which the start line is filed under, and the tag that stood
// before it, which the new one must differ from.
let pending: { text: string; before: unknown; filed?: string } | null =
  null
// The promptId the running turn opened with, once a document showed its
// record (fileStart); "" until then.  The receipt bills this turn: read
// after turn.complete instead, the newest prompt can be one written as the
// turn ended, a task notification's.
let opened = ''

/** Reads the status document afresh; the write redraws the band.  One at
 * a time: a call while one runs asks for one more after it. */
async function refresh($: $): Promise<void> {
  if (refreshing) {
    again = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      again = false
      // The figures are read under the options: until the configuration
      // is read, and while the defaults file is wrong, there are none.
      if (options() === null) {
        await inTime($, 'the configuration', readConfig($))
          .catch((err) => log($, 'config', err))
        if (options() === null) continue
      }
      let doc: Dict
      const began = await $.clock.now()
      try {
        doc = await inTime($, 'the status document',
          (async () => statusDoc($, await placesFor($)))())
        readAt = await $.clock.now()
        readMs = readAt - began
        const used = ioSinceLast()
        if (readMs > CONFIG.slowReadMs) {
          await slow($, readMs, ioText(used))
        } else if (used.readBytes >= CONFIG.ioNoteBytes ||
                   used.spawns >= CONFIG.ioNoteSpawns) {
          await log($, `heavy refresh: ${Math.round(readMs)}ms ` +
            `(${ioText(used)})`)
        }
      } catch (err) {
        // A read that failed leaves the last document up, and the next
        // event reads again.
        await log($, 'refresh: no status document', err)
        continue
      }
      // The folds of the conversation the document is of, before the band
      // draws them.
      const id = (doc.payload as Dict | undefined)?.session_id
      const session = typeof id === 'string' ? id : ''
      try {
        if (session) await foldsOf($, session)
      } catch (err) {
        await log($, 'refresh: the folds were not read', err)
      }
      try {
        await update($, status, () => doc as FiguresDoc)
        await update($, rate, () => (doc.rate as number | null) ?? null)
      } catch (err) {
        await log($, 'refresh: the band was not updated', err)
      }
      // A row the tree would no longer draw takes its fold with it, so no
      // later row is drawn under a fold it never had: an agent paused,
      // finished under finished-within or over one at work keeps its
      // fold.  Every row opened, whatever the phase draws, so a fold
      // outlasts the gap between turns.  Only the document's session's.
      try {
        const o = options()
        const a = o === null ? null : treeAgents(doc, false, o.finishedWithin)
        if (a !== null) {
          const drawn = drawnAgents(a)
          const pruned = (v: unknown): boolean => {
            const h = heldFolds(v)
            return h.session === session &&
              pruneFolds(h.folds, drawn) !== h.folds
          }
          if (pruned(await read($, folds))) {
            await update($, folds, (v) => {
              const h = heldFolds(v)
              return pruned(v) ? { ...h, folds: pruneFolds(h.folds, drawn) }
                : v
            })
            await keepFolds($)
          }
        }
      } catch (err) {
        await log($, 'refresh: the folds were not pruned', err)
      }
      try {
        await fileStart($, doc)
      } catch (err) {
        await log($, 'refresh: no start line', err)
      }
      // The permission mode, off the transcript's newest prompt.
      try {
        noteMode($, 'transcript', await inTime($, 'the permission mode',
          (async () => permissionModeOf($,
            await transcriptPath($, await placesFor($))))()))
      } catch (err) {
        await log($, 'refresh: no permission mode', err)
      }
    } while (again)
  })()
  try {
    await refreshing
  } finally {
    refreshing = null
  }
}

/** Puts session `id`'s folds in `folds`, from its entry in the store
 * (keptFolds), once `folds` holds another session's: at the first refresh
 * of a new process (a restart, a `--resume`, a `--continue`), whose
 * `$.state` starts empty, and when a /resume or a /clear switches the
 * session under the process.  Folds of no session yet, as a reload from
 * a version that kept them in `$.state` alone left them, are kept over
 * the store's, and the store given them.  A store that will not read
 * rejects, and `folds` is left as it was, so the next refresh asks
 * again. */
async function foldsOf($: $, id: string): Promise<void> {
  if (heldFolds(await read($, folds)).session === id) return
  const kept = keptFolds(await $.store.get(foldsKey(id)), id) ?? {}
  let merged = false
  await update($, folds, (v) => {
    const h = heldFolds(v)
    if (h.session === id) return v
    merged = h.session === '' && Object.keys(h.folds).length > 0
    return { session: id, folds: merged ? { ...kept, ...h.folds } : kept }
  })
  if (merged) await keepFolds($)
}

// The store write of the folds under way, which each next one waits on.
let keeping: Promise<void> = Promise.resolve()

/** Keeps the folds `$.state` holds, as they stand once the writes before
 * have landed, in the store under their session's foldsKey (heldFolds),
 * with when, for a restart or a `--resume` to read back (foldsOf), and for
 * pruneSessions to sweep once it is old.  The writes go one at a time,
 * each reading the folds afresh, so the last to land is the newest. */
function keepFolds($: $): Promise<void> {
  const write = keeping.then(async () => {
    const h = heldFolds(await read($, folds))
    const id = h.session || await $.session.id()
    await $.store.set(foldsKey(id), { session: id, folds: h.folds,
      saved_at: (await $.clock.now()) / 1000 })
  })
  keeping = write.catch(() => {})
  return write
}

/** The start line, once a document shows the pending prompt's record:
 * filed under the prompt's text for its UserMessage to find.  A record
 * with no turn index is filed and the prompt kept pending, so a later
 * record that has one files over it: a task notification queued while
 * idle is written just before the prompt that opens the turn, with no
 * turnPosition of its own, and the turn bills the prompt.  Filed for good,
 * the notification's record would give the tag an id with no #, and the
 * receipt would wait on that id while the turn bills the prompt's. */
async function fileStart($: $, doc: Dict): Promise<void> {
  const tr = doc.transcript as Dict | undefined
  if (!pending || !tr?.prompt_id || tr.prompt_id === pending.before) return
  if (typeof tr.prompt_id !== 'string' || tr.prompt_id === pending.filed) {
    return
  }
  opened = tr.prompt_id
  // Filed whether or not the tag lines are drawn: the UserMessage that
  // draws it asks the options (tagsShown), so a change shows or hides it.
  // The account's windows are this document's, read as the turn starts,
  // and drawn under the hide paths as they stand now, as the receipt's are
  // as it is stamped.  refresh reads a document only under options.
  const o = options()
  const spans = o === null ? [] : startTag(await settingsOf($, o), doc,
    o.hide)
  const text = pending.text
  if (tr.turn_index === null || tr.turn_index === undefined) {
    pending = { ...pending, filed: tr.prompt_id }
  } else {
    pending = null
  }
  if (spans.length) await remember($, 'starts', startKey(text), spans)
}

// Reads the figures again every tickMs while idle, and every
// tickRunningMs while a turn runs, spaced by readSpacing times the last
// read's length.  It looks each clockMs, so a turn that starts mid-wait
// gets the faster pace at once.  Every tickMs it looks at the
// configuration files too, a stat of each, and reads them again where one
// has changed or the session's root has moved (reconfigure): the engine
// has no file-watch event for a plugin.
async function tick($: $, mine: number) {
  let configAt = await $.clock.now()
  while ((await read($, generation)) === mine) {
    await $.clock.sleep(CONFIG.clockMs)
    if ((await read($, generation)) !== mine) return
    const now = await $.clock.now()
    if (now - configAt >= CONFIG.tickMs) {
      configAt = now
      await reconfigure($).catch((err) => log($, 'config', err))
    }
    const pace = turnRunning
      ? Math.max(CONFIG.tickRunningMs, CONFIG.readSpacing * readMs)
      : CONFIG.tickMs
    if ((await $.clock.now()) - readAt >= pace) await refresh($)
  }
}

// Moves the time the band draws at every clockMs, so its clocks run
// between reads; the figures wait for the next read.
async function clock($: $, mine: number) {
  while ((await read($, generation)) === mine) {
    await $.clock.sleep(CONFIG.clockMs)
    if ((await read($, generation)) !== mine) return
    const ms = await $.clock.now()
    await update($, clockNow, () => ms / 1000)
    await noteDrawing($, ms).catch((err) => log($, 'drawing', err))
  }
}

/** `doc` drawn at `now` where that is later than when it was read: its
 * figures as read, its clocks as they stand now. */
function at(doc: Dict, now: number): Dict {
  const clock = doc.clock as Dict | undefined
  const then = clock ? Number(clock.now) : NaN
  return clock && now > then ? { ...doc, clock: { ...clock, now } } : doc
}

// The session this load of the module last started its tick for.
let startedFor: string | null = null

/** Starts this load's tick, once per session, from whichever event comes
 * first: the engine sends session.start at a process's start and at a
 * reload, but a plugin must not lean on its coming before a turn's events,
 * and a /resume in a running process switches the session under the
 * module with none.  The new session's state is its own, so the old
 * tick's generation reads stale and it stops, and what this module kept
 * for the old session is let go.  The render hooks call it too, since
 * after a /resume they may be the only events for a while.  The log's line
 * says which load ran in which session, so a live test can tell a plugin that
 * failed from one that was never loaded (a `claude --resume` without
 * `--plugin-dir`). */
async function start($: $, by: string): Promise<void> {
  const id = await $.session.id().catch(() => '')
  if (id === startedFor) return
  const switched = startedFor !== null
  startedFor = id
  if (switched) forgetSession()
  try {
    const cwd = await $.session.cwd().catch(() => '?')
    await log($, `started by ${by} in ${cwd}`)
    // The configuration files, at each load; until they are read the
    // options are the plugin's settings and the defaults.
    void reconfigure($).catch((err) => log($, 'config', err))
    const mine = (await read($, generation)) + 1
    await update($, generation, () => mine)
    void tick($, mine).catch((err) => log($, 'tick stopped', err))
    void clock($, mine).catch((err) => log($, 'clock stopped', err))
    // The figures now, not a tick from now: a switched session has none.
    void refresh($).catch((err) => log($, 'refresh', err))
    // The last turn's receipt, where the load before stopped short of it.
    void stampMissed($).catch((err) => log($, 'no receipt', err))
  } catch (err) {
    await log($, 'no tick', err)
  }
}

/** Lets go of what this module kept for the session it last drew: the
 * places and settings read for it, its turn under way, its permission
 * mode and the effort its requests asked for. */
function forgetSession(): void {
  forgetPlaces()
  st = null
  stKey = ''
  readAt = 0
  readMs = 0
  turnRunning = false
  pending = null
  opened = ''
  permissionMode = undefined
  hintMode = undefined
  modeless.clear()
  seen.effort = ''
}

/** Keep `key` in the store under `index`, the newest last, dropping the
 * oldest past the option starts-kept so the store stays small. */
async function remember($: $, index: string, key: string, value: unknown) {
  await $.store.set(key, value)
  const keys = ((await $.store.get(index)) as string[] | undefined) ?? []
  const kept = [...keys.filter((k) => k !== key), key]
  for (const old of kept.splice(0, Math.max(0,
    kept.length - keptMost()))) {
    await $.store.delete(old)
  }
  await $.store.set(index, kept)
  await update($, filed, (n) => n + 1)
}

// The width the band last drew at, the terminal's: the receipt is laid out
// at it, so its columns are the band's.  0 until the band has drawn.
let bandCols = 0
// The footer's hint and widths last logged.
let hintSeen = ''
// The band's widths and survey state last logged, and whether a survey
// held the band at its last draw, which the footer's log line repeats:
// what the trial above the prompt reads back (row-placement.md, RP1).
let bandSeen = ''
let surveyHeld = false
// The session's permission mode, as the transcript's newest prompt record
// names it (permissionModeOf, read on each refresh): the footer's `hint`
// leaves its pill out, so footerTail counts it apart.
let permissionMode: string | undefined
// The mode the footer's hint last named, which outranks the transcript's.
let hintMode: string | undefined

// The sources seen giving no mode, logged once each.
const modeless = new Set<string>()

/** Records the permission mode `from` gave, logging each change, and each
 * source that gave none, once. */
function noteMode($: $, from: string, mode: string | undefined): void {
  if (mode === undefined && !modeless.has(from)) {
    modeless.add(from)
    void log($, 'no permission mode on ' + from)
  }
  if (mode === undefined || mode === permissionMode) return
  permissionMode = mode
  void log($, 'permission mode ' + mode + ' from ' + from)
}

/** The store's key for a stamped receipt: its session and its turn. */
export const receiptKey = (session: string, turn: string) =>
  'receipt:' + sha256Hex(session + '\0' + turn).slice(0, 32)

/** Where the session's owed agents are kept: the ones a receipt left out
 * while they were still at work, stamped on the first receipt after they
 * end (stampedSplit). */
export const receiptOwedKey = (session: string) =>
  'receipt-owed:' + sha256Hex(session).slice(0, 32)

// The receipts being stamped, so two turn.completes over one turn stamp it
// once even before the first has filed its key.
const stamping = new Set<string>()

/** The store's key for the receipt a closing line draws: the turn's
 * duration, which the line is drawn with and turn.complete carries. */
const receiptAt = (durationMs: number) => 'receipt-at:' + durationMs

/** The store's key for the receipt drawn under a turn's answer, for a
 * turn the engine closes with no line (underAnswer): the answer's text. */
export const answerKey = (text: string) =>
  'receipt-answer:' + sha256Hex(answerText(text)).slice(0, 32)

/** A receipt as filed under receiptAt: its lines, each with its scope,
 * and `under: "answer"` where its turn's answer draws it instead
 * (underAnswer).  One filed as bare lines draws the same. */
type FiledReceipt = { rows: { scope: string; spans: Span[] }[];
  under?: 'answer' }

// How much of the transcript's end underAnswer reads for the turn's
// closing line, the previous turn's and the records between.
const CLOSING_TAIL = 4 * 1024 * 1024

/** Files `receipt` under the turn's answer as well, when the engine draws
 * no closing line for the turn that took `durationMs` (closingLine): a
 * turn a task notification or an agent's hand-back opened while an agent
 * still runs.  The transcript at `path` is read every
 * CONFIG.receiptPollMs until its turn_duration has landed, up to
 * `deadline`.  The receipt under receiptAt is marked, so a closing line
 * that is drawn after all (the ctrl+o transcript) draws it once. */
async function underAnswer($: $, path: string, durationMs: number,
  receipt: FiledReceipt, deadline: number): Promise<void> {
  for (;;) {
    const size = await fileSize($, path)
    if (size === null) return
    const from = Math.max(0, size - CLOSING_TAIL)
    let data = await readRange($, path, from, size, size)
    if (from > 0) data = data.subarray(data.indexOf(10) + 1)
    const end = closingLine(_recordsOf(data), durationMs)
    if (end) {
      if (!end.hidden || !end.answer) return
      await remember($, 'receipts', answerKey(end.answer), receipt)
      await remember($, 'receipts', receiptAt(durationMs),
        { ...receipt, under: 'answer' } satisfies FiledReceipt)
      await update($, answered, (n) => n + 1)
      await log($, 'receipt under the answer: no closing line for ' +
        durationMs + 'ms')
      return
    }
    if ((await $.clock.now()) >= deadline) return
    await $.clock.sleep(CONFIG.receiptPollMs)
  }
}

/** Stamps the receipt of the turn that opened with `prompt` (its id, ""
 * for any) into the transcript.  Claude Code writes a turn's assistant
 * records only after its Stop hooks have run, after turn.complete, so the
 * transcript is read every CONFIG.receiptPollMs until the newest prompt's
 * turn is billed and two reads agree on what it billed, for up to
 * CONFIG.receiptWaitMs.  Then the cost document, the receipt's two lines,
 * filed for the closing line to draw.  Each turn is stamped once (receiptKey); one
 * whose records never land is logged, and nothing stamped.  One that billed
 * nothing, as `end` (how turn.complete says it ended) or the transcript
 * tells (billedNothing), is logged in a line as soon as that is known, and
 * nothing stamped.  True where this call filed the receipt. */
async function stamp($: $, durationMs: number, prompt: string,
  end: TurnEnd | null = null): Promise<boolean> {
  const where = await placesFor($)
  const deadline = (await $.clock.now()) + CONFIG.receiptWaitMs
  let got: { path: string; turns: Turn[] } | null = null
  let last = ''
  for (;;) {
    got = await turnsNow($, where)
    const turns = got?.turns ?? []
    const billed = newestBilled(turns, prompt)
    const none = billed ? '' : billedNothing(turns, prompt, end)
    if (none) {
      await log($, 'no receipt: the turn billed nothing (' + none + '): ' +
        (prompt.slice(0, 8) || 'no prompt'))
      return false
    }
    const key = billed ? turnKey(turns) : ''
    if (key && key === last) break
    const late = (await $.clock.now()) >= deadline
    if (late && key) break
    if (late) {
      const t = turns.at(-1)
      await log($, 'no receipt: the turn was not billed within ' +
        CONFIG.receiptWaitMs / 1000 + 's: ' + JSON.stringify(got ? [
          prompt.slice(0, 8), t ? [t.prompt_id.slice(0, 8), t.turn_index,
            t.calls, t.agent ?? null, t.compact ?? null] : null]
          : 'no transcript'))
      return false
    }
    last = key
    await $.clock.sleep(CONFIG.receiptPollMs)
  }
  const key = receiptKey(await $.session.id(), turnKey(got!.turns))
  // Taken before the store is read, so a second stamp of the turn that
  // reads it in the meantime stops here.
  if (stamping.has(key)) return false
  stamping.add(key)
  try {
    if (await $.store.get(key) !== undefined) return false
    // With no options, nothing to lay the receipt out under: the defaults
    // file is wrong, and the footer says so.
    const o = options()
    if (o === null) {
      await log($, 'no receipt: no options')
      return false
    }
    const doc = await read($, status)
    const published = doc ? Number(doc.context_window) || 0 : 0
    const fig = withEngineDuration(await costDoc($, where, got!.path,
      got!.turns, published), durationMs)
    // 🤖 as the band drew it once the turn ended, from the band's last
    // status document.
    const st = await settingsOf($, o)
    const main = doc ? bandRows(st, doc as Dict,
      { rate: null, phase: 'done' }).main : null
    // Laid out as the band is, at its width and edge, and hint-inset
    // columns in, where every row of the band starts, above the prompt
    // and under the footer line, so the rows stack on the band's.  The
    // rows whose rows.<row>.transcript is true, and the tag line under
    // rows.tag.transcript.
    const stamped = ROW_NAMES.filter((r) => o.rows[r].transcript)
    // The turn's subagents under 🧵, as the band's tree drew them, from
    // the same document, where rows.subagents.transcript stamps them.
    const owedKey = receiptOwedKey(await $.session.id())
    const owed = ((await $.store.get(owedKey)) as string[] | undefined) ?? []
    const agents = o.rows.subagents.transcript
      ? stampedOf(doc as Dict | null, owed) : null
    const rows = receiptScoped(st, fig, bandCols || 80, o.hide,
      true, main, stamped, o.hintInset, tagsShown(o), agents)
    await remember($, 'receipts', key, true)
    // The agents still at work, owed a row on the first receipt after
    // they end; with no document, what was owed stays owed.
    if (agents) {
      await remember($, 'receipts', owedKey,
        stampedSplit(agents.agents).owe)
    }
    await remember($, 'receipts', receiptAt(durationMs),
      { rows } satisfies FiledReceipt)
    // Not awaited: the band's hold on the turn's rows ends with the stamp.
    void underAnswer($, got!.path, durationMs, { rows },
      (await $.clock.now()) + CONFIG.receiptWaitMs)
      .catch((err) => log($, 'no receipt under the answer', err))
    return true
  } finally {
    stamping.delete(key)
  }
}

/** Stamps the session's last finished turn where no receipt is filed for
 * it, as its turn.complete would have: a load unloaded while its stamp
 * waits on the transcript, as by a /reload-plugins queued during the turn,
 * which runs as it ends, leaves the turn with none.  Finished is a
 * turn_duration record after the turn's prompt (lastFinishedMs), whose
 * durationMs the closing line is drawn with; a turn still running is left
 * to its own turn.complete.  The prompt is the newest the refresh reads,
 * as turn.complete takes it for a turn no document saw open, and how the
 * turn ended is not in the transcript. */
async function stampMissed($: $): Promise<void> {
  const path = await transcriptPath($, await placesFor($))
  const durationMs = path ? await lastFinishedMs($, path) : null
  if (durationMs === null) return
  if (await $.store.get(receiptAt(durationMs)) !== undefined) return
  await refresh($)
  const tr = (await read($, status))?.transcript as Dict | undefined
  const prompt = typeof tr?.prompt_id === 'string' ? tr.prompt_id : ''
  if (await stamp($, durationMs, prompt)) {
    await log($, 'receipt stamped on load: ' +
      (prompt.slice(0, 8) || 'no prompt'))
  }
}

/** A row of spans as Text: each span a nested Text in its own colour,
 * named in spec and drawn as its hex. */
function line(Text: any, spans: readonly Span[], key: string,
  dim = false): RenderElement {
  const outer: Record<string, string | boolean> = { wrap: 'truncate-end' }
  if (dim) outer.dimColor = true
  return (
    <Text key={key} {...outer}>
      {spans.map((s, i) => (
        <Text key={key + '.' + i} {...spanStyle(s)}>{s.text}</Text>
      ))}
    </Text>
  )
}

/** A span's Text props: only the ones it sets, since a Text's props are
 * plain values, and an undefined one is not.  The true set where Claude
 * Code draws true colour: given the 256 set there, chalk would draw it as
 * given, and the softer true colours are the ones chosen to be seen.
 * Given the true set at 256, chalk would round it onto entries nobody
 * chose (see spec.ts). */
function spanStyle(s: Span): Record<string, string | boolean> {
  const truecolor = st?.truecolor ?? false
  const p: Record<string, string | boolean> = {}
  if (s.colour) p.color = hexOf(s.colour, truecolor)
  if (s.bg) p.backgroundColor = hexOf(s.bg, truecolor)
  if (s.dim) p.dimColor = true
  if (s.bold) p.bold = true
  return p
}

/** `s` as the parts its press's `at` makes of it, in order, the part that
 * presses alone keeping the press; a press with no `at`, or none, keeps
 * the span whole. */
export function partsOf(s: Span): Span[] {
  const at = s.press?.at
  if (!at) return [s]
  const { press: _, ...bare } = s
  const cps = Array.from(s.text)
  const [from, to] = [Math.min(at[0], cps.length), Math.min(at[1], cps.length)]
  return [
    { ...bare, text: cps.slice(0, from).join('') },
    { ...s, text: cps.slice(from, to).join('') },
    { ...bare, text: cps.slice(to).join('') },
  ].filter((p) => p.text)
}

/** Each run of spans of a row that press one thing, in order: the spans of
 * a run share their press, or all have none. */
function runsOf(spans: readonly Span[]): { press?: Press; spans: Span[] }[] {
  const out: { press?: Press; spans: Span[] }[] = []
  for (const s of spans.flatMap(partsOf)) {
    const last = out.at(-1)
    if (last && pressKey(last.press) === pressKey(s.press)) {
      last.spans.push(s)
    } else {
      out.push({ press: s.press, spans: [s] })
    }
  }
  return out
}

/** A press as one string, so runs pressing the same thing join, and the
 * key its Button is found by. */
function pressKey(p: Press | undefined): string {
  if (!p) return ''
  if (p.kind === 'fold') return 'fold:' + p.key
  if (p.kind === 'view') return 'view:' + (p.row ?? p.agent ?? 'main')
  if (p.kind === 'task') return 'task:' + p.row
  if (p.kind === 'log') return 'log:' + p.row
  return 'link:' + p.href
}

/** What a press on a run does, in a Button's onPress: a fold toggles the
 * fold kept under its key, against its row's default where none is kept
 * (the update reads it, so two presses before a redraw both land), and
 * keeps the folds in the store (keepFolds); a view
 * switches the transcript, and logs why where it would not; a task shows
 * its text as a toast, for CONFIG.taskToastMs; a log opens its shell's
 * log band, moving it from another shell's, or closes it where it is that
 * shell's (shellBand). */
function onPressOf($: $, p: Press): () => Promise<void> {
  if (p.kind === 'fold') {
    return async () => {
      await update($, folds, (v) => {
        const h = heldFolds(v)
        return { ...h, folds: { ...h.folds,
          [p.key]: !foldShut(h.folds, p.key, p.shut) } }
      })
      await keepFolds($).catch((err) => log($, 'the folds were not kept', err))
    }
  }
  if (p.kind === 'view') {
    return async () => {
      const r = await $.ui.view(p.agent === null ? {} : { agentId: p.agent })
      if (r.deny) {
        await log($, 'view ' + (p.agent ?? 'main') + ': ' + r.deny)
      }
    }
  }
  if (p.kind === 'task') {
    return async () => {
      $.ui.toast(p.text, { timeoutMs: CONFIG.taskToastMs })
    }
  }
  if (p.kind === 'log') {
    return async () => {
      await update($, shellLog, (v) => v === p.row ? null : p.row)
    }
  }
  return async () => {}
}

/** A row of the band's tree as `line` draws it, where any of its spans
 * presses something: a row Box of its runs, each run of spans as line's
 * nested Texts, a fold's, a view's or a task's in a plain Button keyed
 * by its press, which draws its children alone, and a link's in a Link
 * inside a Text.
 * The Box adds no column: each run is as wide as its spans, so every
 * figure stands where line would draw it.  A row that presses nothing is
 * line's. */
function pressLine(ui: any, $: $, spans: readonly Span[], key: string):
  RenderElement {
  const runs = runsOf(spans)
  if (!runs.some((r) => r.press)) return line(ui.Text, spans, key)
  const { Box, Button, Link, Text } = ui
  return (
    <Box key={key} flexDirection="row">
      {runs.map((r, i) => {
        const k = key + '.' + i
        const texts = r.spans.map((s, j) => (
          <Text key={k + '.' + j} {...spanStyle(s)}>{s.text}</Text>))
        if (!r.press) {
          return <Text key={k} wrap="truncate-end">{texts}</Text>
        }
        if (r.press.kind === 'link') {
          return (
            <Text key={k} wrap="truncate-end">
              <Link href={r.press.href}>{texts}</Link>
            </Text>
          )
        }
        return (
          <Button key={pressKey(r.press)} plain
            onPress={onPressOf($, r.press)}>{texts}</Button>
        )
      })}
    </Box>
  )
}

/** The rows of `place` as they stand, at bandCols, each with its scope, in
 * the one order, 💳 then 🎤, 🤖 and 🎮: the 💳 account where it is drawn
 * now as a row of its own (account-place "row") and rows.account.place
 * puts it here, then of 🎤, 🤖 and 🎮 those rows.<row>.place puts here
 * and rows.<row>.live draws while a turn runs, or keeps once it ends;
 * none without a status document.  Every row starts hint-inset columns
 * in, wherever it is drawn: under the footer line Claude Code's container
 * stands that far in, so the rows are drawn that much narrower; above the
 * prompt, where the band starts at the terminal's left edge, they are
 * indented that much.  So every mark stands on one column. */
async function bandNow($: $, isWorking: boolean, place: Place):
  Promise<{ scope: string; spans: Span[] }[]> {
  const running = isWorking || await read($, held)
  const b = await bandBasis($, running, place)
  if (b === null) return []
  const { o, st, opts } = b
  const fig = at(b.doc, await read($, clockNow))
  const cols = bandCols || 80
  const account = o.accountPlace === 'row' &&
    o.rows.account.place === place && accountedIn(o, running)
    ? accountLine(st, fig, accountHide(o.hide, o.weeklyWindows),
      cols - (opts.inset ?? 0), await home($), opts.indent ?? 0,
      rootedIn(o, running)) : []
  return [...account.length ? [{ scope: 'account', spans: account }] : [],
    ...bandScoped(st, fig, cols, o.hide, opts)]
}

/** What the band's rows of `place` are drawn from as they stand, a turn
 * running or not by `running`: the options, the settings, the last status
 * document as it was read, and the band's options from them; null without
 * a document or options. */
async function bandBasis($: $, running: boolean, place: Place):
  Promise<{ o: Options; st: Settings; doc: Dict; opts: BandOpts } | null> {
  const doc = await read($, status)
  const o = options()
  if (doc === null || o === null) return null
  return { o, st: await settingsOf($, o), doc: doc as Dict, opts: {
    rate: await read($, rate), phase: running ? 'running' : 'done',
    live: liveOf(o), place, places: rowPlacesOf(o),
    inset: place === 'footer' ? o.hintInset : 0,
    indent: place === 'above' ? o.hintInset : 0,
    agents: o.rows.subagents.live,
    linger: o.finishedWithin,
    folds: place === 'above' ? heldFolds(await read($, folds)).folds : {} } }
}

/** What a press on a background shell's row opens its log band with. */
type LogPress = Extract<Press, { kind: 'log' }>

/** The log band of the background shell whose band is open (shellLog),
 * as rows to draw above the tree's `lines`: a dim title naming the file it
 * shows, ⤷ and its path (bgPath), then the file's last lines, as many as
 * logRows leaves in a terminal `rows` high, beside the tree's rows and the
 * `ruleRows` over it (band-rule), each cut to the band's width.
 * Only the file's tail, LOG_TAIL_BYTES of it, is read.  The file is
 * logFile's; where it finds none, or the file is not there yet, the title
 * says so alone.  None while no band is open; and where the shell's row is
 * no longer drawn, none, and the band is closed. */
async function shellBand($: $, ui: any, lines: { spans: Span[] }[],
  ruleRows: number, rows: number, fullscreen: boolean):
  Promise<RenderElement[]> {
  const open = await read($, shellLog)
  if (open === null) return []
  const press = lines.flatMap((l) => l.spans).map((s) => s.press)
    .find((p): p is LogPress => p?.kind === 'log' && p.row === open)
  if (!press) {
    void update($, shellLog, (v) => v === open ? null : v)
    return []
  }
  const { Text } = ui
  const row = (key: string, text: string, dim: boolean) => (
    <Text key={key} wrap="truncate-end" dimColor={dim}>{text || ' '}</Text>)
  const sizeOf = async (path: string) => {
    const s = await $.fs.stat(path)
    return s.kind === 'file' ? s.size : 0
  }
  // Not `h`, the name JSX compiles against.
  const homeDir = await home($)
  const outSize = press.output
    ? await sizeOf(press.output).catch(() => 0) : 0
  const cwd = await $.session.cwd().catch(() => homeDir)
  const where = logFile(press.output, outSize, press.command, cwd, homeDir)
  if (where.path === null) return [row('log.title', '⤷ ' + where.why, true)]
  const title = '⤷ ' + bgPath(where.path, homeDir)
  try {
    const size = where.path === press.output ? outSize
      : await sizeOf(where.path)
    const offset = Math.max(0, size - LOG_TAIL_BYTES)
    const text = size > 0 ? await $.fs.read(where.path,
      { as: 'text', offset, length: size - offset }) : ''
    const body = tailLines(text, offset > 0, logRows(rows, fullscreen,
      lines.length + ruleRows))
    return [row('log.title', title, true),
      ...body.map((l, i) => row('log.' + i, l, false))]
  } catch {
    return [row('log.title', title + ' · not there yet', true)]
  }
}

/** Whether the band's tree draws its root now, whose label carries 📦 🌿
 * 🔀, which the 💳 account then leaves out (rootDrawn). */
function rootedIn(o: Options, running: boolean): boolean {
  return rootDrawn(o.rows.session.place, o.rows.session.live,
    running ? 'running' : 'done', o.hide)
}

/** Whether the 💳 account is drawn now, by rows.account.live, as the
 * band's rows are (drawnIn). */
function accountedIn(o: Options, running: boolean): boolean {
  return drawnIn(o.rows.account.live, running ? 'running' : 'done')
}

async function home($: $): Promise<string> {
  return (await placesFor($)).home
}

/** What the band above the prompt on a surface showed at its last draw,
 * of what its props alone tell: whether its tree is on screen (options
 * read, no survey holding the band, the band not collapsed), whether a
 * turn was running, and whether the band's rows that fit held this
 * plugin's, as AbovePromptList last handed them (absent, they did). */
type BandView = { shown: boolean; working: boolean; listed?: boolean }

// Each surface's BandView as its band last drew, by surface.  Kept here,
// not in `$.state`: a drawing never writes it, so a change asks every
// drawing again ($.ui.invalidate), the agent panel's rows among them
// (panelHidden).  A surface whose band has not drawn since this load has
// none, and hides no row.
const bandViews = new Map<string, BandView>()
// What each drawing instance last noted, by component and requestId: a
// redraw asks the others again only where its own props have moved, so
// two instances of the band on one surface never ask each other again
// without end.
const bandNoted = new Map<string, string>()
// The surfaces whose agent panel has asked for a row since this load:
// only there does a change of the band ask the drawings again.
const panelSurfaces = new Set<string>()

/** Records `seen`, of the band on `surface` as the instance `e` (an
 * AbovePrompt or AbovePromptList drawing) shows it, over what the surface
 * held, and asks every drawing again where the instance's own `seen` has
 * changed since it last drew, the surface's agent panel has rows and
 * agent-panel-dedupe is on: turned on later, the option's change asks
 * the rows again itself. */
function noteBand($: $, e: { surface: string; component: string;
  requestId: string }, seen: Partial<BandView>): void {
  bandViews.set(e.surface, { shown: false, working: false,
    ...bandViews.get(e.surface), ...seen })
  const key = e.component + '\0' + e.requestId
  const own = JSON.stringify(seen)
  if (bandNoted.get(key) === own) return
  bandNoted.set(key, own)
  if (panelSurfaces.has(e.surface) && options()?.agentPanelDedupe) {
    $.ui.invalidate('ui.render')
  }
}

/** Whether the agent panel's row of agent `id` is hidden: where `seen`,
 * the band on the row's surface, shows its tree on screen and its rows
 * hold this plugin's, and `drawn`, the ids of the agents its tree draws
 * (treeAgentIds), holds `id`. */
export function panelHidden(seen: BandView | undefined,
  drawn: readonly string[], id: string): boolean {
  return seen !== undefined && seen.shown && seen.listed !== false &&
    drawn.includes(id)
}

export const register: Register = on => {
  instructEta(on)

  // The main thread's effort, which the payload carries and `$.session`
  // does not: off each of its model requests.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      seen.effort = String(e.effort)
    }
    return yield* next(e)
  })

  // Each event below starts this load's tick if no event has yet (start).
  // The reads are not awaited: a session with many agents can read for 34s
  // after a reload, its parsing the hook's own time,
  // past the engine's 10s budget for a hook.
  // A session's start may be in another project: its configuration files
  // are looked at again (reconfigure), as the tick looks at them.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // The terminal's variables are read again, the colour level's with
    // them: settingsOf otherwise keeps what it read until an option moves.
    st = null
    await start($, 'session.start')
    void reconfigure($).catch((err) => log($, 'config', err))
    void refresh($).catch((err) => log($, 'refresh', err))
    // The spending and the folds kept for sessions long ended go.
    void (async () => pruneSessions($, (await $.clock.now()) / 1000))()
      .catch((err) => log($, 'session entries not pruned', err))
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await start($, 'tool.call')
    void refresh($).catch((err) => log($, 'refresh', err))
    return result
  })

  // A turn opens: the band again, and the start line for its prompt once
  // a document shows the prompt's record, this one or a later one.
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    await start($, 'turn.start')
    if (e.agentId) {
      agentsChanged()
      return result
    }
    turnRunning = true
    await update($, held, () => false)
    const tr = (await read($, status))?.transcript as Dict | undefined
    pending = { text: e.text, before: tr?.prompt_id ?? '' }
    opened = ''
    void refresh($).catch((err) => log($, 'refresh', err))
    return result
  })

  // A turn ends: the band again, its 🎤 row now the turn just done, and
  // the receipt stamped once the transcript bills the turn.  Neither the
  // read nor the stamp is awaited: the stamp waits on Claude Code's own write, which comes after
  // this event, for longer than a handler's budget, whose clock runs on
  // through a sleep; it goes on after the handler returns, as the tick
  // does.  The stamp bills the prompt the turn opened with and no later
  // one: as a document showed it while the turn ran, else as the refresh
  // reads it, for a turn too short for any read to have seen it.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await start($, 'turn.complete')
    void trial($, 'turn.complete', { agent: e.agentId ? 'yes' : 'no',
      reason: e.reason ?? null, aborted: e.isAborted ?? null,
      usage: e.usage !== undefined, durationMs: e.durationMs ?? null })
      .catch(() => {})
    if (!e.agentId) {
      turnRunning = false
      // The band keeps the turn's 🎤 and 🎮 until its receipt is stamped,
      // and a second more, so the two lines are never missing from both.
      await update($, held, () => true)
    }
    if (e.agentId) {
      agentsChanged()
      void refresh($).catch((err) => log($, 'refresh', err))
      return result
    }
    const seen = opened
    opened = ''
    void (async () => {
      await refresh($)
      const tr = (await read($, status))?.transcript as Dict | undefined
      const prompt = seen ||
        (typeof tr?.prompt_id === 'string' ? tr.prompt_id : '')
      await stamp($, e.durationMs, prompt,
        { reason: e.isAborted ? 'aborted' : e.reason,
          usage: e.usage !== undefined })
    })()
      .catch((err) => log($, 'no receipt', err))
      .finally(async () => {
        await $.clock.sleep(CONFIG.receiptHoldMs)
        await update($, held, () => false)
      })
    return result
  })

  // The receipts trial: the shapes Claude Code draws a subagent's end and
  // a /compact with, logged once each, nothing drawn differently.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const draw = drawStart('ToolResult')
    try {
      const row = await drawNext(draw, () => next(e))
      if (e.props.tool === 'Agent' || e.props.tool === 'Task') {
        const out = (e.props.output ?? {}) as Dict
        void trial($, 'ToolResult', { tool: e.props.tool,
          keys: Object.keys(out).sort(), status: out.status ?? null,
          agentId: typeof out.agentId === 'string' ? 'yes' : 'no',
          errored: e.props.isErrored }).catch(() => {})
      }
      return row
    } finally {
      drawEnd(draw)
    }
  })
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const draw = drawStart('UserMessage')
    try {
      const row = await drawNext(draw, () => next(e))
      if (e.props.origin.kind !== 'composer') {
        const t = e.props.task
        void trial($, 'UserMessage', { origin: e.props.origin.kind,
          task: t ? { id: t.id ? 'yes' : 'no', status: t.status ?? null,
            type: t.type ?? null, toolUseId: t.toolUseId ? 'yes' : 'no',
            durationMs: typeof t.durationMs === 'number' } : null,
          text: e.props.text.slice(0, 40) }).catch(() => {})
      }
      return row
    } finally {
      drawEnd(draw)
    }
  })
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const draw = drawStart('CommandOutput')
    try {
      const row = await drawNext(draw, () => next(e))
      void trial($, 'CommandOutput', { command: e.props.command,
        text: String(e.props.text ?? '').slice(0, 60) }).catch(() => {})
      return row
    } finally {
      drawEnd(draw)
    }
  })

  // Each drawing below reads `configured`, so a change of the options
  // draws it again.

  // The band above the prompt: the rows whose rows.<row>.place is
  // "above".  Its width is taken either way: the footer and the receipt
  // are laid out at it.  Whether its tree is on screen on this surface,
  // and whether a turn runs, is noted for the agent panel's rows
  // (noteBand): not under a survey, nor while the band is collapsed, its
  // tree then drawn and off screen.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const draw = drawStart('AbovePrompt')
    try {
      void start($, 'ui.render').catch((err) => log($, 'no start', err))
      bandCols = e.props.bodyColumns + 5
      surveyHeld = e.props.hasSurvey
      // The band's width, the terminal's, whether a pane can dock beside
      // the transcript, and whether a survey holds the band, each time one
      // changes: beside a docked pane bodyColumns is the transcript's
      // column, and under a survey the band is the engine's.
      const seen = JSON.stringify({ bodyColumns: e.props.bodyColumns,
        viewportColumns: e.viewport?.columns ?? null,
        isFullscreen: e.viewport?.isFullscreen ?? null,
        hasSurvey: e.props.hasSurvey })
      if (seen !== bandSeen) {
        bandSeen = seen
        void log($, 'band: ' + seen)
      }
      await read($, configured)
      const drawing = await optionsFor($) !== null && !e.props.hasSurvey
      noteBand($, e, { shown: drawing && !e.props.isCollapsed,
        working: e.props.isWorking })
      if (!drawing) return await drawNext(draw, () => next(e))
      const lines = await bandNow($, e.props.isWorking, 'above')
      // Between turns the receipt carries the rows, and the band has none.
      if (!lines.length) return await drawNext(draw, () => next(e))
      const ui = $.ui.resolve(e)
      const { Box, Text } = ui
      // No margin: Claude Code draws its `[-]` on the band's first row, and
      // on a blank top row it stood alone.  A bottom margin of -1, into the
      // blank row above the prompt's border, hid the band's last row under
      // the border instead.  The tree's fold marks and labels take a press
      // (pressLine), and a shell's opens its log band above the tree
      // (shellBand).  Over them both, band-rule's rule, the `[-]` on its
      // row, where the band still fits its rows with it (ruleDrawn); the
      // log band leaves it its row.
      const ruled = options()?.bandRule ?? false
      const logBand = await shellBand($, ui, lines, ruled ? 1 : 0,
        e.viewport?.rows ?? 24, e.viewport?.isFullscreen ?? false)
      const doc = await read($, status)
      const rule = doc !== null &&
        ruleDrawn(ruled, logBand.length + lines.length, e.props.maxRows)
        ? bandRule(doc as Dict, e.props.bodyColumns) : null
      return (
        <Box flexDirection="column">
          {rule ? [<Text key="rule" color={rule.colour}
            wrap="truncate-end">{rule.text}</Text>] : []}
          {logBand}
          {lines.map((l, i) => pressLine(ui, $, l.spans, 'band' + i))}
        </Box>
      )
    } finally {
      drawEnd(draw)
    }
  })

  // The band's rows, this plugin's first (ownRowFirst), so band-rule's
  // rule over it is the band's top edge.  A later AbovePromptList hook in
  // the chain may still reorder them.  Whether they hold this plugin's at
  // all is noted (noteBand): a row past the band's limits, or one a hook
  // above left out, is not drawn, and nor are its agents.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    noteBand($, e,
      { listed: e.props.rows.some((r) => r.plugin === $.plugin.name) })
    const rows = ownRowFirst(e.props.rows, $.plugin.name)
    return next(rows === e.props.rows ? e
      : { ...e, props: { ...e.props, rows } })
  })

  // Claude Code's agent panel under the prompt: the row of each agent the
  // band's tree draws on this surface is hidden (panelHidden), so no agent
  // is drawn twice, under the option agent-panel-dedupe.  The row is asked
  // for its agent's id, the id the tree's row carries ($.agent.list's).
  // The tree's agents are worked out here from what the band reads
  // (bandBasis, treeAgentIds), so a new document or fold asks the row
  // again; what only the band's props tell, a collapse or a survey, asks
  // it again through noteBand.  So the row comes back as soon as the band
  // no longer draws the agent.  The document is taken as it was read, not
  // moved on to the band's clock, so the row is not asked every second:
  // an agent the clock alone takes off the tree is one that ended
  // `finished-within` ago, whose row the panel no longer draws.  Hidden,
  // the agent stays in /tasks, and opening or stopping it still works.
  on('ui.render', { component: 'AgentRow' }, async ($, e, next) => {
    const draw = drawStart('AgentRow')
    try {
      panelSurfaces.add(e.surface)
      await read($, configured)
      const o = await optionsFor($)
      const seen = bandViews.get(e.surface)
      let hide = false
      if (o?.agentPanelDedupe && !e.props.isHidden && seen?.shown) {
        const b = await bandBasis($, seen.working || await read($, held),
          'above')
        hide = b !== null && panelHidden(seen,
          treeAgentIds(b.st, b.doc, b.o.hide, b.opts), e.requestId)
      }
      return await drawNext(draw, () => hide
        ? next({ ...e, props: { ...e.props, isHidden: true } }) : next(e))
    } finally {
      drawEnd(draw)
    }
  })

  // Claude Code's closing line, `✻ <word> for <duration>`, drawn as the
  // turn's receipt: 🔺🔖 its tag beside 🎤, then 📅 🕐 beside 🎮, dim, on
  // the band's columns, once stamped.  Drawn here rather than as a
  // `$.ui.log` line, which comes with Claude Code's
  // `⏺ agentree-statusline:` before it and a blank row after.  Until then one blank row: a Box one row high around a space, rather than an
  // empty Text, which Ink measures as no row at all.
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const draw = drawStart('TurnDuration')
    try {
      const { Box, Text } = $.ui.resolve(e)
      await read($, filed)
      await read($, configured)
      const got = (await $.store.get(receiptAt(e.props.durationMs))) as
        FiledReceipt | Span[][] | undefined
      const rows = Array.isArray(got)
        ? got.map((spans) => ({ scope: '', spans }))
        : got?.under === 'answer' ? [] : got?.rows ?? []
      if (rows.length) {
        // A blank row above, so the receipt stands apart from the answer,
        // and one under its tag line, which goes with the
        // tag line (tagsShown).
        return (
          <Box flexDirection="column" marginTop={1}
            marginBottom={tagsShown(options()) ? 1 : 0}>
            {rows.map((l, i) => line(Text, l.spans, 'receipt' + i))}
          </Box>
        )
      }
      return (
        <Box height={1}>
          <Text> </Text>
        </Box>
      )
    } finally {
      drawEnd(draw)
    }
  })

  // A turn the engine closes with no line (underAnswer): its receipt under
  // its answer's last block, as the closing line would draw it there, a
  // blank row above it and one under its tag line.  Every other block is
  // Claude Code's own.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const draw = drawStart('AssistantMessage')
    try {
      const row = await drawNext(draw, () => next(e))
      if (e.props.isSummary || !e.props.text.trim()) return row
      await read($, answered)
      await read($, configured)
      const got = (await $.store.get(answerKey(e.props.text))) as
        FiledReceipt | undefined
      if (!got?.rows?.length) return row
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {row}
          <Box flexDirection="column" marginTop={1}
            marginBottom={tagsShown(options()) ? 1 : 0}>
            {got.rows.map((l, i) => line(Text, l.spans, 'receipt' + i))}
          </Box>
        </Box>
      )
    } finally {
      drawEnd(draw)
    }
  })

  // The footer under the prompt, `-- INSERT -- ⏵⏵ auto mode on …`:
  // Claude Code's own line, which keeps its pills live, then the rows
  // placed under it, the 💳 row first under account-place "row"; under
  // "tail" the 💳 account is a dim tail at the line's right end
  // (footerTail).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const draw = drawStart('PromptHint')
    try {
      void start($, 'ui.render').catch((err) => log($, 'no start', err))
      // A change of mode draws the line first with the words of the mode it
      // turned off, so the one now on is known before the transcript has it.
      hintMode = modeOfHint(e.props.hint) ?? hintMode
      const mode = hintMode ?? permissionMode
      await read($, configured)
      const o = await optionsFor($)
      // A wrong defaults file: Claude Code's own line, and the error in red
      // under it in place of every row, so it cannot be missed.
      const fault = defaultsError()
      if (fault !== null) {
        const row = await drawNext(draw, () => next(e))
        const { Box, Text } = $.ui.resolve(e)
        return (
          <Box flexDirection="column">
            {row}
            <Text color="#ff5f5f" wrap="truncate-end">
              {`⚠ agentree-statusline:the defaults file is wrong: ${fault}`}
            </Text>
          </Box>
        )
      }
      const doc = await read($, status)
      if (doc === null || o === null) return await drawNext(draw, () => next(e))
      const st = await settingsOf($, o)
      // The band's width before the viewport's: the viewport can read 10
      // columns wider than the terminal draws, pushing the 🕐 off the row,
      // and the band's is where its rows end.
      const cols = bandCols || (e.viewport?.columns ?? 80)
      const fig = at(doc as Dict, await read($, clockNow))
      // The 💳 account, where rows.account.live draws it now.
      const running = e.props.isWorking || await read($, held)
      const accounted = accountedIn(o, running)
      const text = accounted && o.accountPlace === 'tail' ? footerTail(st, fig,
        accountHide(o.hide, o.weeklyWindows), e.props.hint, cols, mode,
        await home($), rootedIn(o, running)) : ''
      const tail = o.footerRuler && text ? footerRuler(st, text, cols)
        : text
      // What the padding was worked out from, each time it changes, so a
      // tail drawn too wide can be checked against the line it was given.
      // And whether a survey held the band at its last draw, so a footer
      // drawn under a survey says so (row-placement.md, RP1).
      const seen = JSON.stringify([e.props.hint, mode ?? null, bandCols,
        e.viewport?.columns ?? null, tail.length,
        e.viewport?.isFullscreen ?? null, surveyHeld])
      if (seen !== hintSeen) {
        hintSeen = seen
        void log($, 'footer: ' + seen)
      }
      const row = await drawNext(draw, () => tail
        ? next({ ...e, props: { ...e.props, tail } }) : next(e))
      // The rows whose rows.<row>.place is "footer", the 💳 account's among
      // them, under the footer line, in their colours: Claude Code's own
      // line first, from drawNext(draw, () => next(e)), so its pills
      // stay live, and a node beside it in a column goes on the row below
      // it.  Claude Code draws the line's container hint-inset columns in,
      // so the rows are drawn that much narrower on the panel's columns:
      // drawn at the full width, each cell would stand that many columns
      // right of the agent panel's, and the 💳 row would end past the grid.
      const lines = await bandNow($, e.props.isWorking, 'footer')
      if (!lines.length) return row
      const { Box, Text } = $.ui.resolve(e)
      // A blank row parts the rows from the footer line.
      return (
        <Box flexDirection="column" marginBottom={o.hintTuck ? -1 : 0}>
          {row}
          <Box height={1}><Text> </Text></Box>
          {lines.map((l, i) => line(Text, l.spans, 'band' + i))}
        </Box>
      )
    } finally {
      drawEnd(draw)
    }
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const draw = drawStart('UserMessage')
    try {
      const row = await drawNext(draw, () => next(e))
      if (e.props.origin.kind !== 'composer') return row
      await read($, configured)
      if (!tagsShown(options())) return row
      await read($, filed)
      const tag = (await $.store.get(startKey(e.props.text))) as
        Span[] | undefined
      if (!tag) return row
      const { Box, Text } = $.ui.resolve(e)
      // On a line of its own under the prompt, at no indent, so its 🔻🔖
      // stacks with the receipt's 🔺🔖 line, also at none: beside a short
      // prompt it could not stack.
      return (
        <Box flexDirection="column">
          {row}
          {line(Text, tag, 'tag', true)}
        </Box>
      )
    } finally {
      drawEnd(draw)
    }
  })

  // A message another agent sent, folded: Claude Code's `› Message from
  // @general-purpose (ctrl+o to expand)` drawn as the agent's task and the
  // message's first line, the task bold and the rest at normal strength
  // (agent-message-row; agent_message.ts has how the agent is found,
  // senderOf what that reads).  A tree, not a rewritten `text`: folded,
  // Claude Code draws the sender's name and not the text, so a new text
  // would change nothing there.  The tree is the row's own look as far as
  // a tree can give it, one line led by `›`.  Unfolded (ctrl+o, or a
  // surface that draws every row in full), the same row over the whole
  // message, wrapped, on the same green, where Claude Code's own names only
  // the agent's type, in its own colour.  On every other row,
  // Claude Code's own.
  //
  // Not pressable: a click on the row is Claude Code's, which expands the
  // message and collapses it again, as on its own row.  A Button here would
  // take that click, and no call a press can make toggles a
  // row (`isExpanded` is read-only), so the row is plain Text.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const draw = drawStart('UserMessage')
    try {
      const from = e.props.from
      if (!from) return await drawNext(draw, () => next(e))
      await read($, configured)
      const o = await optionsFor($)
      if (!o?.agentMessageRow) return await drawNext(draw, () => next(e))
      const sender = await senderOf($, from.name, e.props.text,
        await agentsNow($))
      const label = taskOf(sender, from.name)
      // The band's width before the viewport's, as the footer takes it: the
      // viewport can read wider than the terminal draws.  Ending where the
      // band's rows and the receipt's end, right-edge short of the edge.
      // Should the row stand in from the edge, the Text's truncate-end cuts
      // what the ellipsis did not.
      const cols = (bandCols || (e.viewport?.columns ?? 80)) - o.rightEdge
      const st = await settingsOf($, o)
      const { Box, Text } = $.ui.resolve(e)
      if (e.props.isExpanded) {
        return (
          <Box flexDirection="column">
            {messageBlock(st, label, e.props.text, cols).map((l, i) =>
              line(Text, l, 'agentMessage' + i))}
          </Box>
        )
      }
      return line(Text, messageSpans(st, label, e.props.text, cols),
        'agentMessage')
    } finally {
      drawEnd(draw)
    }
  })
}


// The mod's edges: the two documents built from what it reads through
// `$`, the status document the band draws and the cost document the
// receipt is stamped from.
//
// The src/ ports are pure where the plan says (figures from records, spans
// from figures), and their Node edges live in src/*_node.ts, which the mod
// never imports.  The mod's versions of those are the modules beside this
// one: engine.ts (files, processes and where things are), transcripts.ts
// (the main transcript's folds and the agents'), usage.ts (the usage
// source and the credits), calibration.ts (the window costs) and
// configuration.ts (the configuration files).  What they read this hands
// to src/claude.ts's statusFigures and costFigures, which draw the figures
// from it and read nothing themselves.
//
// The reads keep what they have read in memory between documents: a
// transcript is only ever appended to, so each document reads only the
// bytes past the last complete line it parsed before.
import type { EngineInterface } from 'claude-code'

import {
  _recordsOf, agentRecordsOf, backgroundTasks, EMPTY_TRANSCRIPT, endedTasks,
  pyJoin, readPayload, transcriptFinish, turnStartText,
} from '../src/claude_records.ts'
import type {
  AgentEta, AgentRec, Git, Payload, Rec, Transcript, Turn,
} from '../src/claude_records.ts'
import { githubRepo } from '../src/github.ts'
import { FABLE_WINDOW, WEEKLY_WINDOWS } from '../src/sources.ts'
import { drawnCredits } from '../src/credits.ts'
import {
  SPENDING_PREFIX, keptFor, keptSpending, measuredFall, nextBracket,
  nextSpell, payerOf, payingCredit, spendingKey, spendingOf, spendingStale,
} from '../src/spending.ts'
import { decodeTurn } from '../src/claude_cost.ts'
import { decodeLimits } from '../src/figures.ts'
import { pyFloat } from '../src/sources.ts'
import { isDict } from '../src/py.ts'
import { seedLimitsSnapshot } from '../src/claude_calib.ts'
import {
  baseLimits, costFigures, detectGit, sessionRate, statusFigures, windowFor,
} from '../src/claude.ts'
import type { RateSample } from '../src/claude.ts'
import type { Dict } from '../src/py.ts'
import { log } from './log.ts'
import {
  fileSize, found, listDir, readRange, runVia, steps, timed,
} from './engine.ts'
import type { Places } from './engine.ts'
import { agentReadings, foldOf, turnsVia } from './transcripts.ts'
import { creditsVia, preparedVia } from './usage.ts'
import { calibrationVia } from './calibration.ts'
import { agentsDoc } from './subagents.ts'
import { options } from './configuration.ts'

type $ = EngineInterface

/** What the session tells the mod that the status line's payload carries
 * and `$.session` does not, as handlers learn it: the model's effort, from
 * a turn's step. */
export type Seen = { effort: string }

export const seen: Seen = { effort: '' }
let samples: RateSample[] = []
/** The rate-limit kinds `$.session.usage()` named last, as logged; null
 * until the first, so a load logs them once. */
let seenKinds: string | null = null

// ════════════════════════════════════════════════════════════════════════════
// The documents.
// ════════════════════════════════════════════════════════════════════════════

/** The status line's payload, made from `$.session` and what the handlers
 * have seen, and read by readPayload as a payload on stdin is. */
export async function payloadOf($: $, transcript: string): Promise<{
  raw: Dict; payload: Payload }> {
  const cwd = await $.session.cwd()
  const root = await $.session.root()
  const model = await $.session.model()
  const id = await $.session.id()
  const usage = await $.session.usage()
  // The kinds of rate limit the session names, logged as the set changes,
  // so the log says which windows reach the mod: `rate limits: five_hour
  // seven_day seven_day_overage_included` where the Fable window does.
  const kinds = usage.rateLimits.map((r) => r.kind).join(' ')
  if (kinds !== seenKinds) {
    seenKinds = kinds
    await log($, 'rate limits: ' + (kinds || 'none'))
  }
  const limit = (kind: string) => {
    const l = usage.rateLimits.find((r) => r.kind === kind)
    if (!l) return undefined
    return { used_percentage: l.percentUsed, resets_at: l.resetsAt ?
      Date.parse(l.resetsAt) / 1000 : undefined }
  }
  const raw: Dict = {
    session_id: id,
    transcript_path: transcript,
    cwd,
    workspace: { current_dir: cwd, project_dir: root || cwd },
    model: { id: model, display_name: model },
    context_window: { context_window_size: usage.context.window },
    ...(usage.cost ? { cost: { total_cost_usd: usage.cost.usd } } : {}),
    ...(seen.effort ? { effort: { level: seen.effort } } : {}),
    rate_limits: { five_hour: limit('five_hour'),
      seven_day: limit('seven_day'),
      [FABLE_WINDOW]: limit(FABLE_WINDOW),
      ...Object.fromEntries(WEEKLY_WINDOWS.map(([, kind]) =>
        [kind, limit(kind)])) },
  }
  return { raw, payload: readPayload(JSON.stringify(raw)) }
}

/** The transcript's path: the file named for the session's id in one of
 * the projects directory's folders, '' where there is none.  The path is
 * kept for that id, and looked for again once the id moves on or the file
 * is gone from there: a session that leaves a worktree has its transcript
 * moved to the main checkout's folder. */
export async function transcriptPath($: $, places: Places):
  Promise<string> {
  const id = await $.session.id()
  let moved = ''
  if (found.path && found.session === id) {
    if (await fileSize($, found.path) !== null) return found.path
    moved = found.path
    found.path = ''
  }
  for (const p of await listDir($, places.projectsDir)) {
    if (p.kind !== 'dir') continue
    const path = pyJoin(pyJoin(places.projectsDir, p.name), id + '.jsonl')
    if (await fileSize($, path) !== null) {
      found.session = id
      found.path = path
      if (moved) await log($, 'transcript moved: ' + moved + ' -> ' + path)
      return path
    }
  }
  if (moved) await log($, 'transcript moved: ' + moved + ' -> none')
  return ''
}

/** The permission mode the transcript's newest record names, from its
 * last MODE_TAIL bytes: each prompt's record carries `permissionMode`.
 * undefined where none of them names one. */
export async function permissionModeOf($: $, path: string):
  Promise<string | undefined> {
  const size = await fileSize($, path)
  if (!size) return undefined
  const bytes = await readRange($, path, Math.max(0, size - MODE_TAIL), size)
  const text = new TextDecoder().decode(bytes)
  const all = [...text.matchAll(/"permissionMode":"(\w+)"/g)]
  return all.length ? all[all.length - 1][1] : undefined
}

// How far back from the transcript's end permissionModeOf looks.
const MODE_TAIL = 256 * 1024

/** How long the session's last main-thread turn ran, once it has
 * finished: the durationMs of the turn_duration record Claude Code writes
 * after a turn's records, the one its closing line is drawn with.  null
 * where a record that opens a turn (turnStartText) comes after the newest
 * one, a turn still running, or none is in the transcript's last
 * MODE_TAIL bytes. */
export async function lastFinishedMs($: $, path: string):
  Promise<number | null> {
  const size = await fileSize($, path)
  if (!size) return null
  const from = Math.max(0, size - MODE_TAIL)
  let bytes = await readRange($, path, from, size)
  // A line cut by the tail's start is not a record.
  if (from > 0) bytes = bytes.subarray(bytes.indexOf(10) + 1)
  return finishedMs(_recordsOf(bytes))
}

/** lastFinishedMs over `records`, the transcript's newest last. */
export function finishedMs(records: readonly Rec[]): number | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r.isSidechain === true) continue
    if (turnStartText(r) !== null) return null
    if (r.type === 'system' && r.subtype === 'turn_duration') {
      const ms = r.durationMs
      return typeof ms === 'number' && ms > 0 ? ms : null
    }
  }
  return null
}

/** detectGit through `$.process.run`, in the session's directory. */
async function gitVia($: $, cwd: string) {
  return detectGit(async (args) => {
    try {
      const r = await runVia($, ['git', '--no-optional-locks', ...args],
        { cwd, timeoutMs: 2_000 })
      return r.exitCode === 0 ? r.stdout.trim() : null
    } catch {
      return null
    }
  })
}

/** Each repository's address on GitHub, by its main root, as its `origin`
 * remote names it: null for a remote elsewhere or none.  Read once a
 * load. */
const githubKept = new Map<string, string | null>()

/** The address on GitHub of the repository `git` was read in, off its
 * `origin` remote (githubRepo); null outside git, or for a remote on no
 * GitHub. */
async function githubVia($: $, cwd: string, git: Git):
  Promise<string | null> {
  const root = git.main_root || git.toplevel
  if (!git.in_git || !root) return null
  if (!githubKept.has(root)) {
    let url: string | null = null
    try {
      const r = await runVia($, ['git', '--no-optional-locks', 'remote',
        'get-url', 'origin'], { cwd, timeoutMs: 2_000 })
      url = r.exitCode === 0 ? githubRepo(r.stdout) : null
    } catch {
      url = null
    }
    githubKept.set(root, url)
  }
  return githubKept.get(root)!
}

/** The zone the runtime draws its clocks in, as the document records it. */
export function localZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** statusFigures through `$`. */
export async function statusDoc($: $, places: Places): Promise<Dict> {
  for (const k of Object.keys(steps)) delete steps[k]
  const now = (await $.clock.now()) / 1000
  const path = await transcriptPath($, places)
  const { raw, payload } = await payloadOf($, path)
  let tr: Transcript = EMPTY_TRANSCRIPT
  let turns: Turn[] | null = null
  const fold = path ? await timed($, 'records', () => foldOf($, path)) : null
  if (path && fold) {
    const readings = await timed($, 'agents', () => agentReadings($, path))
    const etas: AgentEta[] = []
    const agents: AgentRec[] = agentRecordsOf(readings, null, etas)
    // A tool call still running counts to now: this is a live session.
    tr = await timed($, 'sum', async () =>
      transcriptFinish(fold.tr, agents, etas, now))
    turns = await timed($, 'turns', () =>
      turnsVia($, places, path, fold.tu, readings))
  }
  const prepared = await timed($, 'usage', () => preparedVia($, places, raw,
    payload.session_id, payload.model_id || payload.model, now))
  const o = options()
  const credits = o === null ? {} : await timed($, 'credits', () =>
    creditsVia($, places, now, o.account, o.credits.command))
  const snap = seedLimitsSnapshot(baseLimits(prepared), prepared.reading)
  const calib = await timed($, 'calib', () =>
    calibrationVia($, places, snap, now))
  // Decision 1: the main thread's own tokens, sampled in memory.
  const tokens = tr.own_tok_up === null ? null
    : tr.own_tok_up + tr.own_tok_down
  const [kept, rate] = sessionRate(samples, tokens, now)
  samples = kept
  const git = await timed($, 'git', () => gitVia($, payload.current_dir))
  const doc = statusFigures({ payload, transcript: tr, turns, git,
    prepared, snap, calib, now,
    tz: localZone(), rate })
  // The mod's alone too: where on GitHub the tree's 📦 🌿 🔀 link.
  const github = await githubVia($, payload.current_dir, git)
  // The mod's alone: the subagents and the progress updates the band's
  // tree draws (subagents.ts), and the main thread's open background
  // shells and Monitors, which it draws under 🧵, and the ones it last
  // closed, which it keeps drawn for `finished-linger`; and the home
  // folder, which a shell's toast draws as `~` in its output file.
  const ended = path && fold ? endedTasks(fold.tr.bgEnded) : []
  const agents = path && fold ? {
    ...await timed($, 'tree', () => agentsDoc($, path, tr,
      payload.current_dir, now, calib, snap)),
    main_background: backgroundTasks(fold.tr.background, fold.tr.bgInfo),
    ...ended.length ? { main_background_ended: ended } : {},
    home: places.home,
  } : null
  // And only when there are some: the credits the 💳 row draws, by the
  // option.
  const drawn = o === null ? [] : drawnCredits(credits.credits, o.credits,
    now)
  const spending = await spendingVia($, payload.session_id, doc, tr, turns,
    credits, now)
  return { ...doc, ...agents ? { agents } : {}, ...github ? { github } : {},
    ...drawn.length ? { credits: { drawn,
      original: o!.credits.original } } : {},
    ...spending ? { spending } : {} }
}

/** Drop from `$.store` each session's spending entry past keeping at `now`
 * (spendingStale): the entries of sessions that have ended.  Run as a
 * session starts. */
export async function pruneSpending($: $, now: number): Promise<void> {
  for (const key of await $.store.keys()) {
    if (key.startsWith(SPENDING_PREFIX) &&
        spendingStale(await $.store.get(key), now)) {
      await $.store.delete(key)
    }
  }
}

/** The document's `spending`: the pool paying for the session other than
 * the plan, by the session's credential, its plan windows and the kept
 * credits, and what the open turn, the main thread and the session have
 * spent of it (spending.ts); null while the plan pays.  The spell and the
 * first reading of the paying credit are kept in `$.state`, where a reload
 * of the mod finds them, and in `$.store` under the session's
 * spendingKey, where a restart or a `--resume` does when `$.state` holds
 * nothing of the session's; both are written only when they change. */
async function spendingVia($: $, session: string, doc: Dict, tr: Transcript,
  turns: readonly Turn[] | null, credits: Dict, now: number):
  Promise<Dict | null> {
  const on = (v: string | undefined): boolean =>
    v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
  const elsewhere = on(await $.env.get('CLAUDE_CODE_USE_BEDROCK')) ||
    on(await $.env.get('CLAUDE_CODE_USE_VERTEX'))
  const cred = { remote: on(await $.env.get('CLAUDE_CODE_REMOTE')),
    apiKey: !elsewhere && on(await $.env.get('ANTHROPIC_API_KEY')),
    elsewhere }
  const lim = decodeLimits(doc.limits)
  const owned = credits.credits
  const kind = payerOf(cred, [pyFloat(lim.session_pct),
    pyFloat(lim.weekly_pct)], owned, now)
  const held = keptSpending((await $.state.get(
    { plugin: 'usage-band', key: 'spending' })).value)
  const was = keptFor(held, session) ? held : keptSpending(
    await $.store.get(spendingKey(session)).catch(() => undefined))
  const asOf = typeof credits.as_of === 'number' ? credits.as_of : null
  // With no credits read yet, as just after a load, the kept spell stands:
  // the payer can't be told from the plan then.
  const spell = asOf === null && was.spell?.session === session
    ? was.spell : nextSpell(was.spell, session, kind, now)
  const credit = spell.kind === null ? null
    : payingCredit(spell.kind, owned, now)
  const bracket = nextBracket(was.bracket, session, credit, asOf)
  if (spell !== was.spell || bracket !== was.bracket) {
    await $.state.set({ plugin: 'usage-band', key: 'spending' },
      { spell, bracket })
    await $.store.set(spendingKey(session), { spell, bracket,
      saved_at: now }).catch((err) => log($, 'spending not kept', err))
  } else if (was !== held) {
    // Read back from the store: the in-session copy again.
    await $.state.set({ plugin: 'usage-band', key: 'spending' },
      { spell, bracket })
  }
  const acc = (doc.accounting as Dict | undefined)?.session
  const start = isDict(acc) && typeof acc.start_s === 'number'
    ? acc.start_s : null
  let open = null
  try {
    open = isDict(doc.open_turn) ? decodeTurn(doc.open_turn) : null
  } catch {
    open = null
  }
  return spendingOf(spell, open, tr === EMPTY_TRANSCRIPT ? null
    : tr.own_parts, turns, measuredFall(bracket, credit, asOf, start))
}

/** The session's turns as readTurns makes them from the transcript as it
 * stands, with the transcript's path; null with no transcript found.  No
 * settling wait: the receipt's stamp polls this until the newest prompt's
 * turn is billed. */
export async function turnsNow($: $, places: Places):
  Promise<{ path: string; turns: Turn[] } | null> {
  const path = await transcriptPath($, places)
  const fold = path ? await foldOf($, path) : null
  if (!path || !fold) return null
  return { path, turns: await turnsVia($, places, path, fold.tu,
    await agentReadings($, path)) }
}

/** costFigures through `$`, over turns turnsNow read.  `published` is the
 * band's last context window, as windowFor reads the status line's. */
export async function costDoc($: $, places: Places, path: string,
  turns: Turn[], published: number): Promise<Dict> {
  const now = (await $.clock.now()) / 1000
  const { raw, payload } = await payloadOf($, path)
  const prepared = await preparedVia($, places, raw, payload.session_id,
    payload.model_id || payload.model, now)
  const snap = seedLimitsSnapshot(baseLimits(prepared), prepared.reading)
  const calib = await calibrationVia($, places, snap, now)
  return costFigures(turns, windowFor(turns, published), calib, snap,
    prepared, now, localZone())
}

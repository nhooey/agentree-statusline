// The mod in the engine's test harness: each place it draws, from fixture
// transcripts, against the pure functions it draws with.
//
//   bash mod/tools/plugin-test.sh
//
// The harness runs the mod in its own runtime with nothing beneath it, so
// these tests stand for the engine, through `world` (mod-tests/world.ts).
// Each test then works out what the mod should have drawn from the same
// bytes, with the src/ functions alone and no `$`: the records parsed
// straight off the fixture, the reading straight off the tracker store,
// and the document, rows and spans from those.  The drawn text and each
// span's colour must match.  That proves the edges (that `$.fs` was read
// as the bytes are), the filing (the start line's trip through `$.store`)
// and the drawing (spans to Text); the documents themselves are proven
// against the Python's by test/claude.test.ts.  The receipt, which the mod
// writes rather than draws, is checked as the `$.ui.log` lines it sends,
// against receiptLines over the same bytes.
import { expect } from 'claude-code/testing'
import { BUDGET_MS, test } from './budget.ts'
import type { AgentInfo, On, RenderPropsOf } from 'claude-code'

import { CALIB, NOW, TRACKER } from './fixtures.gen.ts'
import { partOf, partOfRun } from '../hooks/engine.ts'
import { merge as mergeConfig, optionsOf } from '../src/config.ts'
import { DEFAULTS } from './defaults.ts'
import {
  CWD, HOME, MODEL, NO_GIT_HERE, SESSION, STATE, USER_FILE, USER_SETTINGS,
  WINDOW, world,
} from './world.ts'
import type { Ran, Run, World } from './world.ts'
import { partsOf, receiptKey, startKey } from '../hooks/register.tsx'
import { drawingNote, ioText } from '../hooks/profile.ts'
import { LOG_NAME } from '../hooks/log.ts'
import { CONFIG } from '../hooks/config.ts'

import {
  _readAgentBytes, _recordsOf, agentLabelOf, agentRecordsOf, foldAgentBytes,
  newAgentFold, readPayload, transcriptOf, turnsOf,
} from '../src/claude_records.ts'
import {
  agentFoldText, FOLD_CHECK_BYTES as AGENT_CHECK_BYTES, foldDir, slotNames,
  tailDigest,
} from '../src/agent_fold.ts'
import type { AgentEta, AgentReading } from '../src/claude_records.ts'
import {
  foldLoad, foldMain, foldMeta, foldSave, newMainFold, partName,
} from '../src/main_fold.ts'
import type { FoldMeta, MainFold } from '../src/main_fold.ts'
import { INBOX_SLOTS, inboxFoldDir, inboxFoldLoad } from '../src/inbox_fold.ts'
import { statePath } from '../src/state.ts'
import {
  _windowCostsFiles, _windowCostsText, seedLimitsSnapshot,
} from '../src/claude_calib.ts'
import {
  plistLoads, prepareClaudeReading, statusSourceContext, trackerReading,
} from '../src/claude_sources.ts'
import { trackerV1 } from '../src/sources.ts'
import type { Store } from '../src/sources.ts'
import {
  baseLimits, costFigures, statusFigures, windowFor,
} from '../src/claude.ts'
import { NO_GIT } from '../src/claude_records.ts'
import { settings, visWidth } from '../src/formatting.ts'
import {
  ROW_NAMES, accountLine, bandLines, bandRows, rootDrawn,
} from '../src/band.ts'
import {
  receiptLines, stampedOf, startLine, turnKey, withEngineDuration,
} from '../src/receipt.ts'
import type { Span } from '../src/spans.ts'
import * as spec from '../src/spec.ts'
import type { Dict } from '../src/py.ts'

const COLS = 150
// The options the mod draws with here: the user file over the defaults.
const OPTIONS = optionsOf(mergeConfig([{ name: 'user', path: USER_FILE,
  mtimeMs: 0, values: USER_SETTINGS }], [], DEFAULTS))
const HIDE = OPTIONS.hide
// When the band draws each row, and the rows the receipt stamps.
const LIVE = { turn: OPTIONS.rows.turn.live, agent: OPTIONS.rows.agent.live,
  session: OPTIONS.rows.session.live }
const STAMPED = ROW_NAMES.filter((r) => OPTIONS.rows[r].transcript)
// Where the band draws each row.
const PLACES = { turn: OPTIONS.rows.turn.place,
  agent: OPTIONS.rows.agent.place, session: OPTIONS.rows.session.place }
// When the band's tree draws the subagents, and how many at most.
const AGENTS = { agents: OPTIONS.rows.subagents.live,
  cap: OPTIONS.subagentRows }
// How far in every row starts, above the prompt, under the footer line and
// in the receipt.
const INSET = OPTIONS.hintInset
// The settings the band is drawn under: its right edge, right-edge,
// derived from rows.*.place, and the receipt's, which stacks on the band.
const BAND_ST = settings({}, OPTIONS.markSpacing, OPTIONS.subscriptDecimals,
  OPTIONS.rightEdge)
const encoder = new TextEncoder()

/** The band's rows as mountBand draws them: those rows.<row>.place puts
 * above the prompt, indented hint-inset columns, then those it puts under
 * the footer line, drawn hint-inset columns narrower there. */
function bandWant(st: ReturnType<typeof settings>, fig: Dict,
  opts: { rate: number | null; phase: 'running' | 'done';
    live: typeof LIVE }): Span[][] {
  return [
    ...bandLines(st, fig, COLS, HIDE, { ...opts, ...AGENTS, place: 'above',
      places: PLACES, indent: INSET }),
    ...bandLines(st, fig, COLS, HIDE, { ...opts, ...AGENTS, place: 'footer',
      places: PLACES, inset: INSET }),
  ]
}

/** The band in both its places, mounted: above the prompt, then under the
 * footer line, whose mount the band's own sets the width of first, as
 * Claude Code draws the two; drawn as one Box of the rows of both.  Under
 * the footer, the drawing leaves out Claude Code's own line, which comes
 * first, and the 💳 account's row under it, where it has one there. */
async function mountBand($: any, surface: 'terminal' | 'desktop',
  props: RenderPropsOf['AbovePrompt']) {
  const above = await $.ui.mount({ plugin: 'usage-band', surface,
    component: 'AbovePrompt', props })
  const hint = await $.ui.mount({ plugin: 'usage-band', surface,
    component: 'PromptHint', props: { isDraft: false,
      isWorking: props.isWorking, hint: '-- INSERT --' } })
  const rowsOf = (tree: Drawn | null, skip: number) => tree?.type === 'Box'
    ? (tree.children ?? []).slice(skip) : []
  // Claude Code's line, the blank row under it, then the 💳 row.
  const skip = OPTIONS.accountPlace === 'row' &&
    OPTIONS.rows.account.place === 'footer' ? 3 : 1
  return { above, hint, drawn: async () => ({ type: 'Box',
    children: [...rowsOf(await drawnOf(above), 0),
      ...rowsOf(await drawnOf(hint), skip)] }) }
}

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: COLS - 5,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}


// ════════════════════════════════════════════════════════════════════════════
// What the mod should draw, worked out without it.
// ════════════════════════════════════════════════════════════════════════════

function bytesOf(w: World, p: string): Uint8Array {
  return w.files.get(p)!
}

/** The agents beside a fixture transcript, read straight off its bytes. */
function readingsOf(w: World, transcript: string):
  [string, AgentReading][] {
  const dir = transcript.slice(0, -'.jsonl'.length) + '/'
  return [...w.files.keys()].filter((p) => p.startsWith(dir) &&
    /\/agent-[^/]*\.jsonl$/.test(p)).sort()
    .map((p) => [p, _readAgentBytes(bytesOf(w, p))])
}

function labelIn(w: World) {
  return (p: string): [string, string] => agentLabelOf(p,
    w.files.get(p.slice(0, -'.jsonl'.length) + '.meta.json') ?? null)
}

/** The tracker's reading as the mod's collector should come to it. */
async function preparedOf(now: number) {
  const store: Store = { load: () => ({}), save: () => {},
    findCompatible: () => ({}) }
  const spec = 'claude-usage-tracker'
  return prepareClaudeReading(spec, 'default', 'day',
    statusSourceContext(spec, SESSION, MODEL, now, {}), now, {}, store,
    async () => trackerV1(trackerReading(plistLoads(encoder.encode(TRACKER)))))
}

/** The status document from the fixture's bytes and the world's session. */
async function statusOf(w: World, transcript: string, rate: number | null) {
  const records = _recordsOf(bytesOf(w, transcript))
  const readings = readingsOf(w, transcript)
  const etas: AgentEta[] = []
  const tr = transcriptOf(records, agentRecordsOf(readings, null, etas), etas,
    NOW)
  const turns = turnsOf(records, (s) => agentRecordsOf(readings, s, null),
    null, new Map(), labelIn(w))
  const prepared = await preparedOf(NOW)
  const snap = seedLimitsSnapshot(baseLimits(prepared), prepared.reading)
  const payload = readPayload(JSON.stringify({ session_id: SESSION,
    transcript_path: transcript, cwd: CWD,
    workspace: { current_dir: CWD, project_dir: CWD },
    model: { id: MODEL, display_name: MODEL },
    context_window: { context_window_size: WINDOW } }))
  return statusFigures({ payload, transcript: tr, turns,
    git: { ...NO_GIT, in_git: false }, prepared, snap, calib: CALIB, now: NOW,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone, rate })
}

const text = (spans: readonly Span[]) => spans.map((s) => s.text).join('')

type Drawn = { type: string; props?: Record<string, unknown>;
  children?: (Drawn | string)[] }

/** What the mod drew in `ui`: Claude Code may hold the mod's drawing in a
 * Box of its own, beside empty Boxes, which is stepped through. */
async function drawnOf(ui: { drawn: () => Promise<unknown> }): Promise<Drawn> {
  let tree = await ui.drawn() as Drawn
  for (;;) {
    const kids = (tree?.type === 'Box' ? tree.children ?? [] : []).filter(
      (c) => typeof c === 'string' || c.type !== 'Box' || c.children?.length)
    const only = kids.length === 1 ? kids[0] : null
    if (only === null || typeof only === 'string' || only.type !== 'Box' ||
      only.props?.flexDirection === 'row') {
      return tree
    }
    tree = only
  }
}

/** Each row the mod drew, as its text and its spans' colours: the Texts
 * directly in the drawing's column, each of whose children is one span,
 * and the row Boxes of the band's tree, whose spans are the Texts of
 * strings in them (pressLine), in order: a span pressed in part is drawn
 * as the parts its press makes, as `expected` counts it. */
async function drawnRows(ui: { drawn: () => Promise<unknown> }) {
  const tree = await drawnOf(ui)
  if (tree.type !== 'Box') return []
  return (tree.children ?? []).filter((c): c is Drawn =>
    typeof c !== 'string' && (c?.type === 'Text' ||
      (c?.type === 'Box' && c.props?.flexDirection === 'row')))
    .map((row) => {
      const spans = leaves(row)
      return { text: spans.map((c) => (c.children ?? []).join('')).join(''),
        colours: spans.map((c) => c.props?.color ?? null) }
    })
}

/** The Texts of strings alone under `el`, in document order: a drawn
 * row's spans. */
function leaves(el: Drawn): Drawn[] {
  const kids = (el.children ?? []).filter((c): c is Drawn =>
    typeof c !== 'string')
  if (el.type === 'Text' && !kids.length) return [el]
  return kids.flatMap(leaves)
}

/** Where a prompt's turn tag was drawn: `beside` it on its row, or under
 * it on a line of its own, and the tag's text with its leading blanks. */
async function tagDrawn(ui: { drawn: () => Promise<unknown> }) {
  const tree = await drawnOf(ui)
  const spans = (row: Drawn) => ((row.children ?? []) as Drawn[])
    .map((c) => (c.children ?? []).join('')).join('')
  if (tree.props?.flexDirection === 'row') {
    const box = (tree.children ?? []).at(-1) as Drawn
    return { beside: true, text: spans((box.children ?? [])[0] as Drawn) }
  }
  const rows = await drawnRows(ui)
  return { beside: false, text: rows[rows.length - 1]?.text }
}

function expected(lines: readonly (readonly Span[])[], truecolor = false) {
  const named = truecolor ? spec.TRUE_COLOURS
    : spec as unknown as Record<string, string>
  return lines.map((l) => ({ text: text(l),
    colours: l.flatMap(partsOf).map((s) => s.colour ? named[s.colour]
      : null) }))
}

/** The status document the band draws: the last one filed. */
function lastDoc(w: World): Dict {
  expect(w.docs.length).toBeGreaterThan(0)
  return w.docs[w.docs.length - 1]
}

// ════════════════════════════════════════════════════════════════════════════
// The tests.
// ════════════════════════════════════════════════════════════════════════════

const STATUS = '/fixtures/transcripts/status/agents.jsonl'
const COST = '/fixtures/transcripts/cost/09-agents.jsonl'
const MAIN = '/fixtures/transcripts/status/main.jsonl'

/** The session's transcript where a live one is: named for the session's
 * id in `dir`, a folder of the projects directory, where the mod looks for
 * it.  A folder of a test's own keeps a path no other test reads. */
const sessionFile = (dir: string) => `/claude/projects/${dir}/${SESSION}.jsonl`

/** Copies the fixture transcript `from`, and the agents' files in the
 * folder beside it, to the transcript `to` and the folder beside that. */
function place(w: World, from: string, to: string) {
  const [a, b] = [from, to].map((p) => p.slice(0, -'.jsonl'.length) + '/')
  w.files.set(to, w.files.get(from)!)
  for (const [p, bytes] of [...w.files]) {
    if (p.startsWith(a)) w.files.set(b + p.slice(a.length), bytes)
  }
}

/** Starts the session on `transcript`, and gives the path the mod reads
 * it at: a fixture is first placed where the session's id puts it
 * (sessionFile), since the mod finds the transcript only there; a
 * transcript already there is read where it is. */
async function start($: any, w: World, surface: 'terminal' | 'desktop',
  transcript: string): Promise<string> {
  let path = transcript
  if (!transcript.startsWith('/claude/projects/')) {
    path = sessionFile('-work')
    place(w, transcript, path)
  }
  await $.session.start({ cwd: CWD, surface, isInteractive: true })
  await settle()
  return path
}

// The test's environment has timers, which the hooks' types leave out.
declare const setTimeout: (f: () => void, ms: number) => unknown

/** Lets the reads the session's and turns' hooks start, and do not wait
 * for, run to their end. */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(() => r(undefined), 0))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band is bandLines over the status document (${surface})`,
    async ($, on) => {
      const w = world(on)
      const path = await start($, w, surface, STATUS)
      const doc = lastDoc(w)
      // The edges read the fixture as its bytes are: the document is the
      // one made straight from them, and the mod's own `agents` beside it,
      // the subagents the band's tree draws.
      const want = await statusOf(w, path, doc.rate as number | null)
      const { agents, ...figures } = doc
      expect(JSON.parse(JSON.stringify(figures)))
        .toEqual(JSON.parse(JSON.stringify(want)))
      expect(Array.isArray((agents as Dict).tasks)).toBe(true)
      const ui = await mountBand($, surface, BAND)
      // Between turns the band draws nothing: the receipt has the rows.
      const lines = bandWant(BAND_ST, doc, {
        rate: null, phase: 'done', live: LIVE })
      expect(lines).toEqual([])
      expect(await drawnRows(ui)).toEqual([])
    })
}

test('a /resume in the running process starts the tick again for the ' +
  'resumed session', async ($, on) => {
    const w = world(on)
    await start($, w, 'terminal', STATUS)
    // The process switches sessions, with no session.start: the next
    // drawing of the band is the first the mod hears of it.
    const resumed = '/claude/projects/-work/resumed-session.jsonl'
    place(w, sessionFile('-work'), resumed)
    w.session.id = 'resumed-session'
    await mountBand($, 'terminal', BAND)
    await settle()
    expect(logOf(w)).toContain('started by ui.render')
    expect(JSON.stringify(lastDoc(w))).toContain(resumed)
    // And the tick reads on for it.
    const read = w.docs.length
    await w.clock.advance(31_000)
    await settle()
    expect(w.docs.length).toBeGreaterThan(read)
    expect(JSON.stringify(lastDoc(w))).toContain(resumed)
  })

test('the session\'s rate limits reach the 💳 row, the Fable window ' +
  'among them, and their kinds are logged once, then as they change',
  async ($, on) => {
    const w = world(on)
    w.files.set(CWD + '/.config/coding-agent-usage-line/config.local.jsonc',
      encoder.encode('{"usage-source": "native"}'))
    w.usage.rateLimits = [
      { kind: 'five_hour', percentUsed: 15,
        resetsAt: '2026-08-16T05:00:00+00:00' },
      { kind: 'seven_day', percentUsed: 87,
        resetsAt: '2026-08-18T01:00:00+00:00' },
      { kind: 'seven_day_overage_included', percentUsed: 12.5,
        resetsAt: '2026-08-19T01:00:00+00:00' }]
    await start($, w, 'terminal', STATUS)
    const limits = lastDoc(w).limits as Dict
    expect(String(limits.weekly_pct)).toMatch(/^87/)
    expect(String(limits.fable_pct)).toMatch(/^12\.5/)
    expect(limits.fable_reset).toBe(Date.parse('2026-08-19T01:00:00Z') / 1000)
    const line = 'rate limits: five_hour seven_day seven_day_overage_included'
    await w.clock.advance(31_000)
    await settle()
    expect(logOf(w).split(line).length - 1).toBe(1)
    // The Fable window gone: logged again, and no longer in the document.
    w.usage.rateLimits = w.usage.rateLimits.slice(0, 2)
    await w.clock.advance(31_000)
    await settle()
    expect(logOf(w)).toContain('rate limits: five_hour seven_day\n')
    expect((lastDoc(w).limits as Dict).fable_pct).toBe(null)
  })

test('under auto, with no native reading, the plan comes from the usage ' +
  'endpoint, asked as the session, once per 5 minutes for every session ' +
  'on the account, with plan-usage off', async ($, on) => {
    const w = world(on)
    w.files.set(CWD + '/.config/coding-agent-usage-line/config.local.jsonc',
      encoder.encode('{"usage-source": "auto", "plan-usage": false}'))
    w.files.set('/claude/.claude.json', encoder.encode(
      '{"oauthAccount": {"accountUuid": "0f0f0f0f-test-account"}}'))
    w.oauth.body = JSON.stringify({
      five_hour: { utilization: 18.0, resets_at: '2026-08-16T05:00:00+00:00' },
      seven_day: { utilization: 24.0, resets_at: '2026-08-18T01:00:00+00:00' },
      seven_day_overage_included: { utilization: 6.0,
        resets_at: '2026-08-19T01:00:00+00:00' },
      seven_day_opus: null })
    await start($, w, 'terminal', STATUS)
    expect(w.oauth.asked[0]).toEqual({
      url: 'https://api.anthropic.com/api/oauth/usage', auth: 'test-handle',
      headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    expect(String((lastDoc(w).limits as Dict).weekly_pct)).toMatch(/^24/)
    expect(String((lastDoc(w).limits as Dict).fable_pct)).toMatch(/^6/)
    // Read again within the 5 minutes: the cached reading, nothing asked.
    const asked = w.oauth.asked.length
    await w.clock.advance(31_000)
    await settle()
    expect(w.oauth.asked.length).toBe(asked)
    // Saved under the account, not the session.
    const saved = [...w.files.values()].map((b) => new TextDecoder().decode(b))
      .filter((t) => t.includes('"experimental-claude-oauth"'))
    expect(saved.length).toBe(1)
    expect(saved[0]).toContain('"account_name":"account:')
    // Another session on the account: the same reading, nothing asked.
    w.session.id = 'f1xture0-0000-4000-8000-00000000beef'
    await w.clock.advance(1_000)
    await settle()
    expect(w.oauth.asked.length).toBe(asked)
    expect(String((lastDoc(w).limits as Dict).weekly_pct)).toMatch(/^24/)
  })

/** A world under auto whose session names only the plan's week, at 87٪,
 * as Claude Code's does, with the usage endpoint answering `answer`. */
function planWorld(on: On, answer: Dict | null, settings = '{}'): World {
  const w = world(on)
  w.files.set(CWD + '/.config/coding-agent-usage-line/config.local.jsonc',
    encoder.encode(JSON.stringify({ 'usage-source': 'auto',
      ...JSON.parse(settings) })))
  w.usage.rateLimits = [{ kind: 'seven_day', percentUsed: 87,
    resetsAt: '2026-08-18T01:00:00+00:00' }]
  w.oauth.body = answer === null ? null : JSON.stringify(answer)
  return w
}

const PLAN_ANSWER: Dict = {
  five_hour: { utilization: 18.0, resets_at: '2026-08-16T05:00:00+00:00' },
  seven_day: { utilization: 24.0, resets_at: '2026-08-18T01:00:00+00:00' },
  seven_day_overage_included: { utilization: 6.0,
    resets_at: '2026-08-19T01:00:00+00:00' },
  seven_day_omelette: { utilization: 3.0,
    resets_at: '2026-08-19T01:00:00+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: null },
}

const PLAN_URL = 'https://api.anthropic.com/api/oauth/usage'

test('under plan-usage, the plan\'s windows are asked of the usage ' +
  'endpoint as the session once a minute, the Fable week among them, and ' +
  'drawn over Claude Code\'s own; their keys are logged once, then as ' +
  'they change', async ($, on) => {
    const w = planWorld(on, PLAN_ANSWER)
    await start($, w, 'terminal', STATUS)
    expect(w.oauth.asked).toEqual([{ url: PLAN_URL, auth: 'test-handle',
      headers: { 'anthropic-beta': 'oauth-2025-04-20' } }])
    await w.clock.advance(31_000)
    await settle()
    const limits = lastDoc(w).limits as Dict
    expect(String(limits.weekly_pct)).toMatch(/^24/)
    expect(String(limits.session_pct)).toMatch(/^18/)
    expect(String(limits.fable_pct)).toMatch(/^6/)
    // Every seven_day_* window with a utilization is kept, by its key.
    const kept = w.store.get('plan-usage:default') as Dict
    const ids = (((kept.reading as Dict).buckets as Dict[])[0]
      .windows as Dict[]).map((x) => x.id)
    expect(ids).toEqual(['five_hour', 'seven_day',
      'seven_day_overage_included', 'seven_day_omelette'])
    // Within the minute, nothing asked; after it, asked again.
    expect(w.oauth.asked.length).toBe(1)
    await w.clock.advance(31_000)
    await settle()
    expect(w.oauth.asked.length).toBe(2)
    const line = 'plan usage: five_hour seven_day seven_day_omelette ' +
      'seven_day_overage_included\n'
    expect(logOf(w).split(line).length - 1).toBe(1)
    // The keys alone, never a figure.
    expect(logOf(w)).not.toContain('utilization')
    // The Fable window gone from the answer: logged again.
    const { seven_day_overage_included: _, ...noFable } = PLAN_ANSWER
    w.oauth.body = JSON.stringify(noFable)
    await w.clock.advance(61_000)
    await settle()
    expect(logOf(w)).toContain(
      'plan usage: five_hour seven_day seven_day_omelette\n')
  })

for (const kind of ['none', 'api-key'] as const) {
  test(`plan-usage asks nothing of a session with ${kind === 'none'
    ? 'no first-party credential' : 'an API key'}`, async ($, on) => {
      const w = planWorld(on, kind === 'none' ? null : PLAN_ANSWER)
      if (kind === 'api-key') w.oauth.kind = 'api-key'
      await start($, w, 'terminal', STATUS)
      await w.clock.advance(61_000)
      await settle()
      expect(w.oauth.asked).toEqual([])
      expect(String((lastDoc(w).limits as Dict).weekly_pct)).toMatch(/^87/)
      expect(logOf(w)).not.toContain('plan usage')
    })
}

test('plan-usage off asks nothing, and draws Claude Code\'s own',
  async ($, on) => {
    const w = planWorld(on, PLAN_ANSWER, '{"plan-usage": false}')
    await start($, w, 'terminal', STATUS)
    await w.clock.advance(61_000)
    await settle()
    expect(w.oauth.asked).toEqual([])
    expect(String((lastDoc(w).limits as Dict).weekly_pct)).toMatch(/^87/)
  })

test('a failed plan-usage ask is logged once and waited out for 5 ' +
  'minutes, the last reading kept meanwhile', async ($, on) => {
    const w = planWorld(on, PLAN_ANSWER)
    await start($, w, 'terminal', STATUS)
    expect(w.oauth.asked.length).toBe(1)
    w.oauth.status = 503
    await w.clock.advance(61_000)
    await settle()
    expect(w.oauth.asked.length).toBe(2)
    const line = 'plan usage failed: HTTP 503\n'
    expect(logOf(w).split(line).length - 1).toBe(1)
    // The last reading, still fresh, is still drawn.
    expect(String((lastDoc(w).limits as Dict).fable_pct)).toMatch(/^6/)
    // Nothing asked for the 5 minutes after the failure.
    for (let i = 0; i < 4; i++) {
      await w.clock.advance(61_000)
      await settle()
    }
    expect(w.oauth.asked.length).toBe(2)
    // After them, asked again; the same failure is not logged again.
    await w.clock.advance(61_000)
    await settle()
    expect(w.oauth.asked.length).toBe(3)
    expect(logOf(w).split(line).length - 1).toBe(1)
  })

test('the credits are asked of the usage endpoint once per 5 minutes, ' +
  'kept under the signed-in account for the status line, and kept on a ' +
  'failed ask', async ($, on) => {
    const w = world(on)
    w.files.set('/claude/.claude.json', encoder.encode(
      '{"oauthAccount": {"accountUuid": "0f0f0f0f-test-account"}}'))
    const answer = (remaining: number) => JSON.stringify({
      cloud_credit: { limit_dollars: 250, used_dollars: 250 - remaining,
        remaining_dollars: remaining, resets_at: '2026-11-05T07:59:00Z' },
      extra_usage: { is_enabled: false, monthly_limit: null } })
    w.oauth.body = answer(4.5)
    await start($, w, 'terminal', STATUS)
    const kept = () => [...w.files.values()]
      .map((b) => new TextDecoder().decode(b))
      .filter((t) => t.includes('"source":"credits"'))
    const asks = () => w.oauth.asked.length
    expect(kept().length).toBe(1)
    expect(kept()[0]).toContain('"account_name":"account:')
    expect(kept()[0]).toContain('"period_start":"credits"')
    expect(kept()[0]).toContain('"kind":"cloud","remaining":4.5')
    expect(kept()[0]).not.toContain('extra_usage')
    // Drawn on the 💳 row by the default `credits`: a balance over $0.
    const drawn = (lastDoc(w).credits as Dict).drawn as Dict[]
    expect(drawn.map((d) => (d.credit as Dict).kind)).toEqual(['cloud'])
    expect(text(accountLine(BAND_ST, lastDoc(w), HIDE, 200, HOME)))
      .toContain('⛅ $4.5')
    // Within the 5 minutes, nothing asked.
    const asked = asks()
    await w.clock.advance(31_000)
    await settle()
    expect(asks()).toBe(asked)
    // After them, asked again, and the new figure kept.
    w.oauth.body = answer(3)
    await w.clock.advance(300_000)
    await settle()
    expect(asks()).toBeGreaterThan(asked)
    expect(kept()[0]).toContain('"remaining":3')
    // A failed ask keeps the last credits.
    w.oauth.body = 'not json'
    await w.clock.advance(301_000)
    await settle()
    expect(kept().length).toBe(1)
    expect(kept()[0]).toContain('"remaining":3')
  })

test('a credits ask that never answers holds no document, and no second ' +
  'ask starts behind it', async ($, on) => {
    const w = world(on)
    w.files.set('/claude/.claude.json', encoder.encode(
      '{"oauthAccount": {"accountUuid": "0f0f0f0f-test-account"}}'))
    w.oauth.body = '{}'
    w.oauth.hang = true
    await start($, w, 'terminal', STATUS)
    const credits = () => w.oauth.asked.filter((a) =>
      a.url === 'https://api.anthropic.com/api/oauth/usage').length
    const first = lastDoc(w)
    expect(first.credits).toBeUndefined()
    const asked = credits()
    expect(asked).toBeGreaterThan(0)
    await w.clock.advance(31_000)
    await settle()
    expect(lastDoc(w)).not.toBe(first)
    await w.clock.advance(300_000)
    await settle()
    expect(credits()).toBe(asked)
    expect(logOf(w)).not.toContain('still running after')
  })

test('a turn running draws the running phase', async ($, on) => {
  const w = world(on)
  await start($, w, 'terminal', STATUS)
  const doc = lastDoc(w)
  const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
  const lines = bandWant(BAND_ST, doc, {
    rate: null, phase: 'running', live: LIVE })
  expect(await drawnRows(ui)).toEqual(expected(lines))
  // No blank top row, where Claude Code's `[-]` would stand alone.
  expect((await drawnOf(ui.above)).props?.marginTop).toBeUndefined()
})

test('a running turn\'s ⌛ counts on while no record is written',
  async ($, on) => {
    const w = world(on)
    await start($, w, 'terminal', STATUS)
    const turnClock = async () => {
      const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
      const row = (await drawnRows(ui)).find((r) => r.text.includes('🎤'))
      return row?.text.match(/⌛ *(\S+)/)?.[1]
    }
    const before = await turnClock()
    await w.clock.advance(300_000)
    await settle()
    const after = await turnClock()
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
  })

test('each row is drawn in its place: the tree of 🎮, 🧵 and 🎤 above ' +
  'the prompt, 💳 alone under the footer line', async ($, on) => {
  const w = world(on)
  await start($, w, 'terminal', STATUS)
  const doc = lastDoc(w)
  const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
  const opts = { rate: null, phase: 'running' as const, live: LIVE,
    places: PLACES, ...AGENTS }
  const above = bandLines(BAND_ST, doc, COLS, HIDE,
    { ...opts, place: 'above', indent: INSET })
  const below = bandLines(BAND_ST, doc, COLS, HIDE,
    { ...opts, place: 'footer', inset: INSET })
  // 🎮, then 🧵, and under it 🎤 and the fixture's fork, ended this turn.
  expect([above.length, below.length]).toEqual([4, 0])
  expect(text(above[0])).toMatch(/^ *⊟ 🎮 📦/u)
  expect(text(above[1])).toMatch(/^ *╰⊟ 🧵/u)
  expect(text(above[2])).toMatch(/^ *   ├─ 🎤/u)
  expect(text(above[3])).toMatch(/^ *   ╰⊞ ✅ 1 done/u)
  expect(await drawnRows(ui.above)).toEqual(expected(above))
  // The 💳 row alone under the footer line, a row of its own by default,
  // without the 📦 🌿 🔀 the tree's root draws.
  const rooted = rootDrawn(OPTIONS.rows.session.place,
    OPTIONS.rows.session.live, 'running', HIDE)
  expect(rooted).toBe(true)
  const account = accountLine(BAND_ST, doc, HIDE, COLS - INSET, HOME, 0,
    rooted)
  expect(text(account)).toContain('💳')
  expect(await drawnRows(ui.hint)).toEqual(expected([account]))
  // All of them under the footer line, with every place "footer": the
  // band above the prompt is the engine's.
  w.files.set(CWD + '/.config/coding-agent-usage-line/config.local.jsonc',
    encoder.encode('{"rows": {"turn": {"place": "footer"}, ' +
      '"agent": {"place": "footer"}, "session": {"place": "footer"}, ' +
      '"subagents": {"live": "never"}}}'))
  await w.clock.advance(CONFIG.tickMs)
  await settle()
  const footed = await mountBand($, 'terminal', { ...BAND, isWorking: true })
  expect(await footed.above.find({ type: 'Text' })).toBeUndefined()
  expect((await drawnRows(footed)).length).toBe(3)
  expect(logOf(w)).toContain('right-edge 2 (derived)')
})

/** Where withShell's shell writes its output. */
const SHELL_OUTPUT = '/private/tmp/claude-501/p/tasks/bsh1.output'

/** The session file with a background shell the main thread opened,
 * `bsh1` labelled `Build the docs` and started at `stamp`, its call's
 * result naming SHELL_OUTPUT, and with `monitor` a Monitor after it,
 * `mon1`, labelled `Watch the CI checks` and started at `monitor`, an
 * event's notification naming its output file under HOME, placed as the
 * status line's; its path. */
function withShell(w: World, stamp: string, monitor?: string): string {
  const path = sessionFile('-shell')
  place(w, STATUS, path)
  const call = (ts: string, id: string, name: string, input: Dict) => ({
    type: 'assistant', timestamp: ts, message: { id: 'req-' + id,
      content: [{ type: 'tool_use', id, name, input }] } })
  const result = (ts: string, id: string, res: Dict, content = '') => ({
    type: 'user', timestamp: ts, message: { content: [
      { type: 'tool_result', tool_use_id: id, content }] },
    toolUseResult: res })
  const records = [
    call(stamp, 'tu-bg', 'Bash', { command: 'make docs\n  && open site',
      description: 'Build the docs', run_in_background: true }),
    result(stamp, 'tu-bg', { backgroundTaskId: 'bsh1' },
      'Command running in background with ID: bsh1. Output is being ' +
      'written to: ' + SHELL_OUTPUT + '. You will be notified when it ' +
      'completes.'),
    ...(monitor === undefined ? [] : [
      call(monitor, 'tu-mon', 'Monitor', { command: 'make watch',
        description: 'Watch the CI checks' }),
      result(monitor, 'tu-mon', { taskId: 'mon1', timeoutMs: 300_000 },
        'Monitor started (task mon1).'),
      { type: 'user', timestamp: monitor, message: { content:
        '<task-notification><task-id>mon1</task-id><output-file>' + HOME +
        '/tasks/mon1.output</output-file><event>green</event>' +
        '</task-notification>' } }]),
  ]
  const extra = encoder.encode(records
    .map((r) => JSON.stringify(r) + '\n').join(''))
  const was = w.files.get(path)!
  const bytes = new Uint8Array(was.length + extra.length)
  bytes.set(was)
  bytes.set(extra, was.length)
  w.files.set(path, bytes)
  return path
}

test('the main thread\'s open background shell is in the document and ' +
  'drawn under 🧵, labelled by its call', async ($, on) => {
  const w = world(on)
  const stamp = '2026-08-16T01:44:00Z'
  const path = withShell(w, stamp)
  await start($, w, 'terminal', path)
  expect((lastDoc(w).agents as Dict).main_background).toEqual([
    { id: 'bsh1', kind: 'bash', label: 'Build the docs',
      start: Date.parse(stamp) / 1000, command: 'make docs ⏎ && open site',
      output: SHELL_OUTPUT }])
  const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
  const rows = (await drawnRows(ui.above)).map((r) => r.text)
  expect(rows.some((r) => /^ *   [├╰]─ 💻🟢 Build the docs /u.test(r)))
    .toBe(true)
})

test('a shell that closed stays drawn, ended, for finished-linger, and ' +
  'goes when it runs out with no read in between', async ($, on) => {
  const w = world(on)
  const path = withShell(w, '2026-08-16T01:44:00Z')
  // Its closing notification, 2 s before the clock's now.
  const close = JSON.stringify({ type: 'user',
    timestamp: new Date((NOW - 2) * 1000).toISOString(),
    message: { content: '<task-notification><task-id>bsh1</task-id>' +
      '<status>completed</status></task-notification>' } }) + '\n'
  const was = w.files.get(path)!
  const extra = encoder.encode(close)
  const bytes = new Uint8Array(was.length + extra.length)
  bytes.set(was)
  bytes.set(extra, was.length)
  w.files.set(path, bytes)
  await start($, w, 'terminal', path)
  const agents = lastDoc(w).agents as Dict
  expect(agents.main_background).toEqual([])
  expect(agents.main_background_ended).toEqual([{ id: 'bsh1', kind: 'bash',
    label: 'Build the docs', start: Date.parse('2026-08-16T01:44:00Z') / 1000,
    command: 'make docs ⏎ && open site', output: SHELL_OUTPUT,
    end: NOW - 2 }])
  const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
  const shell = async () => (await drawnRows(ui.above))
    .some((r) => /💻⚫ Build the docs/u.test(r.text))
  expect(await shell()).toBe(true)
  // The clock alone moves it on: no document is read before it goes.
  const docs = w.docs.length
  await w.clock.advance(4_000)
  await settle()
  expect(w.docs.length).toBe(docs)
  expect(await shell()).toBe(false)
})

/** Each mark in `row`, a drawn row standing `from` columns in from the
 * terminal's left edge, by the terminal column it starts on; a mark drawn
 * twice is left out. */
function markColumns(row: string, from: number): Map<string, number> {
  const out = new Map<string, number>()
  const twice = new Set<string>()
  let col = from
  for (const ch of Array.from(row)) {
    if (/\p{Extended_Pictographic}/u.test(ch)) {
      if (out.has(ch)) twice.add(ch)
      out.set(ch, col)
    }
    col += visWidth(ch, BAND_ST.widths)
  }
  for (const ch of twice) out.delete(ch)
  return out
}

for (const cols of [80, 120, 160]) {
  test(`🎮 and 🧵 in the tree above the prompt put each cell on one ` +
    `column (${cols} columns)`, async ($, on) => {
    const w = world(on)
    await start($, w, 'terminal', STATUS)
    const ui = await mountBand($, 'terminal',
      { ...BAND, isWorking: true, bodyColumns: cols - 5 })
    const above = await drawnRows(ui.above)
    const session = above.find((r) => r.text.includes('🎮'))
    const main = above.find((r) => r.text.includes('🧵'))
    expect(session).toBeDefined()
    expect(main).toBeDefined()
    // The tree's lines are in the labels, so every cell keeps its column
    // at every depth.
    const up = markColumns(session!.text, 0)
    const down = markColumns(main!.text, 0)
    const shared = [...up.keys()].filter((m) => down.has(m) &&
      !['🎮', '🧵', '📨', '📦', '🌿', '🟢'].includes(m))
    expect(shared.length).toBeGreaterThan(1)
    for (const m of shared) expect([m, up.get(m)]).toEqual([m, down.get(m)])
    // Both rows end on one column, the grid's right end.
    expect(visWidth(session!.text.trimEnd(), BAND_ST.widths))
      .toBe(visWidth(main!.text.trimEnd(), BAND_ST.widths))
  })
}

test('where Claude Code draws true colour the band draws the true set',
  async ($, on) => {
    const w = world(on, undefined, false, true,
      { TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    await start($, w, 'terminal', STATUS)
    const doc = lastDoc(w)
    const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
    const lines = bandWant(BAND_ST, doc, {
      rate: null, phase: 'running', live: LIVE })
    const rows = await drawnRows(ui)
    expect(rows).toEqual(expected(lines, true))
    expect(rows).not.toEqual(expected(lines))
  })

for (const tmux of [
  { TMUX: '/tmp/t,1,0', TERM: 'screen-256color' } as Record<string, string>,
  { TMUX: '/tmp/t,1,0', TERM: 'tmux-256color', COLORTERM: 'truecolor' },
]) test('under tmux the band draws the 256 set: ' + tmux.TERM,
  async ($, on) => {
    const w = world(on, undefined, false, true, tmux)
    await start($, w, 'terminal', STATUS)
    const doc = lastDoc(w)
    const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
    // tmux's own profile, which pads its marks.
    const st = settings(tmux, OPTIONS.markSpacing, OPTIONS.subscriptDecimals,
      OPTIONS.rightEdge)
    expect(st.truecolor).toBe(false)
    const lines = bandWant(st, doc, {
      rate: null, phase: 'running', live: LIVE })
    expect(await drawnRows(ui)).toEqual(expected(lines))
  })

test('a survey above the prompt leaves the band to the engine',
  async ($, on) => {
    const w = world(on)
    await start($, w, 'terminal', STATUS)
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
  })

/** The closing line as the mod draws it: one row high, a space and no
 * more, with no `✻ <word> for` and no tag. */
async function blankClosing($: any, word: string, durationMs: number) {
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'TurnDuration', props: { word, durationMs },
    viewport: { columns: COLS, rows: 40 } })
  const tree = await ui.drawn() as Drawn
  expect(tree.type).toBe('Box')
  expect(tree.props?.height).toBe(1)
  const rows = (tree.children ?? []) as Drawn[]
  expect(rows.length).toBe(1)
  expect(rows[0].type).toBe('Text')
  expect(rows[0].children).toEqual([' '])
}

test('a turn ends on a blank closing line', async ($, on) => {
  const w = world(on)
  await start($, w, 'terminal', COST)
  await $.turn.complete({ answer: '', durationMs: 65_000,
    isAborted: false, turnId: 't1', reason: 'answer' })
  await settle()
  await blankClosing($, 'Worked', 65_000)
})

/** A composer prompt's row drawn, as its instance `requestId`. */
async function drawPrompt($: any, text: string, requestId: string) {
  await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'UserMessage', requestId, props: { text,
      isExpanded: false, origin: { kind: 'composer' } } })
}

/** The footer line as drawn while a turn runs. */
async function footer($: any) {
  return $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'PromptHint', props: { isDraft: false, isWorking: true,
      hint: '-- INSERT --' } })
}

test('above the prompt the rows are plain, and the band logs its widths ' +
  'and its survey', async ($, on) => {
    const w = world(on)
    await start($, w, 'terminal', STATUS)
    await drawPrompt($, 'Go on.', 'prompt-1')
    await $.turn.start({ text: 'Go on.', turnId: 't3' })
    await settle()
    const viewport = { columns: COLS, rows: 40, isFullscreen: false }
    const band = await $.ui.mount({ plugin: 'usage-band',
      surface: 'terminal', component: 'AbovePrompt', viewport,
      props: { ...BAND, isWorking: true } })
    // Above the prompt the tree's fold marks and 🧵's and 🎤's labels
    // take a press, each a plain Button with no hotkey; no row under the
    // footer line takes one.
    const buttons = await band.findAll({ type: 'Button' })
    expect(buttons.map((b) => b.key).sort()).toEqual(['fold:main',
      'fold:main/done', 'fold:session', 'view:main', 'view:turn'])
    expect(buttons.every((b) => b.props?.plain === true &&
      b.props?.hotkey === undefined)).toBe(true)
    expect(await (await footer($)).findAll({ type: 'Button' })).toEqual([])
    expect(logOf(w)).toContain('band: {"bodyColumns":' + (COLS - 5) +
      ',"viewportColumns":' + COLS + ',"isFullscreen":false,' +
      '"hasSurvey":false}')
    // A survey: the band is the engine's, the log says so once, and the
    // footer drawn under it says so too.
    for (let i = 0; i < 2; i++) {
      const held = await $.ui.mount({ plugin: 'usage-band',
        surface: 'terminal', component: 'AbovePrompt', viewport,
        props: { ...BAND, isWorking: true, hasSurvey: true } })
      expect(await held.find({ type: 'Text' })).toBeUndefined()
    }
    expect(logOf(w).split('"hasSurvey":true}').length).toBe(2)
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'PromptHint', viewport, props: { isDraft: false,
        isWorking: true, hint: '-- INSERT --' } })
    expect(logOf(w)).toMatch(/footer: \[.*,false,true\]/)
  })

/** Starts the session on STATUS and opens a turn with the prompt "Go on.",
 * its record in the transcript as the turn opens: the status document
 * read then, the start line drawn from it, and the prompt's row as the
 * composer's UserMessage draws it. */
async function promptTagged($: any, w: World) {
  const path = await start($, w, 'terminal', STATUS)
  const prompt = JSON.stringify({ message: { content: 'Go on.' },
    promptId: 'p-next', promptSource: 'typed',
    timestamp: '2026-08-16T08:20:00Z', type: 'user',
    userType: 'external' }) + '\n'
  const before = w.files.get(path)!
  const grown = new Uint8Array(before.length + prompt.length)
  grown.set(before)
  grown.set(encoder.encode(prompt), before.length)
  w.files.set(path, grown)
  await $.turn.start({ text: 'Go on.', turnId: 't3' })
  await settle()
  const doc = lastDoc(w)
  expect((doc.transcript as Dict).prompt_id).toBe('p-next')
  const tag = startLine(BAND_ST, doc, HIDE)
  expect(tag.length).toBeGreaterThan(0)
  const typed = await $.ui.mount({ plugin: 'usage-band',
    surface: 'terminal', component: 'UserMessage',
    props: { text: 'Go on.', isExpanded: false,
      origin: { kind: 'composer' } } })
  return { doc, tag, typed }
}

test('a prompt from the composer gets its turn tag under it, at no indent',
  async ($, on) => {
    const w = world(on)
    const { tag, typed } = await promptTagged($, w)
    // The account's limits as the turn started, 🪫 alone: the user file
    // hides 🔋 on every scope, `*.plan.five_hour`.
    expect(text(tag)).toContain('p-next  ' + spec.E_ACCT + ' ' +
      spec.E_WEEK + '  63' + spec.E_PCT + '  ' + spec.E_DATE)
    expect(text(tag)).not.toContain(spec.E_SESS)
    // A short prompt has it on a line of its own too, so its 🔻🔖 stacks
    // with the receipt's 🔺🔖, both at no indent.
    expect(await tagDrawn(typed)).toEqual({ beside: false,
      text: text(tag) })
    const other = await $.ui.mount({ plugin: 'usage-band',
      surface: 'terminal', component: 'UserMessage',
      props: { text: 'Go on.', isExpanded: false,
        origin: { kind: 'unclassified' } } as any })
    expect(await drawnRows(other)).toEqual([])
  })

/** Appends `records` to the transcript at `path`, a line each. */
function append(w: World, path: string, records: readonly Dict[]) {
  const more = encoder.encode(records.map((r) => JSON.stringify(r) + '\n')
    .join(''))
  const before = w.files.get(path)!
  const grown = new Uint8Array(before.length + more.length)
  grown.set(before)
  grown.set(more, before.length)
  w.files.set(path, grown)
}

test('🎮 draws the session\'s name off its transcript in its colour, the ' +
  'name /rename wrote last winning', async ($, on) => {
  const w = world(on)
  const path = await start($, w, 'terminal', STATUS)
  const tree = () => bandLines(BAND_ST, lastDoc(w), COLS, HIDE,
    { rate: null, phase: 'running', live: LIVE, places: PLACES, ...AGENTS,
      place: 'above', indent: INSET })
  // No name written yet: no 📛.
  expect(text(tree()[0])).not.toContain(spec.E_NAME)
  append(w, path, [
    { type: 'agent-name', agentName: 'Worker', sessionId: SESSION },
    { type: 'custom-title', customTitle: 'Statusline', sessionId: SESSION },
    { type: 'agent-color', agentColor: 'purple', sessionId: SESSION }])
  await $.turn.start({ text: 'Go on.', turnId: 't3' })
  await settle()
  expect(lastDoc(w).transcript).toMatchObject({ session_name: 'Statusline',
    session_color: 'purple' })
  const root = tree()[0]
  expect(text(root)).toMatch(/^ *⊟ 🎮 📛Statusline 📦/u)
  expect(root.find((s) => s.text.includes('Statusline'))!.colour)
    .toBe('F_PUR')
  append(w, path, [
    { type: 'custom-title', customTitle: 'Renamed', sessionId: SESSION }])
  await w.clock.advance(CONFIG.tickMs)
  await settle()
  expect(text(tree()[0])).toMatch(/^ *⊟ 🎮 📛Renamed 📦/u)
  expect(text(bandLines(BAND_ST, lastDoc(w), COLS,
    [...HIDE, 'session.workspace.name'], { rate: null, phase: 'running',
      live: LIVE, places: PLACES, ...AGENTS, place: 'above',
      indent: INSET })[0])).not.toContain(spec.E_NAME)
})

test('a turn started with no plan reading has no 💳 on its tag',
  async ($, on) => {
    const w = world(on)
    // The tracker's store gone: the usage source has no reading.
    w.files.delete('/tracker.plist')
    const { doc, tag, typed } = await promptTagged($, w)
    expect((doc.limits as Dict).weekly_pct ?? null).toBe(null)
    expect(text(tag)).toContain('p-next  ' + spec.E_DATE)
    expect(text(tag)).not.toContain(spec.E_ACCT)
    expect(await tagDrawn(typed)).toEqual({ beside: false,
      text: text(tag) })
  })


test('a transcript over 4 MiB is read in pieces through the shell',
  async ($, on) => {
    // The shell's `tail -c +N | head -c L | base64`, over the world's
    // files: what readRange asks for a file `$.fs.read` will not take.
    const ranged: string[] = []
    const w: World = world(on, (e) => {
      const [cmd, , script, , from, file, want] = e.argv
      if (cmd !== '/bin/sh' || !script.includes('base64')) return NO_GIT_HERE
      ranged.push(from)
      const f = w.files.get(file)!
      const piece = f.subarray(Number(from) - 1,
        Number(from) - 1 + Number(want))
      let s = ''
      for (const b of piece) s += String.fromCharCode(b)
      return { ...NO_GIT_HERE, exitCode: 0, stdout: btoa(s) + '\n',
        stderr: '' }
    })
    // main.jsonl's records again and again past the limit: the requests
    // repeat, so the reading is the one copy's, read through every piece.
    const one = w.files.get(MAIN)!
    const copies = Math.ceil((4.5 * 1024 * 1024) / one.length)
    const big = new Uint8Array(one.length * copies)
    for (let i = 0; i < copies; i++) big.set(one, i * one.length)
    w.files.set(MAIN, big)
    const path = await start($, w, 'terminal', MAIN)
    expect(ranged.length).toBeGreaterThan(1)
    const { agents: _, ...doc } = lastDoc(w)
    const want = await statusOf(w, path, doc.rate as number | null)
    expect(JSON.parse(JSON.stringify(doc)))
      .toEqual(JSON.parse(JSON.stringify(want)))
  })

// With no calibration yet, a document starts the scan behind it, which
// writes the window-cost cache the Python shares, in window_costs_text's
// bytes, through the shell: a temporary file renamed over it, never
// `$.fs.write`, which a reader can see torn.
test('a scan writes the shared window-cost cache through a rename',
  async ($, on) => {
    const costs = statePath(STATE, 'window-costs')
    const viaShell: string[] = []
    const w: World = world(on, (e) => {
      const [cmd, , script, , path] = e.argv
      if (cmd !== '/bin/sh' || !script.includes('mv -f')) return NO_GIT_HERE
      viaShell.push(path)
      w.files.set(path, encoder.encode(e.init?.stdin ?? ''))
      return { ...NO_GIT_HERE, exitCode: 0, stderr: '' }
    }, false, false)
    const path = '/claude/projects/-work/scanned.jsonl'
    const bytes = w.files.get(MAIN)!
    w.files.set(path, bytes)
    await start($, w, 'terminal', MAIN)
    for (let i = 0; i < 20 && !w.files.has(costs); i++) await settle()
    expect(viaShell).toEqual([costs])
    const text = new TextDecoder().decode(w.files.get(costs)!)
    const files = _windowCostsFiles(text)!
    expect(_windowCostsText(files)).toBe(text)
    expect(files[path].off).toBe(bytes.lastIndexOf(10) + 1)
    expect(files[path].recs.length).toBeGreaterThan(0)
  })

// A scan reads each transcript once, its kept digest checked from the same
// read; a later scan reads no transcript whose size and mtime are as they
// were, and one appended to once, from before its kept offset.
test('a scan reads a transcript once, and a rescan only one that changed',
  async ($, on) => {
    const costs = statePath(STATE, 'window-costs')
    const w: World = world(on, (e) => {
      const [cmd, , script, , path] = e.argv
      if (cmd !== '/bin/sh' || !script.includes('mv -f')) return NO_GIT_HERE
      w.files.set(path, encoder.encode(e.init?.stdin ?? ''))
      return { ...NO_GIT_HERE, exitCode: 0, stderr: '' }
    }, false, false)
    const path = '/claude/projects/-work/rescanned.jsonl'
    const bytes = w.files.get(MAIN)!
    w.files.set(path, bytes)
    const of = (p: string) => w.reads.filter((r) => r === p).length
    const scans = () => w.lists.filter((p) => p === '/claude/projects').length
    const rescan = async () => {
      const was = scans()
      await w.clock.advance(301_000)
      for (let i = 0; i < 20 && scans() === was; i++) await settle()
      await settle()
      expect(scans()).toBeGreaterThan(was)
    }
    await start($, w, 'terminal', MAIN)
    for (let i = 0; i < 20 && !w.files.has(costs); i++) await settle()
    expect(of(path)).toBe(1)
    await rescan()
    expect(of(path)).toBe(1)
    // Appended to: read once more, and its records read on from the end.
    const more = new Uint8Array(bytes.length * 2)
    more.set(bytes)
    more.set(bytes, bytes.length)
    w.files.set(path, more)
    await rescan()
    expect(of(path)).toBe(2)
    const files = _windowCostsFiles(new TextDecoder()
      .decode(w.files.get(costs)!))!
    expect(files[path].off).toBe(more.lastIndexOf(10) + 1)
  })

// A load's first scan, with the shared window-cost cache on disk: a file
// the cache holds to its end, last written before the cache was, is not
// read; one written since is, as is one the cache holds only part of.
test('a load\'s first scan reads no file the cost cache holds whole',
  async ($, on) => {
    const costs = statePath(STATE, 'window-costs')
    const w: World = world(on, (e) => {
      const [cmd, , script, , path] = e.argv
      if (cmd !== '/bin/sh' || !script.includes('mv -f')) return NO_GIT_HERE
      w.files.set(path, encoder.encode(e.init?.stdin ?? ''))
      return { ...NO_GIT_HERE, exitCode: 0, stderr: '' }
    }, false, false)
    const main = w.files.get(MAIN)!
    const bytes = main.subarray(0, main.lastIndexOf(10) + 1)
    const held = '/claude/projects/-work/held-whole.jsonl'
    const since = '/claude/projects/-work/written-since.jsonl'
    const part = '/claude/projects/-work/held-in-part.jsonl'
    for (const p of [held, since, part]) w.files.set(p, bytes)
    const kept = { off: bytes.length, tail: null, recs: [] }
    w.files.set(costs, encoder.encode(_windowCostsText({ [held]: kept,
      [since]: kept, [part]: { ...kept, off: bytes.length - 1 } })))
    w.mtimes.set(costs, NOW * 1000)
    w.mtimes.set(held, NOW * 1000 - 60_000)
    w.mtimes.set(part, NOW * 1000 - 60_000)
    w.mtimes.set(since, NOW * 1000 + 1)
    const of = (p: string) => w.reads.filter((r) => r === p).length
    await start($, w, 'terminal', MAIN)
    for (let i = 0; i < 20 && of(since) === 0; i++) await settle()
    await settle()
    expect(of(held)).toBe(0)
    expect(of(since)).toBe(1)
    expect(of(part)).toBe(1)
  })

// What an idle refresh, with nothing written since the last, asks of the
// engine: no transcript, agent file or project file read, no process
// started, and a handful of small reads; a calibration scan due behind
// it lists the projects and reads none of their unchanged files.  The
// budget is the count of each, so a new idle cost fails here rather than
// being found on a CPU meter.
test('an idle refresh reads no transcript and starts no process',
  async ($, on) => {
    const w: World = world(on)
    const scanned = '/claude/projects/-work/idle-scanned.jsonl'
    w.files.set(scanned, w.files.get(MAIN)!)
    const path = await start($, w, 'terminal', STATUS)
    // Two refreshes in, so the first reads of everything are done, and
    // the calibration due once its 5 minutes are up has run once.
    for (const ms of [31_000, 301_000]) {
      await w.clock.advance(ms)
      await settle()
    }
    const idle = async (ms: number) => {
      const at = { reads: w.reads.length, lists: w.lists.length,
        runs: w.runs.length, docs: w.docs.length }
      await w.clock.advance(ms)
      await settle()
      expect(w.docs.length).toBeGreaterThan(at.docs)
      return { reads: w.reads.slice(at.reads), lists: w.lists.slice(at.lists),
        runs: w.runs.slice(at.runs).map((a) => a[0] === 'git' ? 'git'
          : a.join(' ')) }
    }
    const notGit = (runs: string[]) => runs.filter((r) => r !== 'git')
    // An idle refresh: the session's git, and nothing else started.
    const plain = await idle(31_000)
    expect(plain.reads.filter((p) => p.endsWith('.jsonl'))).toEqual([])
    expect(notGit(plain.runs)).toEqual([])
    expect(plain.runs.length).toBeLessThanOrEqual(2)
    // The state files the document is made from, each a few KiB: 6 today.
    expect(plain.reads.every((p) => p.startsWith('/state/') ||
      p === '/tracker.plist')).toBe(true)
    expect(plain.reads.length).toBeLessThanOrEqual(8)
    expect(plain.lists.length).toBeLessThanOrEqual(6)
    expect(path).toContain('/claude/projects/')
    // One with a calibration scan due: the projects listed, none of their
    // unchanged files read, and the shared cost cache, unchanged, not
    // written again.
    const scan = await idle(301_000)
    expect(scan.reads.filter((p) => p.endsWith('.jsonl'))).toEqual([])
    expect(scan.lists).toContain('/claude/projects')
    expect(notGit(scan.runs)).toEqual([])
  })

// The heavy lines name what cost what: each read and process counted under
// the part its path serves, the parts listed costliest first, and a
// minute's drawing logged only past CONFIG.drawNoteMs, its components
// costliest first.
test('the heavy lines split the cost by part and by component', () => {
  expect(partOf('/p/-work/s/subagents/agent-a.jsonl')).toBe('agents')
  expect(partOf('/p/-other/other-session.jsonl')).toBe('scan')
  expect(partOf('/state/claude-window-costs-x.cache')).toBe('files')
  expect(partOfRun(['/bin/sh', '-c', 'tail', 'sh', '1',
    '/p/-other/big.jsonl', '4096'])).toBe('scan')
  expect(partOfRun(['git', 'rev-parse'])).toBe('git')
  expect(partOfRun(['/bin/rm', '-f', '--', '/state/old'])).toBe('sweep')
  const c = (reads: number, mib: number, spawns: number) =>
    ({ reads, readBytes: mib * 1048576, lists: 0, spawns })
  expect(ioText({ ...c(150, 180, 273), parts: { files: c(3, 0, 0),
    scan: c(147, 180, 273) } })).toBe('since the last refresh: 150 reads, ' +
    '180.0 MiB, 0 listings, 273 processes; scan: 147 reads, 180.0 MiB, ' +
    '0 listings, 273 processes; files: 3 reads, 0.0 MiB, 0 listings, ' +
    '0 processes')
  const cheap = CONFIG.drawNoteMs / 2
  expect(drawingNote([['AbovePrompt', { draws: 60, ms: cheap }]], 1))
    .toBeNull()
  expect(drawingNote([['UserMessage', { draws: 900, ms: 300 }],
    ['AbovePrompt', { draws: 60, ms: CONFIG.drawNoteMs }]], 1))
    .toBe(`heavy drawing: ${CONFIG.drawNoteMs + 300}ms in 1.0 min ` +
      `(AbovePrompt 60 draws ${CONFIG.drawNoteMs}ms, ` +
      'UserMessage 900 draws 300ms)')
})

// ════════════════════════════════════════════════════════════════════════════
// The folds saved, and a reload reading on from them.
// ════════════════════════════════════════════════════════════════════════════

/** A transcript of main.jsonl's bytes at a path no other test reads, so no
 * fold is kept for it yet; and the line end halfway through. */
function savedWorld(on: On, path: string) {
  const w = world(on)
  const bytes = w.files.get(MAIN)!
  w.files.set(path, bytes)
  const half = bytes.indexOf(10, bytes.length >> 1) + 1
  return { w, bytes, half, dir: statePath(STATE, 'main-fold', path) }
}

/** `fold` saved for a transcript, with `meta`, into `dir`, as a first save
 * writes it. */
function plant(w: World, dir: string, fold: MainFold, meta: FoldMeta) {
  const save = foldSave(fold, meta)!
  for (const [i, t] of save.parts) {
    w.files.set(dir + '/' + partName(i), encoder.encode(t))
  }
  w.files.set(dir + '/' + save.slot, encoder.encode(save.head))
}

/** A status document's figures, as JSON, without the mod's own `agents`,
 * which statusOf does not make. */
function figuresOf(doc: Dict): Dict {
  const { agents: _, ...figures } = doc
  return JSON.parse(JSON.stringify(figures)) as Dict
}

/** The status document over `bytes` in place of `path`'s own. */
async function statusOver(w: World, path: string, bytes: Uint8Array,
  rate: number | null) {
  const was = w.files.get(path)!
  w.files.set(path, bytes)
  try {
    return JSON.parse(JSON.stringify(await statusOf(w, path, rate)))
  } finally {
    w.files.set(path, was)
  }
}

// The saved fold planted empty, at the halfway line: a reload that reads
// on from it folds only the lines after it, which the document shows.
test('a reload reads on from the saved fold, not the whole transcript',
  async ($, on) => {
    const path = sessionFile('-saved-fold')
    const { w, bytes, half, dir } = savedWorld(on, path)
    plant(w, dir, newMainFold(), foldMeta(bytes, half))
    await start($, w, 'terminal', path)
    const doc = figuresOf(lastDoc(w))
    const rate = doc.rate as number | null
    expect(doc).toEqual(await statusOver(w, path, bytes.subarray(half), rate))
    expect(doc).not.toEqual(await statusOver(w, path, bytes, rate))
  })

// One whose transcript's bytes are not the ones it was folded from is
// passed over, the transcript folded from the start, and saved afresh.
test('a saved fold of other bytes is not read, and is saved over',
  async ($, on) => {
    const path = sessionFile('-saved-other')
    const { w, bytes, half, dir } = savedWorld(on, path)
    const other = bytes.slice()
    other[0] = 0x20
    plant(w, dir, newMainFold(), foldMeta(other, half))
    await start($, w, 'terminal', path)
    const doc = figuresOf(lastDoc(w))
    expect(doc).toEqual(await statusOver(w, path, bytes,
      doc.rate as number | null))
    const whole = newMainFold()
    for (const r of _recordsOf(bytes)) foldMain(whole, r)
    const back = foldLoad((n) => {
      const f = w.files.get(dir + '/' + n)
      return f ? new TextDecoder().decode(f) : null
    })
    expect(back?.meta).toEqual(foldMeta(bytes, bytes.lastIndexOf(10) + 1))
    expect(JSON.stringify(foldSave(back!.fold, back!.meta)))
      .toBe(JSON.stringify(foldSave(whole, back!.meta)))
  })

/** A world whose shell reads (`tail -c +N | head -c L | base64`) are
 * recorded: the widest asked for, and where each read over the check
 * digests' 4 KiB starts.  Read whole, every one of those is a multiple of
 * its 2 MiB; read in pieces, each piece after the first starts at a line's
 * end, off that grid. */
function shellWorld(on: On) {
  const seen = { widest: 0, froms: [] as number[] }
  const w: World = world(on, (e) => {
    const [cmd, , script, , from, file, want] = e.argv
    if (cmd !== '/bin/sh' || !script.includes('base64')) return NO_GIT_HERE
    seen.widest = Math.max(seen.widest, Number(want))
    if (Number(want) > 4096) seen.froms.push(Number(from) - 1)
    const f = w.files.get(file)!
    const piece = f.subarray(Number(from) - 1,
      Number(from) - 1 + Number(want))
    const s: string[] = []
    for (let i = 0; i < piece.length; i += 8192) {
      s.push(String.fromCharCode(...piece.subarray(i, i + 8192)))
    }
    return { ...NO_GIT_HERE, exitCode: 0, stdout: btoa(s.join('')) + '\n',
      stderr: '' }
  })
  return { w, seen }
}

/** `one` repeated past `mib` MiB. */
function repeated(one: Uint8Array, mib: number): Uint8Array {
  const copies = Math.ceil((mib * 1024 * 1024) / one.length)
  const bytes = new Uint8Array(one.length * copies)
  for (let i = 0; i < copies; i++) bytes.set(one, i * one.length)
  return bytes
}

/** The shell reads `seen` recorded within 2 MiB each, and at least two of
 * them starting at a line's end of `bytes` off the 2 MiB grid. */
function readInPieces(seen: { widest: number; froms: number[] },
  bytes: Uint8Array) {
  expect(seen.widest).toBeLessThanOrEqual(2 * 1024 * 1024)
  const starts = seen.froms.filter((at) => at % (2 * 1024 * 1024) !== 0 &&
    bytes[at - 1] === 10)
  expect(starts.length).toBeGreaterThanOrEqual(2)
}

// A long stretch past the fold, as on the first read of a long session,
// is folded a piece at a time, so no more than a piece of it is held at
// once, and the fold saved.  The copies of main.jsonl's records past two
// pieces' length put piece ends mid-record.  It folds 17 MiB twice, some
// 11 s on an idle machine: three budgets.
test('a long transcript is folded in pieces, and saved',
  { timeoutMs: 3 * BUDGET_MS }, async ($, on) => {
    const path = sessionFile('-pieces')
    const { w, seen } = shellWorld(on)
    const bytes = repeated(w.files.get(MAIN)!, 17)
    w.files.set(path, bytes)
    await start($, w, 'terminal', path)
    readInPieces(seen, bytes)
    const doc = figuresOf(lastDoc(w))
    expect(doc).toEqual(await statusOver(w, path, bytes,
      doc.rate as number | null))
    const whole = newMainFold()
    for (const r of _recordsOf(bytes)) foldMain(whole, r)
    const dir = statePath(STATE, 'main-fold', path)
    const back = foldLoad((n) => {
      const f = w.files.get(dir + '/' + n)
      return f ? new TextDecoder().decode(f) : null
    })
    expect(back?.meta).toEqual(foldMeta(bytes, bytes.length))
    expect(JSON.stringify(foldSave(back!.fold, back!.meta)))
      .toBe(JSON.stringify(foldSave(whole, back!.meta)))
  })

// A long agent file is folded a piece at a time too, and the fold it saves
// is the whole file's.  Its records repeated past three pieces' length put
// piece ends mid-record.
test('a long agent file is folded in pieces, and saved',
  { timeoutMs: 3 * BUDGET_MS }, async ($, on) => {
    const { w, seen } = shellWorld(on)
    const path = sessionFile('-agent-pieces')
    const agent = path.slice(0, -'.jsonl'.length) +
      '/subagents/agent-fork1.jsonl'
    w.files.set(path, w.files.get(STATUS)!)
    const bytes = repeated(w.files.get(
      '/fixtures/transcripts/status/agents/subagents/agent-fork1.jsonl')!, 25)
    w.files.set(agent, bytes)
    await start($, w, 'terminal', path)
    readInPieces(seen, bytes)
    const slot = foldDir(STATE, path) + '/' + slotNames(agent)[1]
    const end = bytes.lastIndexOf(10) + 1
    expect(new TextDecoder().decode(w.files.get(slot)!)).toBe(
      agentFoldText(readOn(bytes, 0), 1, tailAt(bytes, end)))
  })

// The saved cuts the mod once kept are removed on its first read: `rm`
// is handed only the names a cut was saved under, and `rmdir` each
// directory, so one that holds anything else stays.
test('the old saved cuts are removed, by their names alone', async ($, on) => {
  const ran: (readonly string[])[] = []
  const w = world(on, (e) => {
    if (e.argv[0] === '/bin/rm' || e.argv[0] === '/bin/rmdir') {
      ran.push(e.argv)
      return { ...NO_GIT_HERE, exitCode: 0, stderr: '' }
    }
    return NO_GIT_HERE
  })
  const cuts = STATE + '/claude-main-cuts-mod'
  const a = cuts + '/' + '0123456789abcdef'.repeat(2)
  const b = cuts + '/' + 'fedcba9876543210'.repeat(2)
  for (const p of [a + '/head.json', a + '/part-0.jsonl', a + '/part-12.jsonl',
    b + '/head.json', b + '/notes.txt', cuts + '/keep/head.json',
    cuts + '/stray.json']) {
    w.files.set(p, encoder.encode('{}'))
  }
  await start($, w, 'terminal', MAIN)
  expect(ran).toEqual([
    ['/bin/rm', '-f', '--', a + '/head.json', a + '/part-0.jsonl',
      a + '/part-12.jsonl', b + '/head.json'],
    ['/bin/rmdir', '--', a, b, cuts],
  ])
})

// ════════════════════════════════════════════════════════════════════════════
// The agents' folds saved, and a reload reading on from them.
// ════════════════════════════════════════════════════════════════════════════

/** The status fixture and its agent at paths no other test reads, so no
 * fold is kept for them yet: the transcript, the agent's path and bytes,
 * the line end halfway through those, and the agent's two slots. */
function agentWorld(on: On, name: string) {
  const w = world(on)
  const path = sessionFile('-' + name)
  const agent = path.slice(0, -'.jsonl'.length) +
    '/subagents/agent-fork1.jsonl'
  w.files.set(path, w.files.get(STATUS)!)
  const bytes = w.files.get(
    '/fixtures/transcripts/status/agents/subagents/agent-fork1.jsonl')!
  w.files.set(agent, bytes)
  const half = bytes.indexOf(10, bytes.length >> 1) + 1
  const dir = foldDir(STATE, path)
  const slots = slotNames(agent).map((n) => dir + '/' + n)
  return { w, path, agent, bytes, half, slots }
}

/** The check digest of `bytes` at `pos`. */
function tailAt(bytes: Uint8Array, pos: number) {
  return tailDigest(bytes.subarray(Math.max(0, pos - AGENT_CHECK_BYTES), pos))
}

/** An empty fold at `pos`, read on over `bytes` from there. */
function readOn(bytes: Uint8Array, pos: number) {
  const f = newAgentFold()
  f.pos = pos
  foldAgentBytes(f, bytes.subarray(pos))
  return f
}

// An agent's fold planted empty at its halfway line, as a first save
// writes it, to the second slot: a reload reads on from it, so the fold
// the mod saves, to the first slot, holds only the second half.
test('a reload reads an agent on from its saved fold, and saves it to ' +
  'the other slot', async ($, on) => {
  const { w, path, bytes, half, slots } = agentWorld(on, 'agent-saved')
  const empty = newAgentFold()
  empty.pos = half
  w.files.set(slots[1], encoder.encode(
    agentFoldText(empty, 1, tailAt(bytes, half))))
  await start($, w, 'terminal', path)
  const end = bytes.lastIndexOf(10) + 1
  expect(new TextDecoder().decode(w.files.get(slots[0])!)).toBe(
    agentFoldText(readOn(bytes, half), 2, tailAt(bytes, end)))
})

// The newer slot torn, as $.fs.write can leave it to a reader, and the
// older one sound: the older is read on from, and saved over.
test('a torn agent fold falls back to the other slot', async ($, on) => {
  const { w, path, bytes, half, slots } = agentWorld(on, 'agent-torn')
  const sound = readOn(bytes.subarray(0, half), 0)
  w.files.set(slots[1], encoder.encode(
    agentFoldText(sound, 3, tailAt(bytes, half))))
  const torn = agentFoldText(sound, 4, tailAt(bytes, half))
  w.files.set(slots[0], encoder.encode(torn.slice(0, torn.length >> 1)))
  await start($, w, 'terminal', path)
  const end = bytes.lastIndexOf(10) + 1
  expect(new TextDecoder().decode(w.files.get(slots[0])!)).toBe(
    agentFoldText(readOn(bytes, 0), 4, tailAt(bytes, end)))
})

// A fold saved against other bytes is passed over, and the file folded
// from its start, saved after the highest seq either slot holds.
test('an agent fold of other bytes is not read', async ($, on) => {
  const { w, path, bytes, half, slots } = agentWorld(on, 'agent-other')
  w.files.set(slots[0], encoder.encode(
    agentFoldText(readOn(bytes.subarray(0, half), 0), 6, 'f'.repeat(64))))
  await start($, w, 'terminal', path)
  const end = bytes.lastIndexOf(10) + 1
  expect(new TextDecoder().decode(w.files.get(slots[1])!)).toBe(
    agentFoldText(readOn(bytes, 0), 7, tailAt(bytes, end)))
  expect(w.files.get(slots[0])!.length).toBeGreaterThan(0)
})

test('the old agent folds are removed, by their names alone',
  async ($, on) => {
    const ran: (readonly string[])[] = []
    const w = world(on, (e) => {
      if (e.argv[0] === '/bin/rm' || e.argv[0] === '/bin/rmdir') {
        ran.push(e.argv)
        return { ...NO_GIT_HERE, exitCode: 0, stderr: '' }
      }
      return NO_GIT_HERE
    })
    const old = STATE + '/claude-agent-folds-mod'
    const a = old + '/' + '0123456789abcdef'.repeat(2)
    const f = '89abcdef01234567'.repeat(2) + '.json'
    for (const p of [a + '/' + f, a + '/notes.txt', old + '/stray.json']) {
      w.files.set(p, encoder.encode('{}'))
    }
    await start($, w, 'terminal', STATUS)
    expect(ran.filter((r) => r.some((x) => x.startsWith(old)))).toEqual([
      ['/bin/rm', '-f', '--', a + '/' + f],
      ['/bin/rmdir', '--', a, old],
    ])
  })

// ════════════════════════════════════════════════════════════════════════════
// A resumed session, and the events a live one sends in another order.
// ════════════════════════════════════════════════════════════════════════════

const RESUMED = sessionFile('-work')
const ASKED = 'Say done.'
const ASKED_MS = 5_000

/** The history a resume opens on: the status fixture, where the session's
 * id would put it. */
function resumed(w: World) {
  w.files.set(RESUMED, w.files.get(STATUS)!)
}

/** The transcript grown by `recs`, one line each, as the engine appends. */
function grow(w: World, ...recs: object[]) {
  const add = encoder.encode(recs.map((r) => JSON.stringify(r) + '\n')
    .join(''))
  const before = w.files.get(RESUMED)!
  const grown = new Uint8Array(before.length + add.length)
  grown.set(before)
  grown.set(add, before.length)
  w.files.set(RESUMED, grown)
}

/** A turn that calls no tool: the prompt's record as it opens, the
 * answer's as it ends. */
async function askAndAnswer($: any, w: World) {
  grow(w, { message: { content: ASKED }, promptId: 'p-resume',
    promptSource: 'typed', timestamp: '2026-08-16T02:20:00Z', type: 'user',
    userType: 'external' })
  await $.turn.start({ text: ASKED, turnId: 't-resume' })
  await settle()
  grow(w, ANSWER)
  await $.turn.complete(COMPLETE)
  await settle()
}

const ANSWER = { isSidechain: false, message: { content: [{ text: 'Done.',
  type: 'text' }], id: 'req-r1', usage: { cache_creation_input_tokens: 500,
  cache_read_input_tokens: 41000, input_tokens: 3, output_tokens: 40 } },
requestId: 'req-r1', timestamp: '2026-08-16T02:20:05Z', type: 'assistant' }
const COMPLETE = { answer: 'Done.', durationMs: ASKED_MS, isAborted: false,
  turnId: 't-resume', reason: 'answer' } as const

/** A turn as Claude Code runs one live: the prompt's record as it opens,
 * and turn.complete before the answer's record, which Claude Code writes
 * only after its Stop hooks; `land` says whether it is written at all. */
async function askLive($: any, w: World, land: boolean) {
  grow(w, { message: { content: ASKED }, promptId: 'p-resume',
    promptSource: 'typed', timestamp: '2026-08-16T02:20:00Z', type: 'user',
    userType: 'external' })
  await $.turn.start({ text: ASKED, turnId: 't-resume' })
  await settle()
  await $.turn.complete(COMPLETE)
  await settle()
  await w.clock.settle()
  expect(stamped(w)).toBe(false)
  if (land) grow(w, ANSWER)
}

/** Whether the mod has filed a receipt for a closing line to draw. */
function stamped(w: World): boolean {
  return [...w.store.keys()].some((k) => k.startsWith('receipt-at:'))
}

/** Moves the clock on in the mod's polling steps until it has stamped, or
 * `ms` have passed. */
async function until(w: World, ms: number) {
  for (let t = 0; t < ms && !stamped(w); t += 500) {
    await w.clock.advance(500)
  }
}

/** The receipt's lines as the closing line should draw them at `now`,
 * worked out from the transcript's bytes: receiptLines over the cost
 * document, at the band's width with the band's indent. */
async function receiptOf(w: World, now: number): Promise<Span[][]> {
  const doc = lastDoc(w)
  const records = _recordsOf(bytesOf(w, RESUMED))
  const readings = readingsOf(w, RESUMED)
  const turns = turnsOf(records, (s) => agentRecordsOf(readings, s, null),
    null, new Map(), labelIn(w))
  const prepared = await preparedOf(now)
  const snap = seedLimitsSnapshot(baseLimits(prepared), prepared.reading)
  const fig = withEngineDuration(costFigures(turns, windowFor(turns,
    Number(doc.context_window)), CALIB, snap, prepared, now,
  Intl.DateTimeFormat().resolvedOptions().timeZone), ASKED_MS)
  const main = bandRows(BAND_ST, doc,
    { rate: null, phase: 'done' }).main
  return receiptLines(BAND_ST, fig, COLS, HIDE, true, main, STAMPED, INSET,
    true, OPTIONS.rows.subagents.transcript ? stampedOf(doc) : null)
}

/** The closing line of a turn that took `durationMs`, as drawn. */
async function closing($: any, durationMs: number) {
  return drawnRows(await $.ui.mount({ plugin: 'usage-band',
    surface: 'terminal', component: 'TurnDuration',
    props: { word: 'Worked', durationMs },
    viewport: { columns: COLS, rows: 40 } }))
}

test('a turn whose records land after turn.complete gets its receipt drawn as its closing line',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    // The band draws first, and the receipt is laid out at its width.
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    await askLive($, w, true)
    await until(w, 5_000)
    const want = await receiptOf(w, w.clock.now() / 1000)
    // 🎤, 🧵 and 🎮 at no indent, a blank row, then the 🔺🔖 tag line,
    // drawn as the start line is.
    expect(want.length).toBe(5)
    expect(text(want[0]).trimStart().startsWith(spec.E_TURN)).toBe(true)
    expect(text(want[1]).trimStart().startsWith(spec.E_THREAD)).toBe(true)
    expect(text(want[2]).trimStart().startsWith(spec.E_SESSION)).toBe(true)
    expect(text(want[3])).toBe(' ')
    expect(text(want[4])).toContain('p-resume'.slice(0, 8))
    expect(text(want[4]).startsWith(spec.E_TURN_PAST)).toBe(true)
    expect(text(want[4])).toContain(spec.E_DATE)
    // The account's limits as the receipt was stamped, 🪫 alone under the
    // user file's `*.plan.five_hour`.
    expect(text(want[4])).toContain('  ' + spec.E_ACCT + ' ' + spec.E_WEEK)
    expect(text(want[4])).not.toContain(spec.E_SESS)
    // The closing line draws it, on the band's columns, and nothing goes
    // to the transcript as a notice.
    expect(await closing($, ASKED_MS)).toEqual(expected(want))
    // A blank row above it, apart from the answer, and one under it.
    const drawn = await (await $.ui.mount({ plugin: 'usage-band',
      surface: 'terminal', component: 'TurnDuration',
      props: { word: 'Worked', durationMs: ASKED_MS },
      viewport: { columns: COLS, rows: 40 } })).drawn() as Drawn
    expect(drawn.props?.marginTop).toBe(1)
    expect(drawn.props?.marginBottom).toBe(1)
    expect(w.logged).toEqual([])
    // turn.complete again over the same turn: the same receipt, once.
    await $.turn.complete(COMPLETE)
    await settle()
    await w.clock.advance(5_000)
    expect(await closing($, ASKED_MS)).toEqual(expected(want))
    expect(logOf(w)).not.toContain('no receipt')
  })

test('a turn that ran subagents stamps the ended ones under 🧵 on its ' +
  'receipt, with 🎤 first and nothing to press, and owes the rest',
async ($, on) => {
  const w = world(on)
  on('agent.list', () => ({ value: [
    PARENT, { ...KID, status: 'completed' }] }))
  resumed(w)
  await $.session.start({ cwd: CWD, surface: 'terminal',
    isInteractive: true })
  await settle()
  await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'AbovePrompt', props: BAND })
  await askLive($, w, true)
  await until(w, 5_000)
  expect(stamped(w)).toBe(true)
  const want = await receiptOf(w, w.clock.now() / 1000)
  // 🎮 where the options stamp it, the tree's root; 🧵 under it, 🎤 🏁
  // first under 🧵, then the kid that ended, 🏁, under 🧵, its parent
  // still running and left for a later receipt; then the blank row and
  // the 🔺🔖 tag line.
  const rows = want.map((l) => text(l).slice(INSET))
  const root = STAMPED.includes('session') ? 1 : 0
  const pad = ' '.repeat(3 * root)
  expect(rows.length).toBe(5 + root)
  if (root) expect(rows[0].startsWith(spec.E_SESSION)).toBe(true)
  expect(rows[root].startsWith((root ? '╰─ ' : '') + spec.E_THREAD +
    spec.E_PHASE_END + ' main  Done.')).toBe(true)
  expect(rows[root + 1].startsWith(pad + '├─ ' + spec.E_TURN +
    spec.E_PHASE_DONE + ' turn  ' + ASKED)).toBe(true)
  expect(rows[root + 2].startsWith(pad + '╰─ 🔍' + spec.E_PHASE_DONE +
    ' Kid')).toBe(true)
  expect(rows[root + 3]).toBe('')
  // The parent, still at work, is owed a row on a later receipt.
  const owed = [...w.store].filter(([k]) => k.startsWith('receipt-owed:'))
  expect(owed.map(([, v]) => v)).toEqual([['p1']])
  expect(await closing($, ASKED_MS)).toEqual(expected(want))
  const receipt = await $.ui.mount({ plugin: 'usage-band',
    surface: 'terminal', component: 'TurnDuration',
    props: { word: 'Worked', durationMs: ASKED_MS },
    viewport: { columns: COLS, rows: 40 } })
  expect(await receipt.findAll({ type: 'Button' })).toEqual([])
  await w.clock.advance(5_000)
  expect(logOf(w)).not.toContain('no receipt')
})

test('a turn a task notification follows still gets its receipt and tag',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    await askLive($, w, true)
    // Delivered as the turn ends, after its answer, and written as a turn
    // of its own that never runs (seen live 2026-10-20).
    grow(w, { message: { content: '<task-notification>\n<task-id>a1' +
      '</task-id>\n<status>completed</status>\n</task-notification>' },
    origin: { kind: 'task-notification' }, promptId: 'p-notice',
    promptSource: 'system', timestamp: '2026-08-16T02:20:06Z',
    type: 'user', userType: 'external' })
    await until(w, 5_000)
    expect(stamped(w)).toBe(true)
    const want = await receiptOf(w, w.clock.now() / 1000)
    expect(text(want.at(-1)!)).toContain('p-resume'.slice(0, 8))
    expect(text(want.at(-1)!).startsWith(spec.E_TURN_PAST)).toBe(true)
    expect(await closing($, ASKED_MS)).toEqual(expected(want))
    // On past the band's hold, which the stamp's handler sleeps through.
    await w.clock.advance(5_000)
    expect(logOf(w)).not.toContain('no receipt')
  })

/** The receipt an answer block of `text` draws under itself: the rows of
 * the column Box under the engine's row, none where it draws none. */
async function underAnswerRows($: any, text: string) {
  const tree = await (await $.ui.mount({ plugin: 'usage-band',
    surface: 'terminal', component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: { columns: COLS, rows: 40 } })).drawn() as Drawn
  const box = (tree?.children ?? []).find((c): c is Drawn =>
    typeof c !== 'string' && c.type === 'Box' && c.props?.marginTop === 1)
  return box ? drawnRows({ drawn: async () => box }) : []
}

test('a turn a task notification opens while an agent still runs, which ' +
  'Claude Code closes with no line, gets its receipt under its answer',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    // The turn before ended waiting on one background agent, and the
    // notification opens the next with that agent still running: Claude
    // Code drops the second turn_duration, `Waiting for 1 background
    // agent` again, and draws no TurnDuration for it.
    const NOTICE = '<task-notification>\n<task-id>a1</task-id>\n' +
      '<status>completed</status>\n</task-notification>'
    const WAKE_MS = 7_000
    grow(w, { durationMs: 9_000, isSidechain: false,
      pendingBackgroundAgentCount: 1, subtype: 'turn_duration',
      timestamp: '2026-08-16T02:19:00Z', type: 'system' },
    { message: { content: NOTICE }, origin: { kind: 'task-notification' },
      promptId: 'p-wake', promptSource: 'system',
      timestamp: '2026-08-16T02:20:00Z', type: 'user',
      userType: 'external' })
    await $.turn.start({ text: NOTICE, turnId: 't-wake' })
    await settle()
    await $.turn.complete({ answer: 'Still running.', durationMs: WAKE_MS,
      isAborted: false, turnId: 't-wake', reason: 'answer' })
    await settle()
    await w.clock.settle()
    grow(w, { ...ANSWER, message: { ...ANSWER.message, id: 'req-w1',
      content: [{ text: 'Still running.', type: 'text' }] },
    requestId: 'req-w1', timestamp: '2026-08-16T02:20:06Z' },
    { durationMs: WAKE_MS, isSidechain: false,
      pendingBackgroundAgentCount: 1, subtype: 'turn_duration',
      timestamp: '2026-08-16T02:20:07Z', type: 'system' })
    await until(w, 5_000)
    expect(stamped(w)).toBe(true)
    await w.clock.advance(1_000)
    const filed = w.store.get('receipt-at:' + WAKE_MS) as
      { rows: { spans: Span[] }[]; under?: string }
    expect(filed.under).toBe('answer')
    const want = filed.rows.map((r) => r.spans)
    expect(text(want.at(-1)!)).toContain('p-wake')
    // Under the answer's last block, whitespace as the row draws it.
    expect(await underAnswerRows($, '  Still   running. ')).toEqual(
      expected(want))
    expect(await underAnswerRows($, 'Done.')).toEqual([])
    // A closing line drawn after all, as the ctrl+o transcript draws one,
    // leaves the receipt to the answer.
    await blankClosing($, 'Worked', WAKE_MS)
    await w.clock.advance(5_000)
    expect(logOf(w)).not.toContain('no receipt')
  })

test('a turn whose closing line Claude Code draws keeps its receipt there, ' +
  'not under its answer', async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    await askLive($, w, true)
    grow(w, { durationMs: ASKED_MS, isSidechain: false,
      subtype: 'turn_duration', timestamp: '2026-08-16T02:20:06Z',
      type: 'system' })
    await until(w, 5_000)
    expect(stamped(w)).toBe(true)
    const want = await receiptOf(w, w.clock.now() / 1000)
    await w.clock.advance(1_000)
    expect(await closing($, ASKED_MS)).toEqual(expected(want))
    expect(await underAnswerRows($, 'Done.')).toEqual([])
    expect([...w.store.keys()].some((k) => k.startsWith('receipt-answer:')))
      .toBe(false)
  })

test('a task notification written before turn.complete does not take the receipt',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    grow(w, { message: { content: ASKED }, promptId: 'p-resume',
      promptSource: 'typed', timestamp: '2026-08-16T02:20:00Z', type: 'user',
      userType: 'external' })
    await $.turn.start({ text: ASKED, turnId: 't-resume' })
    await settle()
    // The answer, and the notification 17 ms after the turn's end, both
    // in the transcript by the time the refresh after turn.complete reads
    // it (seen live 2026-10-20), so the newest prompt is the
    // notification's, a turn that never runs.
    grow(w, ANSWER, { message: { content: '<task-notification>\n' +
      '<task-id>a1</task-id>\n<status>completed</status>\n' +
      '</task-notification>' }, origin: { kind: 'task-notification' },
    promptId: 'p-notice', promptSource: 'system',
    timestamp: '2026-08-16T02:20:06Z', type: 'user', userType: 'external' })
    await $.turn.complete(COMPLETE)
    await settle()
    await until(w, 5_000)
    expect(stamped(w)).toBe(true)
    const want = await receiptOf(w, w.clock.now() / 1000)
    expect(text(want.at(-1)!)).toContain('p-resume'.slice(0, 8))
    expect(await closing($, ASKED_MS)).toEqual(expected(want))
    await w.clock.advance(5_000)
    expect(logOf(w)).not.toContain('no receipt')
  })

test('a transcript moved while its turn is billed still gets the receipt',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    await askLive($, w, true)
    // As leaving a worktree moves the session's transcript to the main
    // checkout's projects folder, between two of the stamp's reads.
    const moved = sessionFile('-main')
    w.files.set(moved, w.files.get(RESUMED)!)
    w.files.delete(RESUMED)
    await until(w, 5_000)
    expect(stamped(w)).toBe(true)
    // On past the band's hold, which the stamp's handler sleeps through.
    await w.clock.advance(5_000)
    expect(logOf(w)).toContain('transcript moved: ' + RESUMED + ' -> ' +
      moved)
    expect(logOf(w)).not.toContain('no receipt')
  })

test('a notification written just before the prompt takes neither its tag nor its receipt',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    // A task notification queued while idle, written with no turnPosition
    // before the prompt that opens the turn, which a read sees first (seen
    // live 2026-10-21, 1f2a3772 then abfeacea #366).
    grow(w, { message: { content: '<task-notification>\n' +
      '<task-id>a1</task-id>\n<status>completed</status>\n' +
      '</task-notification>' }, origin: { kind: 'task-notification' },
    promptId: 'p-notice', promptSource: 'system',
    timestamp: '2026-08-16T02:19:58Z', type: 'user', userType: 'external' })
    await $.turn.start({ text: ASKED, turnId: 't-resume' })
    await settle()
    expect((lastDoc(w).transcript as Dict).prompt_id).toBe('p-notice')
    grow(w, { message: { content: ASKED }, promptId: 'p-resume',
      promptSource: 'typed', timestamp: '2026-08-16T02:20:00Z',
      turnPosition: { promptIndex: 278, turnIndex: 366 }, type: 'user',
      userType: 'external' })
    await w.clock.advance(10_000)
    await settle()
    expect((lastDoc(w).transcript as Dict).prompt_id).toBe('p-resume')
    const typed = await $.ui.mount({ plugin: 'usage-band',
      surface: 'terminal', component: 'UserMessage',
      props: { text: ASKED, isExpanded: false, origin: { kind: 'composer' } } })
    expect((await tagDrawn(typed)).text).toContain('#366')
    grow(w, ANSWER)
    await $.turn.complete(COMPLETE)
    await settle()
    await until(w, 5_000)
    expect(stamped(w)).toBe(true)
    const want = await receiptOf(w, w.clock.now() / 1000)
    expect(text(want.at(-1)!)).toContain('p-resume'.slice(0, 8))
    await w.clock.advance(5_000)
    expect(logOf(w)).not.toContain('no receipt')
  })

test('a turn the context was compacted in gets its receipt and tag',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
      component: 'AbovePrompt', props: BAND })
    grow(w, { message: { content: ASKED }, promptId: 'p-resume',
      promptSource: 'typed', timestamp: '2026-08-16T02:20:00Z', type: 'user',
      userType: 'external' })
    await $.turn.start({ text: ASKED, turnId: 't-resume' })
    await settle()
    // The context compacted as the turn opened, its summary written under
    // the turn's prompt (seen live 2026-10-20): the fold gives the
    // compaction a turn of its own, and the answer lands in it.
    grow(w, { compactMetadata: { durationMs: 26, preTokens: 366000,
      trigger: 'auto' }, subtype: 'compact_boundary',
    timestamp: '2026-08-16T02:20:01Z', type: 'system' },
    { isCompactSummary: true, isVisibleInTranscriptOnly: true,
      message: { content: 'This session is being continued from a ' +
        'previous conversation.' }, promptId: 'p-resume',
      timestamp: '2026-08-16T02:19:00Z', type: 'user',
      userType: 'external' })
    await $.turn.complete(COMPLETE)
    await settle()
    await w.clock.settle()
    grow(w, ANSWER)
    await until(w, 5_000)
    expect(stamped(w)).toBe(true)
    const want = await receiptOf(w, w.clock.now() / 1000)
    // 🎤 is the turn, by its tag, the compaction billed in it.
    expect(text(want[0]).trimStart()).toMatch(/^🎤/)
    expect(text(want.at(-1)!)).toContain('p-resume'.slice(0, 8))
    expect(await closing($, ASKED_MS)).toEqual(expected(want))
    await w.clock.advance(5_000)
    expect(logOf(w)).not.toContain('no receipt')
  })

test('a turn whose records never land logs why and stamps nothing',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await askLive($, w, false)
    await until(w, 31_000)
    expect(stamped(w)).toBe(false)
    await blankClosing($, 'Worked', ASKED_MS)
    expect(logOf(w)).toContain('no receipt: the turn was not billed ' +
      'within 30s')
  })

/** The records Claude Code writes once a turn's answer is done: its Stop
 * hooks' summary, then the turn's clock, which its closing line is drawn
 * with. */
const TURN_DONE = [
  { isSidechain: false, subtype: 'stop_hook_summary', type: 'system',
    timestamp: '2026-08-16T02:20:05.100Z' },
  { durationMs: ASKED_MS, isSidechain: false, subtype: 'turn_duration',
    type: 'system', timestamp: '2026-08-16T02:20:05.200Z' },
]

/** The turn askAndAnswer runs, written whole to the transcript before the
 * mod's load sees it, as a reload just after its end finds it. */
function answered(w: World) {
  resumed(w)
  grow(w, { message: { content: ASKED }, promptId: 'p-resume',
    promptSource: 'typed', timestamp: '2026-08-16T02:20:00Z', type: 'user',
    userType: 'external' }, ANSWER, ...TURN_DONE)
}

/** How many times the mod filed a receipt for a closing line. */
function filedCount(w: World): number {
  return w.stored.filter((k) => k.startsWith('receipt-at:')).length
}

test('a load stamps the last finished turn its turn.complete never stamped',
  async ($, on) => {
    const w = world(on)
    answered(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await until(w, 5_000)
    expect(w.store.has('receipt-at:' + ASKED_MS)).toBe(true)
    expect(logOf(w)).toContain('receipt stamped on load: ' +
      'p-resume'.slice(0, 8))
    expect(logOf(w)).not.toContain('no receipt')
    await w.clock.advance(5_000)
    expect(filedCount(w)).toBe(1)
  })

test('a load stamps nothing for a last turn already stamped',
  async ($, on) => {
    const w = world(on)
    answered(w)
    const records = _recordsOf(bytesOf(w, RESUMED))
    const readings = readingsOf(w, RESUMED)
    const turns = turnsOf(records, (s) => agentRecordsOf(readings, s, null),
      null, new Map(), labelIn(w))
    w.store.set(receiptKey(SESSION, turnKey(turns)), true)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await until(w, 5_000)
    expect(stamped(w)).toBe(false)
    expect(logOf(w)).not.toContain('receipt stamped on load')
  })

test('a load stamps nothing while the last turn is still running',
  async ($, on) => {
    const w = world(on)
    // A turn before it finished, then a prompt with no clock after it.
    answered(w)
    grow(w, { message: { content: 'And again.' }, promptId: 'p-running',
      promptSource: 'typed', timestamp: '2026-08-16T02:21:00Z',
      type: 'user', userType: 'external' })
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await until(w, 5_000)
    expect(stamped(w)).toBe(false)
    expect(logOf(w)).not.toContain('receipt stamped on load')
  })

test('a turn.complete arriving with the load stamps its turn once',
  async ($, on) => {
    const w = world(on)
    answered(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await $.turn.complete(COMPLETE)
    await settle()
    await until(w, 5_000)
    expect(w.store.has('receipt-at:' + ASKED_MS)).toBe(true)
    await w.clock.advance(5_000)
    await settle()
    expect(filedCount(w)).toBe(1)
    expect(logOf(w)).not.toContain('no receipt')
  })

/** A prompt sent before it was finished, as the transcript held it live
 * (session 4b531313, 2026-10-20, prompt 8d8ad942): the prompt in turn slot
 * 320, its attachment, two requests and no reply; then, `replaced`, the
 * full prompt in the same slot under the same parent. */
function rewound(w: World, replaced: boolean) {
  const at = { promptIndex: 250, turnIndex: 320 }
  if (!replaced) {
    grow(w, { message: { content: 'Blocked:' }, parentUuid: 'u-before',
      promptId: 'p-cut', promptSource: 'typed',
      timestamp: '2026-08-16T02:20:00Z', turnPosition: at, type: 'user',
      userType: 'external', uuid: 'u-cut' },
    { attachment: { type: 'total_tokens_reminder' }, parentUuid: 'u-cut',
      timestamp: '2026-08-16T02:20:00Z', type: 'attachment',
      uuid: 'u-cut-att' },
    { querySource: 'repl_main_thread', timestamp: '2026-08-16T02:20:00Z',
      type: 'api-request' },
    { lastPrompt: 'Blocked:', leafUuid: 'u-cut-att', type: 'last-prompt' },
    { querySource: 'repl_main_thread', timestamp: '2026-08-16T02:20:01Z',
      type: 'api-request' })
    return
  }
  grow(w, { message: { content: 'Blocked:\n1. Y' }, parentUuid: 'u-before',
    promptId: 'p-full', promptSource: 'typed',
    timestamp: '2026-08-16T02:22:00Z', turnPosition: at, type: 'user',
    userType: 'external', uuid: 'u-full' })
}

test('a prompt rewound before any reply logs that it billed nothing, at once',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    rewound(w, false)
    await $.turn.start({ text: 'Blocked:', turnId: 't-cut' })
    await settle()
    // Interrupted: nothing counted, so no usage.
    await $.turn.complete({ answer: '', durationMs: 2_000, isAborted: true,
      turnId: 't-cut', reason: 'aborted' })
    await settle()
    await until(w, 2_000)
    expect(stamped(w)).toBe(false)
    expect(logOf(w)).toContain('no receipt: the turn billed nothing ' +
      '(interrupted): p-cut')
    await w.clock.advance(31_000)
    expect(logOf(w)).not.toContain('not billed within')
    expect(logOf(w).split('no receipt').length).toBe(2)
  })

test('a prompt replaced in its turn slot logs that it billed nothing',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    rewound(w, false)
    await $.turn.start({ text: 'Blocked:', turnId: 't-cut' })
    await settle()
    // An end that says nothing of the interrupt: the transcript tells,
    // once the full prompt takes the slot.
    await $.turn.complete({ answer: '', durationMs: 2_000, isAborted: false,
      turnId: 't-cut', reason: 'answer' })
    await settle()
    await until(w, 5_000)
    expect(logOf(w)).not.toContain('no receipt')
    rewound(w, true)
    await until(w, 2_000)
    expect(stamped(w)).toBe(false)
    expect(logOf(w)).toContain('no receipt: the turn billed nothing ' +
      '(replaced): p-cut')
    await w.clock.advance(31_000)
    expect(logOf(w)).not.toContain('not billed within')
  })

/** The mod's log file, as the world holds it. */
function logOf(w: World): string {
  const f = w.files.get(STATE + '/' + LOG_NAME)
  return f ? new TextDecoder().decode(f) : ''
}

/** All three places drawn for the turn askAndAnswer ran: the band over
 * the last document and the start line under the prompt, each against the
 * src/ functions over the same bytes, and the blank closing line. */
async function drewAll($: any, w: World) {
  const doc = lastDoc(w)
  expect((doc.transcript as Dict).prompt_id).toBe('p-resume')
  // The transcript as read straight off its bytes.  Not the whole
  // document: by now the usage reading comes from the cache the first
  // refresh wrote, which carries its scope fields, where a fresh reading
  // does not.
  const want = await statusOf(w, RESUMED, doc.rate as number | null)
  expect(JSON.parse(JSON.stringify(doc.transcript)))
    .toEqual(JSON.parse(JSON.stringify(want.transcript)))
  const st = BAND_ST

  const mount = () => mountBand($, 'terminal', BAND)
  // The band drawn as of now, its clocks moved on as the mod moves them.
  const shown = (phase: 'running' | 'done') => {
    const now = Math.max(Number((doc.clock as Dict).now),
      w.clock.now() / 1000)
    return bandWant(st, { ...doc, clock: { ...(doc.clock as Dict), now } },
      { rate: null, phase, live: LIVE })
  }
  // The turn has ended, but until its receipt is stamped, and a second
  // more, the band keeps its 🎤 and 🎮 rows.
  expect(await drawnRows(await mount())).toEqual(expected(shown('running')))
  await until(w, 5_000)
  expect(stamped(w)).toBe(true)
  await w.clock.advance(1_000)
  // Then nothing: the receipt has stamped 🧵 with 🎤 and 🎮.
  expect(shown('done')).toEqual([])
  expect(await drawnRows(await mount())).toEqual([])

  const tag = startLine(BAND_ST, doc, HIDE)
  expect(tag.length).toBeGreaterThan(0)
  expect(w.store.get(startKey(ASKED))).toBeDefined()
  const typed = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'UserMessage', props: { text: ASKED, isExpanded: false,
      origin: { kind: 'composer' } } })
  expect(await tagDrawn(typed)).toEqual({ beside: false, text: text(tag) })

  // The receipt the hold waited for: its three rows, a blank row and its
  // tag line on the closing line.
  expect((await closing($, ASKED_MS)).length).toBe(5)
}

test('a resumed session whose first turn calls no tool draws all three',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    await askAndAnswer($, w)
    await drewAll($, w)
    expect(logOf(w)).toContain('started by session.start in ' + CWD)
  })

// The project's local file the acceptance check writes
// (config-merge.md, "Acceptance"): 🎤, 🤖 and 🎮 kept under the footer
// line between turns, and stamped into the transcript too.
const LOCAL = CWD + '/.config/coding-agent-usage-line/config.local.jsonc'
const KEPT_AND_STAMPED = '{"rows": {' +
  '"turn": {"live": "always", "transcript": true}, ' +
  '"agent": {"live": "always", "transcript": true}, ' +
  '"session": {"live": "always", "transcript": true}}}'

test('a project file found on the tick keeps the rows and stamps them, ' +
  'with no reload', async ($, on) => {
  const w = world(on)
  resumed(w)
  await $.session.start({ cwd: CWD, surface: 'terminal',
    isInteractive: true })
  await settle()
  await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'AbovePrompt', props: BAND })
  expect(logOf(w)).toContain(`config from ${CWD}: user ${USER_FILE}` +
    ' (usage-source, hide, rows)')
  // The file comes after the session's start; the tick's next look at the
  // files reads it.
  w.files.set(LOCAL, encoder.encode(KEPT_AND_STAMPED))
  await w.clock.advance(CONFIG.tickMs)
  await settle()
  expect(logOf(w)).toContain(`config from ${CWD}: project-local ${LOCAL}` +
    ` (rows); user ${USER_FILE} (usage-source, hide, rows)`)
  expect(logOf(w)).toContain('config options: ' +
    'usage-source "claude-usage-tracker" (user); right-edge 5 (derived); ' +
    'hide ' + JSON.stringify(HIDE) + ' (user); rows.turn.live "always" (project-local); ' +
    'rows.turn.transcript true (project-local); ' +
    'rows.agent.live "always" (project-local); ' +
    'rows.agent.transcript true (project-local); ' +
    'rows.session.live "always" (project-local); ' +
    'rows.session.transcript true (project-local)')
  await askLive($, w, true)
  await until(w, 5_000)
  expect(stamped(w)).toBe(true)
  await w.clock.advance(1_000)
  // The turn is done, and the band keeps all three rows.
  const doc = lastDoc(w)
  const now = Math.max(Number((doc.clock as Dict).now), w.clock.now() / 1000)
  const kept = bandWant(BAND_ST, { ...doc, clock: { ...(doc.clock as Dict),
    now } }, { rate: null, phase: 'done',
    live: { turn: 'always', agent: 'always', session: 'always' } })
  expect(kept.length).toBe(3)
  expect(await drawnRows(await mountBand($, 'terminal', BAND)))
    .toEqual(expected(kept))
  // And the receipt stamps all three too: three rows, a blank row and the
  // tag line.
  expect((await closing($, ASKED_MS)).length).toBe(5)
  // A good file: no notice in the transcript.
  expect(w.logged.filter((l) => l.includes('config'))).toEqual([])
})

test('a bad value in a file is logged, noticed once, and its default kept',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    w.files.set(LOCAL, encoder.encode(
      '{"rows": {"turn": {"live": "allways"}}}'))
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    const warning = `${LOCAL}: "rows.turn.live" must be one of "never", ` +
      '"running", "always" (did you mean "always"?); skipped'
    expect(logOf(w)).toContain('config: ' + warning)
    expect(w.logged).toEqual(['config ' + warning])
    // Another session's start, and a tick: the file is as it was, so no
    // second read and no second notice.
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await w.clock.advance(CONFIG.tickMs)
    await settle()
    expect(w.logged.length).toBe(1)
    expect(logOf(w).split('config: ' + warning).length - 1).toBe(1)
    // 🎤 as the layer under the file has it, "running": gone once the
    // turn ends.
    await askLive($, w, true)
    await until(w, 5_000)
    await w.clock.advance(1_000)
    expect(await drawnRows(await mountBand($, 'terminal', BAND)))
      .toEqual([])
  })

test('a turn before any session.start still draws all three',
  async ($, on) => {
    const w = world(on)
    resumed(w)
    await askAndAnswer($, w)
    await drewAll($, w)
    // The first event started the load's tick, and said so.
    expect(logOf(w)).toContain('started by turn.start')
  })

test('a read that never ends is dropped and logged after its limit, and ' +
  'the next one draws', async ($, on) => {
    const w = world(on)
    resumed(w)
    w.usage.hung = []
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    expect(w.docs.length).toBe(0)
    await w.clock.advance(CONFIG.readLimitMs)
    await settle()
    expect(logOf(w)).toMatch(new RegExp('refresh: no status document: ' +
      '.*the status document still running after ' +
      CONFIG.readLimitMs / 1000 + 's, dropped'))
    expect(w.docs.length).toBe(0)
    // The asks held are answered, and the next read draws.
    const late = w.usage.hung!
    w.usage.hung = undefined
    for (const answer of late) answer()
    await settle()
    await askAndAnswer($, w)
    expect((lastDoc(w).transcript as Dict).prompt_id).toBe('p-resume')
  })

test('a refresh that throws is logged, and the next one draws',
  async ($, on) => {
    const w = world(on, undefined, true)
    resumed(w)
    await $.session.start({ cwd: CWD, surface: 'terminal',
      isInteractive: true })
    await settle()
    // The start's reads failed: nothing filed, and the log says why, in
    // its file and in the debug log.
    expect(w.docs.length).toBe(0)
    const why = /refresh: no status document: .*usage unavailable/
    expect(logOf(w)).toMatch(why)
    expect(w.debug.some((l) => why.test(l))).toBe(true)
    w.usage.down = false
    await askAndAnswer($, w)
    await drewAll($, w)
  })

// ════════════════════════════════════════════════════════════════════════════
// The tree's presses.
// ════════════════════════════════════════════════════════════════════════════

/** A world whose `$.agent.list()` answers `listed`, as it stands at each
 * ask, and whose `$.ui.view` calls are kept in `views`, each answered as
 * shown. */
function clicking(on: On, listed: AgentInfo[]) {
  const w = world(on)
  const views: Dict[] = []
  on('agent.list', () => ({ value: listed }))
  on('ui.view', ($, e) => {
    views.push({ ...e })
    return { value: {} }
  })
  return { w, views }
}

/** The band above the prompt while a turn runs, mounted, and the rows it
 * should draw under `folds` off the last document. */
async function clickBand($: any, w: World) {
  const band = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'AbovePrompt', props: { ...BAND, isWorking: true } })
  const want = (folds: { [key: string]: boolean }) => expected(
    bandLines(BAND_ST, lastDoc(w), COLS, HIDE, { rate: null,
      phase: 'running', live: LIVE, places: PLACES, ...AGENTS,
      place: 'above', indent: INSET, folds }))
  return { band, want }
}

const PARENT: AgentInfo = { id: 'p1', type: 'Explore', name: 'Parent',
  description: 'Look about', status: 'running' }
const KID: AgentInfo = { id: 'c1', type: 'Explore', name: 'Kid',
  description: 'Look closer', status: 'running', parentId: 'p1' }

test('a press on a fold mark folds its row and opens it again, and the ' +
  'grouped rows open', async ($, on) => {
  const { w } = clicking(on, [PARENT, KID])
  await start($, w, 'terminal', STATUS)
  const { band, want } = await clickBand($, w)
  const opened = await drawnRows(band)
  expect(opened).toEqual(want({}))
  expect(opened.some((r) => /⊟ 🔍🟢 Parent/u.test(r.text))).toBe(true)
  expect(opened.some((r) => r.text.includes('Kid'))).toBe(true)
  // Folded: 👶🏻 counts the agent hidden under it, and the band is drawn
  // again at once.
  await band.press({ key: 'fold:p1' })
  const folded = await drawnRows(band)
  expect(folded).toEqual(want({ p1: true }))
  expect(folded.some((r) => /⊞ 🔍🟢 👶🏻1 Parent/u.test(r.text))).toBe(true)
  expect(folded.some((r) => r.text.includes('Kid'))).toBe(false)
  await band.press({ key: 'fold:p1' })
  expect(await drawnRows(band)).toEqual(want({ p1: false }))
  // `✅ N done` starts folded; opened, it lists the agent that ended.
  expect(opened.some((r) => r.text.includes('fork'))).toBe(false)
  await band.press({ key: 'fold:main/done' })
  const done = await drawnRows(band)
  expect(done).toEqual(want({ p1: false, 'main/done': false }))
  expect(done.length).toBe(opened.length + 1)
  // 🎮 folds the whole tree under it.
  await band.press({ key: 'fold:session' })
  const root = await drawnRows(band)
  expect(root.length).toBe(1)
  expect(root[0].text).toMatch(/^ *⊞ 🎮/u)
})

test('a press on a label switches the transcript to its agent, and 🧵 ' +
  'main\'s and 🎤 turn\'s back to the main conversation', async ($, on) => {
  const { w, views } = clicking(on, [PARENT, KID])
  await start($, w, 'terminal', STATUS)
  const { band } = await clickBand($, w)
  const keys: string[] = (await band.findAll({ type: 'Button' }))
    .map((b: { key?: string }) => b.key ?? '')
  // 🎮 and the grouped rows have no label to press.
  expect(keys.filter((k) => k.startsWith('view:')).sort())
    .toEqual(['view:c1', 'view:main', 'view:p1', 'view:turn'])
  await band.press({ key: 'view:c1' })
  await band.press({ key: 'view:main' })
  await band.press({ key: 'view:p1' })
  await band.press({ key: 'view:turn' })
  expect(views).toEqual([{ agentId: 'c1' }, {}, { agentId: 'p1' }, {}])
})

/** The band above the prompt over a session with an open background
 * shell, `bsh1`, and Monitor, `mon1`, mounted; each `$.ui.toast` kept in
 * `toasts`, and each command run in `ran`. */
async function shellBand($: any, on: On) {
  const { w } = clicking(on, [])
  const toasts: Dict[] = []
  const ran: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push({ ...e })
    return { value: undefined }
  })
  on('command.run', ($, e) => {
    ran.push(e.command)
    return {}
  })
  await start($, w, 'terminal',
    withShell(w, '2026-08-16T01:44:00Z', '2026-08-16T01:50:00Z'))
  const { band } = await clickBand($, w)
  return { band, toasts, ran }
}

test('a press on an open shell\'s or Monitor\'s row toasts what the band ' +
  'knows of it, its command and output file too, and runs no command',
async ($, on) => {
  const { band, toasts, ran } = await shellBand($, on)
  const keys: string[] = (await band.findAll({ type: 'Button' }))
    .map((b: { key?: string }) => b.key ?? '')
  expect(keys.filter((k) => k.startsWith('task:')))
    .toEqual(['task:bsh1', 'task:mon1'])
  await band.press({ key: 'task:bsh1' })
  await band.press({ key: 'task:mon1' })
  await settle()
  expect(toasts).toEqual([
    { text: '💻 shell · 🟢 running · ⌛ 39m · Build the docs · ' +
        '$ make docs ⏎ && open site · ⤷ ' + SHELL_OUTPUT,
      timeoutMs: CONFIG.taskToastMs },
    { text: '📡 Monitor · 🟢 running · ⌛ 33m · Watch the CI checks · ' +
        '$ make watch · ⤷ ~/tasks/mon1.output',
      timeoutMs: CONFIG.taskToastMs }])
  expect(ran).toEqual([])
})

test('an agent that ends takes its fold with it, and 🧵\'s grouped row ' +
  'keeps its own', async ($, on) => {
  const listed = [PARENT, KID]
  const { w } = clicking(on, listed)
  await start($, w, 'terminal', STATUS)
  const { band, want } = await clickBand($, w)
  await band.press({ key: 'fold:p1' })
  await band.press({ key: 'fold:main/done' })
  expect((await drawnRows(band)).some((r) => r.text.includes('Kid')))
    .toBe(false)
  // The parent ends while its kid runs on: it is still drawn, for the
  // kid under it, and opened, its fold gone with it.
  listed[0] = { ...PARENT, status: 'completed' }
  await w.clock.advance(CONFIG.tickMs)
  await settle()
  const after = await drawnRows(band)
  expect(after.length).toBe(want({ 'main/done': false }).length)
  expect(after.some((r) => /├⊟ 🔍.* Parent/u.test(r.text))).toBe(true)
  expect(after.some((r) => r.text.includes('Kid'))).toBe(true)
  expect(after.some((r) => /⊟ ✅ 1 done/u.test(r.text))).toBe(true)
})

/** A transcript line holding SendMessage's answer that its message waits
 * for agent `id`, at `ts`. */
const queuedFor = (id: string, ts: string) => JSON.stringify({ type: 'user',
  timestamp: ts, message: { content: [{ type: 'tool_result',
    tool_use_id: 'sm-' + id + ts }] },
  toolUseResult: { success: true,
    message: `Message queued for delivery to ${id} at its next tool round.` },
}) + '\n'

/** An agent's file line holding a message from the main thread taken off
 * its inbox, at `ts`. */
const deliveredAt = (ts: string) => JSON.stringify({ type: 'attachment',
  timestamp: ts, attachment: { type: 'queued_command', prompt: 'more',
    origin: { kind: 'coordinator' } } }) + '\n'

test('an agent with messages waiting draws 📨N, and one whose messages ' +
  'were delivered draws none, the counts saved for a reload', async ($, on) => {
  const { w } = clicking(on, [PARENT, KID])
  const path = sessionFile('-inbox')
  place(w, STATUS, path)
  const dir = path.slice(0, -'.jsonl'.length) + '/subagents/'
  const agent = w.files.get(
    '/fixtures/transcripts/status/agents/subagents/agent-fork1.jsonl')!
  const join = (...parts: (Uint8Array | string)[]) => {
    const bytes = parts.map((p) => typeof p === 'string'
      ? encoder.encode(p) : p)
    const out = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0))
    let at = 0
    for (const b of bytes) {
      out.set(b, at)
      at += b.length
    }
    return out
  }
  // Two sends to the parent, neither delivered; one to the kid, taken
  // off its inbox after.
  w.files.set(path, join(w.files.get(path)!,
    queuedFor('p1', '2026-08-16T01:40:00Z'),
    queuedFor('p1', '2026-08-16T01:40:10Z'),
    queuedFor('c1', '2026-08-16T01:40:20Z')))
  w.files.set(dir + 'agent-p1.jsonl', agent)
  w.files.set(dir + 'agent-c1.jsonl',
    join(agent, deliveredAt('2026-08-16T01:41:00Z')))
  await start($, w, 'terminal', path)
  const { band } = await clickBand($, w)
  const rows = await drawnRows(band)
  expect(rows.some((r) => /🔍🟢 📨2 Parent/u.test(r.text))).toBe(true)
  const kid = rows.find((r) => r.text.includes('Kid'))
  expect(kid?.text.includes('📨')).toBe(false)
  // Saved as inbox_fold writes it, so a reload reads on from the save.
  const saved = inboxFoldLoad(INBOX_SLOTS.map((n) => {
    const b = w.files.get(inboxFoldDir(STATE, path) + '/' + n)
    return b ? new TextDecoder().decode(b) : null
  }))[0]
  expect(saved.get(path)?.sends.map(([, id]) => id))
    .toEqual(['p1', 'p1', 'c1'])
  expect(saved.get(dir + 'agent-c1.jsonl')?.got.length).toBe(1)
})

/** `$.process.run` in a git repository at CWD on the branch `feat/x`,
 * clean, whose `origin` is `remote`, or none for null. */
function inRepo(remote: string | null) {
  const out = (stdout: string): Ran => ({ ...NO_GIT_HERE, exitCode: 0,
    stdout, stderr: '' })
  return (e: Run): Ran => {
    const a = e.argv.slice(2).join(' ')
    if (a.startsWith('rev-parse --show-toplevel')) {
      return out(CWD + '\n' + CWD + '/.git\nabc1234\n')
    }
    if (a === 'symbolic-ref --short HEAD') return out('feat/x\n')
    if (a === 'diff --quiet HEAD') return out('')
    if (a === 'remote get-url origin' && remote !== null) {
      return out(remote + '\n')
    }
    return NO_GIT_HERE
  }
}

/** The Links the band above the prompt draws while a turn runs, as their
 * addresses and texts, in the world `w`. */
async function linksDrawn($: any, w: World) {
  await start($, w, 'terminal', STATUS)
  const band = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal',
    component: 'AbovePrompt', props: { ...BAND, isWorking: true } })
  // A Link's found text leads with its address, the prop it draws as
  // text; what follows is its children's.
  return {
    links: (await band.findAll({ type: 'Link' })).map((l: any) =>
      [l.props.href, l.text.slice(String(l.props.href).length)]),
    rows: await drawnRows(band),
    want: expected(bandLines(BAND_ST, lastDoc(w), COLS, HIDE, { rate: null,
      phase: 'running', live: LIVE, places: PLACES, ...AGENTS,
      place: 'above', indent: INSET })),
  }
}

test('🎮\'s 📦 and 🌿 link to the repository on GitHub its origin names, ' +
  'and its branch there', async ($, on) => {
  const w = world(on, inRepo('git@github.com:o/r.git'))
  const { links, rows, want } = await linksDrawn($, w)
  expect(lastDoc(w).github).toBe('https://github.com/o/r')
  expect(links).toEqual([['https://github.com/o/r', '📦work'],
    ['https://github.com/o/r/tree/feat/x', '🌿feat/x']])
  expect(rows).toEqual(want)
  // The origin is asked once a load, not on every refresh.
  await w.clock.advance(CONFIG.tickMs)
  await settle()
  expect(w.runs.filter((a) => a.includes('remote')).length).toBe(1)
})

test('🎮\'s 📦 and 🌿 stay plain for a remote on another host, or none',
  async ($, on) => {
    const w = world(on, inRepo('git@gitlab.com:o/r.git'))
    const { links, rows, want } = await linksDrawn($, w)
    expect(lastDoc(w).github).toBeUndefined()
    expect(links).toEqual([])
    expect(rows).toEqual(want)
    expect(rows[0].text).toMatch(/📦work 🌿feat\/x/u)
  })

// The plan's usage windows, asked of the account's own usage endpoint as
// the session, as Claude Usage.app asks them: Claude Code's
// `$.session.usage()` names only the plan's week, and this answer holds
// the 5-hour window, the weekly Fable one and the per-model weeks too.
//
// The credential never reaches the plugin: `$.session.authorize()` answers an
// opaque handle, and `$.http.fetch` sets the header from it itself, over
// https to a first-party host only.  A session with no first-party
// credential, or signed in with an API key, has no plan usage, and nothing
// is asked for it.
//
// The ask is never on a document's path: a document takes the reading
// kept, and an ask that is due starts after it, whose answer the next
// document takes.  The reading is kept in a file in the state directory
// (state_spec.ts's plan-usage kind), one per signed-in account, so every
// session on the account shares one ask a minute, one failure's wait and
// one reading.  Not in `$.store`: Claude Code gives each install of the
// plugin a store of its own, so a session started with `--plugin-dir` and
// one of the marketplace install would each keep their own and both ask.
//
// Two sessions that look at the file together could both ask, so the ask
// is taken under a lock directory beside it, made with `mkdir`, which is
// atomic across processes: the session whose `mkdir` lands asks, writes
// the file whole through a temporary file renamed over it, and the others
// take its answer from the file a minute later.  A lock older than
// PLAN_USAGE_LOCK_STALE seconds is a session's that died holding it.
//
// Past PLAN_USAGE_FRESH, Claude Code's own reading stands in for the plan's
// windows; the windows it never has, the Fable week and the other
// per-model ones, are still drawn from the last answer until each one's
// own reset (sideWindows).
//
// Claude Code's own reading of the plan's week comes with every response,
// so it moves first when the week does, as when the limit is reset.  Where
// it disagrees with the week kept, and no ask since it changed has
// answered it, the ask is made at once rather than at the minute's end:
// still never inside a failure's wait, nor within PLAN_USAGE_RECHECK_GAP
// seconds of the last such ask.
import type { EngineInterface } from 'claude-code'

import { claudeOauthReading, oauthLimitWindows } from '../src/sources.ts'
import { parseJson, stableJson } from '../src/exact.ts'
import type { Reading } from '../src/sources.ts'
import { isDict, pyGet } from '../src/py.ts'
import type { Dict } from '../src/py.ts'
import { sha256Hex } from '../src/sha256.ts'
import { quote } from '../src/yaml.ts'
import { statePath } from '../src/state.ts'
import { placesOf, readText, runVia, writeAtomicVia } from './engine.ts'
import { log } from './log.ts'

type $ = EngineInterface

export const PLAN_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const PLAN_USAGE_HEADERS = { 'anthropic-beta': 'oauth-2025-04-20' }
/** Seconds between asks. */
export const PLAN_USAGE_EVERY = 60
/** Seconds the first failed ask in a row waits before the next; each
 * failure after it doubles the wait, up to PLAN_USAGE_BACKOFF_MAX. */
export const PLAN_USAGE_BACKOFF = 120
/** The longest wait after a failure, and the longest `Retry-After` taken,
 * in seconds. */
export const PLAN_USAGE_BACKOFF_MAX = 3600
export const PLAN_USAGE_RETRY_MAX = PLAN_USAGE_BACKOFF_MAX
/** Seconds an ask is waited for before it counts as failed: under
 * PLAN_USAGE_LOCK_STALE, so the failure's wait is in the file before
 * another session can take the lock over. */
export const PLAN_USAGE_TIMEOUT = 20
/** Seconds after which a lock directory is taken as abandoned. */
export const PLAN_USAGE_LOCK_STALE = 30
/** Seconds a reading stands in for Claude Code's own: past two failures'
 * waits and the ask after them, the native reading is the fresher. */
export const PLAN_USAGE_FRESH = 7 * 60
/** The fewest seconds between two asks that Claude Code's own week,
 * disagreeing with the one kept, makes ahead of the minute. */
export const PLAN_USAGE_RECHECK_GAP = 30

/** What the plan-usage file keeps per account: the reading, when it was
 * asked for, and, after a failure, how many failed in a row and when the
 * next ask may be. */
export type Kept = { reading?: Reading; fetched_at?: number;
  retry_at?: number; failures?: number }

/** What planUsageVia gives a document: the reading, while fresh, which
 * stands over Claude Code's own; else, past PLAN_USAGE_FRESH, the windows
 * of the last one that Claude Code's own never has (sideWindows), to draw
 * beside it; each null for none. */
export type PlanUsage = { reading: Reading | null; side: Reading | null }

/** The windows Claude Code's own reading gives: the plan's five hours and
 * its week. */
export const NATIVE_WINDOWS: readonly string[] = ['five_hour', 'seven_day']

/** The windows of the reading `reading`, asked for at `at`, that Claude
 * Code's own never has (NATIVE_WINDOWS), each that resets after `now`,
 * stamped with `as_of`, `at`, so the 💳 row can tell their age from the
 * rest; null where none is left.  A window with no reset is not kept: its
 * end is not known. */
export function sideWindows(reading: Reading | undefined, at: number,
  now: number): Reading | null {
  const buckets = isDict(reading) ? pyGet(reading, 'buckets') : null
  const kept = (Array.isArray(buckets) ? buckets : []).flatMap((b) => {
    const windows = isDict(b) ? pyGet(b, 'windows') : null
    const left = (Array.isArray(windows) ? windows : []).filter((w) => {
      const reset = isDict(w) ? finite(pyGet(w, 'resets_at')) : null
      return isDict(w) && !NATIVE_WINDOWS.includes(String(pyGet(w, 'id'))) &&
        reset !== null && reset > now
    }).map((w) => ({ ...w as Dict, as_of: at }))
    return left.length ? [{ ...b as Dict, windows: left }] : []
  })
  return kept.length ? { ...reading, as_of: at, buckets: kept } : null
}

/** The plan's week as two readings are compared by: its used percent and
 * its reset, in seconds since the epoch, null where not known. */
export type Week = { pct: number; reset: number | null }

/** A finite number `v`, else null. */
function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Claude Code's own week in the status line's payload `raw`, its
 * `rate_limits.seven_day`; null where it names none. */
export function nativeWeek(raw: unknown): Week | null {
  const limits = isDict(raw) ? pyGet(raw, 'rate_limits') : null
  const item = isDict(limits) ? pyGet(limits, 'seven_day') : null
  const pct = isDict(item) ? finite(pyGet(item, 'used_percentage')) : null
  return pct === null ? null : { pct, reset: finite(pyGet(item, 'resets_at')) }
}

/** The week of the reading `reading`, its seven_day window; null where it
 * has none with a used percent. */
export function readingWeek(reading: unknown): Week | null {
  const buckets = isDict(reading) ? pyGet(reading, 'buckets') : null
  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    const windows = isDict(bucket) ? pyGet(bucket, 'windows') : null
    for (const w of Array.isArray(windows) ? windows : []) {
      if (!isDict(w) || pyGet(w, 'id') !== 'seven_day') continue
      const pct = finite(pyGet(w, 'used_percent'))
      if (pct !== null) return { pct, reset: finite(pyGet(w, 'resets_at')) }
    }
  }
  return null
}

/** A key for the week `w`: its percent rounded to a whole one, as the
 * endpoint gives it, and its reset to the nearest minute. */
export function weekKey(w: Week): string {
  return Math.round(w.pct) + '/' +
    (w.reset === null ? '' : Math.floor((w.reset + 30) / 60))
}

/** Whether the weeks `a` and `b` disagree: their percents, each rounded
 * to a whole one, differ, or their resets, where both are known, are a
 * minute or more apart, since two sources stamp one reset a fraction of a
 * second apart. */
export function weeksDisagree(a: Week, b: Week): boolean {
  return Math.round(a.pct) !== Math.round(b.pct) ||
    (a.reset !== null && b.reset !== null && Math.abs(a.reset - b.reset) >= 60)
}

/** Whether Claude Code's own week `native` calls for an ask now, ahead of
 * the minute: it disagrees with the week of the reading `kept`; no ask
 * since it changed has answered it (`answered`, the weekKey of the last
 * week an ask answered); no ask is under way; no failure's wait is going
 * on; and PLAN_USAGE_RECHECK_GAP seconds have passed since the last such
 * ask, at `recheckedAt`. */
export function recheckDue(native: Week | null, kept: Kept,
  s: { answered: string | null; recheckedAt: number | null;
    asking: boolean }, now: number): boolean {
  const held = readingWeek(kept.reading)
  if (native === null || held === null || s.asking) return false
  if (!weeksDisagree(native, held) || weekKey(native) === s.answered) {
    return false
  }
  if (typeof kept.retry_at === 'number' && now < kept.retry_at) return false
  const at = s.recheckedAt
  return at === null || now - at >= PLAN_USAGE_RECHECK_GAP || now < at
}

/** The seconds to wait after the `failures`th failed ask in a row: the
 * first wait doubled for each failure before it, held to the most. */
export function backoffAfter(failures: number): number {
  return Math.min(PLAN_USAGE_BACKOFF_MAX,
    PLAN_USAGE_BACKOFF * 2 ** Math.max(0, failures - 1))
}

/** The opaque credential handle `$.session.authorize()` answers. */
type Handle = NonNullable<Awaited<ReturnType<$['session']['authorize']>>>[
  'handle']

/** The plugin's memory of the asks, for this load. */
const plan = {
  key: '',
  kept: {} as Kept,
  // When the file was last looked at, in seconds; null before the first.
  checkedAt: null as number | null,
  asking: false,
  // The window keys last logged, and each failure logged, so each is
  // logged once a load.
  keys: null as string | null,
  errors: new Set<string>(),
  // This load's own last answer, and when, for the credits to read.
  answer: null as { raw: unknown; at: number } | null,
  // Claude Code's own week as last seen, by its weekKey, and when it was
  // first seen so; the last such week an ask made after it was seen
  // answered; and when an ask was last made for a disagreement.
  native: null as string | null,
  nativeSince: 0,
  answered: null as string | null,
  recheckedAt: null as number | null,
}

/** The keys of the answer `raw` that hold a window's utilization, by
 * name, then those that are null or an object with none: which of them
 * carries Fable is the log's to show, read or not.  `limits` names the
 * per-model weeks read from the answer's `limits` list, by their keys, in
 * the list's order. */
export function windowKeys(raw: unknown):
  { read: string[]; empty: string[]; limits: string[] } {
  if (!isDict(raw)) return { read: [], empty: [], limits: [] }
  const keys = Object.keys(raw).sort()
  const read = keys.filter((k) => {
    const item = raw[k]
    return isDict(item) && pyGet(item, 'utilization') !== null
  })
  const empty = keys.filter((k) => !read.includes(k) &&
    (raw[k] === null || isDict(raw[k])))
  const limits = [...new Set(oauthLimitWindows(raw).map(([key]) => key))]
  return { read, empty, limits }
}

/** The log line for windowKeys' answer `w`. */
export function windowLine(
  w: { read: string[]; empty: string[]; limits: string[] }): string {
  const keys = (ks: string[]) => ks.map(quote).join(' ')
  return 'plan usage: ' + (keys(w.read) || 'none') +
    (w.limits.length ? ' · limits: ' + keys(w.limits) : '') +
    (w.empty.length ? ' · no reading: ' + keys(w.empty) : '')
}

/** The account's plan windows as last asked for, while fresh, else the
 * windows of them Claude Code's own reading lacks (PlanUsage); and, once
 * PLAN_USAGE_EVERY has passed since the file was last looked at, or sooner
 * where Claude Code's own week `native` disagrees with the kept one
 * (recheckDue), an ask started behind it.  `who` is the signed-in
 * account. */
export function planUsageVia($: $, who: string, now: number,
  native: Week | null = null): PlanUsage {
  const key = 'plan-usage:' + (who || 'default')
  if (key !== plan.key) {
    plan.key = key
    plan.kept = {}
    plan.checkedAt = null
    plan.answered = null
    plan.recheckedAt = null
  }
  const seen = native === null ? null : weekKey(native)
  if (seen !== plan.native) {
    plan.native = seen
    plan.nativeSince = now
  }
  const due = plan.checkedAt === null ||
    now - plan.checkedAt >= PLAN_USAGE_EVERY || now < plan.checkedAt
  // A minute's ask that a disagreement also calls for is a recheck, so it
  // takes no reading older than the week it is for.
  const recheck = recheckDue(native, plan.kept, plan, now)
  if ((due || recheck) && !plan.asking) {
    plan.asking = true
    plan.checkedAt = now
    if (recheck) plan.recheckedAt = now
    const since = plan.nativeSince
    void ask($, key, now, recheck && native !== null ? { since, native }
      : null).then(() => {
      // The week is answered by a reading asked for since it was seen.
      const at = plan.kept.fetched_at
      if (seen !== null && plan.key === key && typeof at === 'number' &&
          at >= since) {
        plan.answered = seen
      }
    }).catch(() => {}).finally(() => {
      plan.asking = false
    })
  }
  const at = plan.kept.fetched_at
  if (!plan.kept.reading || typeof at !== 'number') {
    return { reading: null, side: null }
  }
  return now - at < PLAN_USAGE_FRESH && now >= at
    ? { reading: plan.kept.reading, side: null }
    : { reading: null, side: sideWindows(plan.kept.reading, at, now) }
}

/** The answer this load asked for within `within` seconds of `now`, for
 * the credits to read in place of asking again; null for none. */
export function recentAnswer(now: number, within: number): unknown {
  const a = plan.answer
  return a && now - a.at < within && now >= a.at ? a.raw : null
}

/** The seconds a `Retry-After` header `value` asks to wait, as a number
 * of seconds or an HTTP date, from `now` in seconds; null for none or one
 * that does not parse.  Held to PLAN_USAGE_EVERY..PLAN_USAGE_RETRY_MAX. */
export function retryAfter(value: string | undefined, now: number):
  number | null {
  if (!value) return null
  const v = value.trim()
  const secs = /^\d+$/.test(v) ? Number(v)
    : Number.isNaN(Date.parse(v)) ? null : Date.parse(v) / 1000 - now
  return secs === null ? null
    : Math.min(PLAN_USAGE_RETRY_MAX, Math.max(PLAN_USAGE_EVERY, secs))
}

/** A recheck's ask: for Claude Code's own week `native`, first seen at
 * `since`. */
type Recheck = { since: number; native: Week }

/** Whether the file's reading `kept` answers the recheck `r`: it was
 * asked for at or after the week was seen, or it agrees with the week, as
 * when another session's recheck asked for it first. */
function answers(kept: Kept, r: Recheck): boolean {
  const held = readingWeek(kept.reading)
  return (kept.fetched_at as number) >= r.since ||
    (held !== null && !weeksDisagree(r.native, held))
}

/** The plan-usage file for `key`, `plan-usage:<account>`, in the state
 * directory. */
async function keptPath($: $, key: string): Promise<string> {
  return statePath((await placesOf($)).stateDir, 'plan-usage', key)
}

/** What the plan-usage file for `key` keeps; nothing where there is no
 * file or it does not parse. */
async function readKept($: $, key: string): Promise<Kept> {
  const text = await readText($, await keptPath($, key))
  if (text === null) return {}
  try {
    const kept = parseJson(text)
    return isDict(kept) ? kept as Kept : {}
  } catch {
    return {}
  }
}

/** `kept` written whole to the plan-usage file for `key`, while the ask's
 * lock is held; a failed write leaves the last one, which the next ask
 * reads. */
async function writeKept($: $, key: string, kept: Kept): Promise<void> {
  await writeAtomicVia($, await keptPath($, key), stableJson(kept))
}

/** The file's reading for `key`, and whether it is fresh: another
 * session asked within the minute, or, for the recheck `recheck`, it
 * answers that (answers); or a failure's wait is not over. */
async function keptIfFresh($: $, key: string, now: number,
  recheck: Recheck | null): Promise<{ kept: Kept; fresh: boolean }> {
  const kept = await readKept($, key)
  const fetched = kept.fetched_at
  const fresh = (typeof fetched === 'number' && now >= fetched &&
      (recheck === null ? now - fetched < PLAN_USAGE_EVERY
        : answers(kept, recheck))) ||
    (typeof kept.retry_at === 'number' && now < kept.retry_at)
  return { kept, fresh }
}

/** The lock directory for `key`, under the state directory. */
async function lockDir($: $, key: string): Promise<string> {
  return (await placesOf($)).stateDir + '/plan-usage-' +
    sha256Hex(key).slice(0, 16) + '.lock'
}

/** Takes the lock at `dir`, true where this session holds it now: a
 * `mkdir` that lands, or one that lands again after an abandoned lock is
 * removed. */
async function takeLock($: $, dir: string, now: number): Promise<boolean> {
  const made = async () => (await runVia($, ['/bin/mkdir', '--', dir],
    { timeoutMs: 5_000 })).exitCode === 0
  if (await made()) return true
  const st = await $.fs.stat(dir).catch(() => null)
  if (st && now - st.mtimeMs / 1000 < PLAN_USAGE_LOCK_STALE) return false
  await runVia($, ['/bin/rmdir', '--', dir], { timeoutMs: 5_000 })
    .catch(() => undefined)
  return made()
}

/** planUsageVia's ask: the file's reading where another session asked
 * within the minute or a failure's wait is not over, else, under the lock,
 * the endpoint's answer, kept; a failure logged once and waited out by
 * every session, for a wait that doubles with each failure in a row, or
 * for the answer's `Retry-After` where that is longer.  A recheck,
 * `recheck`, takes the file's reading only where it answers it. */
async function ask($: $, key: string, now: number, recheck: Recheck | null):
  Promise<void> {
  const first = await keptIfFresh($, key, now, recheck)
  plan.kept = first.kept
  if (first.fresh) return
  const auth = await $.session.authorize().catch(() => null)
  // No plan usage with no first-party credential, nor with an API key.
  if (!auth || auth.kind !== 'bearer') return
  const dir = await lockDir($, key)
  if (!await takeLock($, dir, now).catch(() => false)) return
  try {
    // Another session may have asked between the look and the lock.
    const again = await keptIfFresh($, key, now, recheck)
    plan.kept = again.kept
    if (again.fresh) return
    await askHeld($, key, now, auth.handle, again.kept)
  } finally {
    await runVia($, ['/bin/rmdir', '--', dir], { timeoutMs: 5_000 })
      .catch(() => undefined)
  }
}

/** The ask itself, made while holding the lock. */
async function askHeld($: $, key: string, now: number, handle: Handle,
  kept: Kept): Promise<void> {
  const failures = (typeof kept.failures === 'number' ? kept.failures : 0) + 1
  let wait = backoffAfter(failures)
  try {
    const r = await Promise.race([
      $.http.fetch(PLAN_USAGE_URL, { auth: handle,
        headers: { ...PLAN_USAGE_HEADERS } }),
      $.clock.sleep(PLAN_USAGE_TIMEOUT * 1000).then(() => null)])
    if (r === null) {
      throw new Error('no answer in ' + PLAN_USAGE_TIMEOUT + ' s')
    }
    if (!r.ok) {
      wait = Math.max(wait, retryAfter(r.headers?.['retry-after'], now) ?? 0)
      throw new Error('HTTP ' + r.status)
    }
    let raw: unknown
    try {
      raw = parseJson(r.text)
    } catch {
      throw new Error('an answer that is not JSON')
    }
    if (!isDict(raw)) throw new Error('an answer that is not an object')
    plan.answer = { raw, at: now }
    const keys = windowLine(windowKeys(raw))
    if (keys !== plan.keys) {
      plan.keys = keys
      await log($, keys)
    }
    plan.kept = { reading: claudeOauthReading(raw, now), fetched_at: now }
    await writeKept($, key, plan.kept)
  } catch (err) {
    const what = err instanceof Error ? err.message : String(err)
    if (!plan.errors.has(what)) {
      plan.errors.add(what)
      await log($, 'plan usage failed: ' + what)
    }
    plan.kept = { ...kept, retry_at: now + wait, failures }
    await writeKept($, key, plan.kept)
  }
}

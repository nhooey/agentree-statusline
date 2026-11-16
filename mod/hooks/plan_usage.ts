// The plan's usage windows, asked of the account's own usage endpoint as
// the session, as Claude Usage.app asks them: Claude Code's
// `$.session.usage()` names only the plan's week, and this answer holds
// the 5-hour window, the weekly Fable one and the per-model weeks too.
//
// The credential never reaches the mod: `$.session.authorize()` answers an
// opaque handle, and `$.http.fetch` sets the header from it itself, over
// https to a first-party host only.  A session with no first-party
// credential, or signed in with an API key, has no plan usage, and nothing
// is asked for it.
//
// The ask is never on a document's path: a document takes the reading
// kept, and an ask that is due starts after it, whose answer the next
// document takes.  The reading is kept in `$.store`, under the signed-in
// account, so every session on the account shares one ask a minute.
//
// `$.store` has no compare-and-set, so two sessions that look at it
// together could both ask.  The ask is taken under a lock directory in the
// state directory instead, made with `mkdir`, which is atomic across
// processes: the session whose `mkdir` lands asks, and the others take its
// answer from the store a minute later.  A lock older than
// PLAN_USAGE_LOCK_STALE seconds is a session's that died holding it.
import type { EngineInterface } from 'claude-code'

import {
  claudeOauthReading, oauthLimitWindows, pyJsonLoads,
} from '../src/sources.ts'
import type { Reading } from '../src/sources.ts'
import { isDict, pyGet } from '../src/py.ts'
import { sha256Hex } from '../src/sha256.ts'
import { placesOf, runVia } from './engine.ts'
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
 * PLAN_USAGE_LOCK_STALE, so the failure's wait is in the store before
 * another session can take the lock over. */
export const PLAN_USAGE_TIMEOUT = 20
/** Seconds after which a lock directory is taken as abandoned. */
export const PLAN_USAGE_LOCK_STALE = 30
/** Seconds a reading stands in for Claude Code's own: past two failures'
 * waits and the ask after them, the native reading is the fresher. */
export const PLAN_USAGE_FRESH = 7 * 60

/** What `$.store` keeps per account: the reading, when it was asked for,
 * and, after a failure, how many failed in a row and when the next ask may
 * be. */
type Kept = { reading?: Reading; fetched_at?: number; retry_at?: number;
  failures?: number }

/** The seconds to wait after the `failures`th failed ask in a row: the
 * first wait doubled for each failure before it, held to the most. */
export function backoffAfter(failures: number): number {
  return Math.min(PLAN_USAGE_BACKOFF_MAX,
    PLAN_USAGE_BACKOFF * 2 ** Math.max(0, failures - 1))
}

/** The opaque credential handle `$.session.authorize()` answers. */
type Handle = NonNullable<Awaited<ReturnType<$['session']['authorize']>>>[
  'handle']

/** The mod's memory of the asks, for this load. */
const plan = {
  key: '',
  kept: {} as Kept,
  // When the store was last looked at, in seconds; null before the first.
  checkedAt: null as number | null,
  asking: false,
  // The window keys last logged, and each failure logged, so each is
  // logged once a load.
  keys: null as string | null,
  errors: new Set<string>(),
  // This load's own last answer, and when, for the credits to read.
  answer: null as { raw: unknown; at: number } | null,
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
  return 'plan usage: ' + (w.read.join(' ') || 'none') +
    (w.limits.length ? ' · limits: ' + w.limits.join(' ') : '') +
    (w.empty.length ? ' · no reading: ' + w.empty.join(' ') : '')
}

/** The account's plan windows as last asked for, while fresh, else null;
 * and, once PLAN_USAGE_EVERY has passed since the store was last looked
 * at, an ask started behind it.  `who` is the signed-in account. */
export function planUsageVia($: $, who: string, now: number):
  Reading | null {
  const key = 'plan-usage:' + (who || 'default')
  if (key !== plan.key) {
    plan.key = key
    plan.kept = {}
    plan.checkedAt = null
  }
  const due = plan.checkedAt === null ||
    now - plan.checkedAt >= PLAN_USAGE_EVERY || now < plan.checkedAt
  if (due && !plan.asking) {
    plan.asking = true
    plan.checkedAt = now
    void ask($, key, now).catch(() => {}).finally(() => {
      plan.asking = false
    })
  }
  const at = plan.kept.fetched_at
  return plan.kept.reading && typeof at === 'number' &&
    now - at < PLAN_USAGE_FRESH && now >= at ? plan.kept.reading : null
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

/** The store's reading for `key`, and whether it is fresh: another
 * session asked within the minute, or a failure's wait is not over. */
async function keptIfFresh($: $, key: string, now: number):
  Promise<{ kept: Kept; fresh: boolean }> {
  const stored = await $.store.get(key).catch(() => undefined)
  const kept: Kept = isDict(stored) ? stored as Kept : {}
  const fetched = kept.fetched_at
  const fresh = (typeof fetched === 'number' &&
      now - fetched < PLAN_USAGE_EVERY && now >= fetched) ||
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

/** planUsageVia's ask: the store's reading where another session asked
 * within the minute or a failure's wait is not over, else, under the lock,
 * the endpoint's answer, kept; a failure logged once and waited out by
 * every session, for a wait that doubles with each failure in a row, or
 * for the answer's `Retry-After` where that is longer. */
async function ask($: $, key: string, now: number): Promise<void> {
  const first = await keptIfFresh($, key, now)
  plan.kept = first.kept
  if (first.fresh) return
  const auth = await $.session.authorize().catch(() => null)
  // No plan usage with no first-party credential, nor with an API key.
  if (!auth || auth.kind !== 'bearer') return
  const dir = await lockDir($, key)
  if (!await takeLock($, dir, now).catch(() => false)) return
  try {
    // Another session may have asked between the look and the lock.
    const again = await keptIfFresh($, key, now)
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
      raw = pyJsonLoads(r.text)
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
    await $.store.set(key, plan.kept)
  } catch (err) {
    const what = err instanceof Error ? err.message : String(err)
    if (!plan.errors.has(what)) {
      plan.errors.add(what)
      await log($, 'plan usage failed: ' + what)
    }
    plan.kept = { ...kept, retry_at: now + wait, failures }
    await $.store.set(key, plan.kept).catch(() => {})
  }
}

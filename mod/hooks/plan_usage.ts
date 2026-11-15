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
import type { EngineInterface } from 'claude-code'

import { claudeOauthReading, pyJsonLoads } from '../src/sources.ts'
import type { Reading } from '../src/sources.ts'
import { isDict, pyGet } from '../src/py.ts'
import { log } from './log.ts'

type $ = EngineInterface

export const PLAN_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const PLAN_USAGE_HEADERS = { 'anthropic-beta': 'oauth-2025-04-20' }
/** Seconds between asks. */
export const PLAN_USAGE_EVERY = 60
/** Seconds a failed ask waits before the next. */
export const PLAN_USAGE_BACKOFF = 300
/** Seconds a reading stands in for Claude Code's own: past one backoff and
 * the ask after it, the native reading is the fresher. */
export const PLAN_USAGE_FRESH = PLAN_USAGE_BACKOFF + 2 * PLAN_USAGE_EVERY

/** What `$.store` keeps per account: the reading, when it was asked for,
 * and, after a failure, when the next ask may be. */
type Kept = { reading?: Reading; fetched_at?: number; retry_at?: number }

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
 * name: which of them carries Fable is the log's to show. */
export function windowKeys(raw: unknown): string[] {
  if (!isDict(raw)) return []
  return Object.keys(raw).filter((k) => {
    const item = raw[k]
    return isDict(item) && pyGet(item, 'utilization') !== null
  }).sort()
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

/** planUsageVia's ask: the store's reading where another session asked
 * within the minute or a failure's wait is not over, else the endpoint's
 * answer, kept; a failure logged once and waited out. */
async function ask($: $, key: string, now: number): Promise<void> {
  const stored = await $.store.get(key).catch(() => undefined)
  const kept: Kept = isDict(stored) ? stored as Kept : {}
  plan.kept = kept
  const fetched = kept.fetched_at
  if (typeof fetched === 'number' && now - fetched < PLAN_USAGE_EVERY &&
      now >= fetched) return
  if (typeof kept.retry_at === 'number' && now < kept.retry_at) return
  try {
    const auth = await $.session.authorize()
    // No plan usage with no first-party credential, nor with an API key.
    if (!auth || auth.kind !== 'bearer') return
    const r = await $.http.fetch(PLAN_USAGE_URL, { auth: auth.handle,
      headers: { ...PLAN_USAGE_HEADERS } })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    let raw: unknown
    try {
      raw = pyJsonLoads(r.text)
    } catch {
      throw new Error('an answer that is not JSON')
    }
    if (!isDict(raw)) throw new Error('an answer that is not an object')
    plan.answer = { raw, at: now }
    const keys = windowKeys(raw).join(' ')
    if (keys !== plan.keys) {
      plan.keys = keys
      await log($, 'plan usage: ' + (keys || 'none'))
    }
    plan.kept = { reading: claudeOauthReading(raw, now), fetched_at: now }
    await $.store.set(key, plan.kept)
  } catch (err) {
    const what = err instanceof Error ? err.message : String(err)
    if (!plan.errors.has(what)) {
      plan.errors.add(what)
      await log($, 'plan usage failed: ' + what)
    }
    plan.kept = { ...kept, retry_at: now + PLAN_USAGE_BACKOFF }
    await $.store.set(key, plan.kept).catch(() => {})
  }
}

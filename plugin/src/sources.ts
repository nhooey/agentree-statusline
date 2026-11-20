// Usage source selection and the versioned, safe custom-command contract.
//
// As far as the band needs it: the version-1 reading (normalise and its
// validators), the payload's own rate_limits (nativeReading), the scoped
// cache (cachedReading and the refresh cadence), the custom command
// (commandReading), the tracker (claudeUsageTracker) and collect, which
// chooses between them.
//
// NOT READ HERE: anthropic-admin's request; validateSource accepts its
// name, so a spec that names it fails the way an unavailable source does
// (no reading) rather than as an unknown source.
// experimental-claude-oauth's answer is read here (claudeOauthReading); the
// plugin makes its request with the session's own credential.
//
// The reading's exact forms, a float read from a string, a JSON value as
// text and NaN and Infinity in JSON, are exact.ts's, shared with the other
// modules; the "%.6f" tie handling is `pct` in claude_sources.ts and the
// microsecond half-even rounding is `splitTimestamp` here, under
// "Timestamps".
//
// The I/O, the cache files, running a command and reading the tracker, is
// in sources_node.ts for Node and in the plugin's handlers for the plugin, which
// runs with no Node.  collect takes them as arguments, and everything here
// is pure.

import { sha256Hex } from "./sha256.ts";

import type { Dict } from "./py.ts";
import { isDict, pyGet, pyTruthy } from "./py.ts";
import {
  daysFromCivil, daysIn, parseJson, stableJson, toFloat, utf8, valueText,
} from "./exact.ts";

export type { Dict };
export type Reading = Dict;

export const VALID_SOURCES = [
  "auto", "native", "none", "off", "claude-usage-tracker",
  "anthropic-admin", "experimental-claude-oauth",
] as const;

// ════════════════════════════════════════════════════════════════════════════
// Timestamps.
// ════════════════════════════════════════════════════════════════════════════

// A timestamp as whole seconds and microseconds, its fraction rounded to
// whole microseconds, half to even, so x.9999996 is the NEXT second.  A
// JavaScript Date would truncate it to the millisecond below.
export function splitTimestamp(t: number): [number, number] {
  let secs = Math.floor(t);
  const scaled = (t - secs) * 1e6;
  let us = Math.round(scaled);
  if (Math.abs(scaled - Math.trunc(scaled)) === 0.5 && us % 2 !== 0) us -= 1;
  if (us >= 1e6) { us -= 1e6; secs += 1; }
  return [secs, us];
}

// An ISO 8601 timestamp, as datetime.fromisoformat's C implementation in
// 3.9 parses one: YYYY-MM-DD, any one separator, HH[:MM[:SS[.fff[fff]]]],
// and an offset of +HH:MM[:SS[.ffffff]].  Nothing more (a bare "Z", basic
// formats) is read; a reading that leans on those is unavailable.  This
// walks UTF-8 bytes with a NUL after the last, so its corner cases land
// where that implementation's do.  The result is Unix seconds, a naive
// time read as UTC, as epoch() reads it; null where the text is refused.
export function fromIsoformat(text: string): number | null {
  const head = text.slice(0, 10);
  if (/[^\x00-\x7f]/.test(head)) return null;
  const sepCode = text.codePointAt(10);
  const sepLen = sepCode !== undefined && sepCode > 0xffff ? 2 : 1;
  const bytes = new TextEncoder().encode(head);
  const timeBytes = text.length > 10
    ? new TextEncoder().encode(text.slice(10 + sepLen)) : null;
  const at = (buf: Uint8Array, k: number) => (k < buf.length ? buf[k] : 0);
  const digits = (buf: Uint8Array, k: number, n: number): number | null => {
    let v = 0;
    for (let j = 0; j < n; j++) {
      const d = at(buf, k + j) - 48;
      if (d < 0 || d > 9) return null;
      v = v * 10 + d;
    }
    return v;
  };
  const year = digits(bytes, 0, 4);
  if (year === null || at(bytes, 4) !== 45) return null;
  const month = digits(bytes, 5, 2);
  if (month === null || at(bytes, 7) !== 45) return null;
  const day = digits(bytes, 8, 2);
  if (day === null) return null;

  // parse_hh_mm_ss_ff: [HH[:MM[:SS]]][.fff[fff]] between start and end.
  const hhmmss = (buf: Uint8Array, start: number, end: number,
                  out: number[]): number => {
    let p = start;
    let i = 0;
    for (; i < 3; i++) {
      const v = digits(buf, p, 2);
      if (v === null) return -3;
      out[i] = v;
      p += 2;
      const c = at(buf, p++);
      if (p >= end) return c !== 0 ? 1 : 0;
      if (c === 58) continue;
      if (c === 46) break;
      return -4;
    }
    const remains = end - p;
    if (remains !== 6 && remains !== 3) return -3;
    const us = digits(buf, p, remains);
    if (us === null) return -3;
    out[3] = remains === 3 ? us * 1000 : us;
    return 0;
  };

  const t = [0, 0, 0, 0];
  let offset = 0, offsetUs = 0;
  if (timeBytes !== null) {
    const end = timeBytes.length;
    let tz = 0;
    do {
      const c = at(timeBytes, tz);
      if (c === 43 || c === 45) break;
    } while (++tz < end);
    const rv = hhmmss(timeBytes, 0, tz, t);
    if (rv < 0) return null;
    if (tz === end) {
      if (rv === 1) return null;
    } else {
      const tzlen = end - tz;
      if (tzlen !== 6 && tzlen !== 9 && tzlen !== 16) return null;
      const sign = at(timeBytes, tz) === 45 ? -1 : 1;
      const z = [0, 0, 0, 0];
      const zr = hhmmss(timeBytes, tz + 1, end, z);
      if (zr !== 0) return null;
      offset = sign * (z[0] * 3600 + z[1] * 60 + z[2]);
      offsetUs = sign * z[3];
      // timezone() takes an offset strictly inside a day.
      if (Math.abs(offset * 1e6 + offsetUs) >= 86400e6) return null;
    }
  }
  if (year < 1 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysIn(year, month)) return null;
  if (t[0] > 23 || t[1] > 59 || t[2] > 59) return null;
  const secs = daysFromCivil(year, month, day) * 86400 +
    t[0] * 3600 + t[1] * 60 + t[2] - offset;
  // total_seconds() divides whole microseconds by a million, once.
  return (secs * 1e6 + t[3] - offsetUs) / 1e6;
}

// ════════════════════════════════════════════════════════════════════════════
// The version-1 reading.
// ════════════════════════════════════════════════════════════════════════════

export function safeText(value: unknown, maximum = 128): string | null {
  if (typeof value !== "string" || !value) return null;
  // len() counts code points, not UTF-16 units.
  if ([...value].length > maximum) return null;
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c < 32 || (c >= 127 && c <= 159)) return null;
  }
  return value;
}

export const MIN_EPOCH = 0.0, MAX_EPOCH = 4102444800.0;  // 1970 through 2100

export function epoch(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= MIN_EPOCH && value <= MAX_EPOCH
      ? value : null;
  }
  if (typeof value === "string") {
    const stamp = fromIsoformat(value.replaceAll("Z", "+00:00"));
    return stamp !== null && stamp >= MIN_EPOCH && stamp <= MAX_EPOCH
      ? stamp : null;
  }
  return null;
}

export function number(value: unknown, upper: number | null = null):
    number | null {
  if (typeof value === "boolean") return null;
  const n = toFloat(value);
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  if (upper !== null && n > upper) return null;
  return n;
}

const TOKEN_NAMES = ["input_tokens", "cached_input_tokens", "output_tokens",
                     "reasoning_output_tokens"];

export function tokens(value: unknown): Dict {
  const v = isDict(value) ? value : {};
  const out: { [k: string]: number | null } = {};
  for (const name of TOKEN_NAMES) out[name] = number(pyGet(v, name));
  // Cached read is a subset of input; creation is input but not cache-read.
  const inp = out.input_tokens, cached = out.cached_input_tokens;
  if (inp !== null && cached !== null && cached > inp) return {};
  const outp = out.output_tokens, reasoning = out.reasoning_output_tokens;
  if (outp !== null && reasoning !== null && reasoning > outp) return {};
  const kept: Dict = {};
  for (const name of TOKEN_NAMES) {
    if (out[name] !== null) kept[name] = out[name];
  }
  return kept;
}

export const CREDIT_KINDS = ["cloud", "promo", "prepaid", "extra", "passes"];

/** The credits[] list: each entry whole or dropped, never guessed.  An
 * entry needs an id, a known kind and what is left; one whose figures
 * contradict each other (more left than granted, an expiry before its
 * grant) is dropped.  The first entry with an id wins. */
export function credits(value: unknown): Dict[] {
  const out: Dict[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(value) ? value : []) {
    if (!isDict(raw)) continue;
    const ident = safeText(pyGet(raw, "id"), 128);
    const kind = pyGet(raw, "kind");
    const remaining = number(pyGet(raw, "remaining"));
    if (ident === null || seen.has(ident) || typeof kind !== "string" ||
        !CREDIT_KINDS.includes(kind) || remaining === null) continue;
    const item: Dict = { id: ident, kind, remaining };
    for (const name of ["granted", "spent"]) {
      const figure = number(pyGet(raw, name));
      if (figure !== null) item[name] = figure;
    }
    if (typeof item.granted === "number" && remaining > item.granted) continue;
    for (const name of ["expires_at", "granted_at"]) {
      const stamp = epoch(pyGet(raw, name));
      if (stamp !== null) item[name] = stamp;
    }
    if (typeof item.granted_at === "number" &&
        typeof item.expires_at === "number" &&
        item.expires_at < item.granted_at) continue;
    const currency = pyGet(raw, "currency");
    if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency)) {
      item.currency = currency;
    }
    for (const [name, maximum] of [["label", 128], ["applies_to", 64]] as
         const) {
      const safe = safeText(pyGet(raw, name), maximum);
      if (safe !== null) item[name] = safe;
    }
    seen.add(ident);
    out.push(item);
  }
  return out;
}

// Whitelist the v1 source fields; malformed numbers are unavailable.
export function normalise(value: unknown, source = ""): Reading {
  if (!isDict(value) || pyGet(value, "schema_version") !== 1) return {};
  const wins: Dict[] = [];
  const rawBuckets = pyGet(value, "buckets");
  let windows: Dict[];
  // Buckets are canonical.  Do not combine them with an old flat shadow,
  // since a cached canonical result can otherwise double every quota.
  if (rawBuckets !== null) {
    if (!Array.isArray(rawBuckets)) return {};
    windows = [];
    for (const bucket of rawBuckets) {
      if (!isDict(bucket)) continue;
      const bucketId = safeText(pyGet(bucket, "id"), 128);
      const nested = pyGet(bucket, "windows");
      if (bucketId === null || !Array.isArray(nested)) continue;
      for (const nestedWindow of nested) {
        if (!isDict(nestedWindow)) continue;
        const copy: Dict = { ...nestedWindow, bucket_id: bucketId };
        if (Object.hasOwn(bucket, "label") &&
            !Object.hasOwn(copy, "heading")) {
          copy.heading = bucket.label;
        }
        for (const field of ["model", "feature"]) {
          if (Object.hasOwn(bucket, field) && !Object.hasOwn(copy, field)) {
            copy[field] = bucket[field];
          }
        }
        windows.push(copy);
      }
    }
  } else {
    const flat = pyGet(value, "windows", []);
    if (!Array.isArray(flat)) return {};
    windows = flat.filter(isDict).map((w) => ({ ...w }));
  }
  for (const w of windows) {
    const ident = safeText(pyGet(w, "id"));
    if (ident === null) continue;
    const item: Dict = {
      id: ident,
      duration_seconds: number(pyGet(w, "duration_seconds")),
      used_percent: number(pyGet(w, "used_percent"), 100),
      resets_at: epoch(pyGet(w, "resets_at")),
    };
    for (const field of ["bucket_id", "heading", "model", "feature"]) {
      const safe = safeText(pyGet(w, field), 128);
      if (safe !== null) item[field] = safe;
    }
    // Missing usage is a valid quota window; it is not invented as zero.
    wins.push(item);
  }
  const rawAccount = pyGet(value, "account");
  const account: Dict = isDict(rawAccount) ? rawAccount : {};
  const safeAccount: Dict = {};
  for (const name of ["period_start", "period_end"]) {
    const e = epoch(pyGet(account, name));
    if (e !== null) safeAccount[name] = e;
  }
  Object.assign(safeAccount, tokens(account));
  const cost = number(pyGet(account, "cost_usd"));
  if (cost !== null) safeAccount.cost_usd = cost;
  const scope = safeText(pyGet(account, "scope"), 64);
  if (scope !== null) safeAccount.scope = scope;
  const ps = safeAccount.period_start, pe = safeAccount.period_end;
  if (typeof ps === "number" && typeof pe === "number" && pe < ps) return {};
  // A Map, not an object: an object would put a bucket called "1" before
  // one called "a" whatever order they came in.
  const grouped = new Map<string, Dict>();
  for (const window of wins) {
    const bucketId = (window.bucket_id as string | undefined) || "default";
    let bucket = grouped.get(bucketId);
    if (bucket === undefined) {
      bucket = { id: bucketId,
                 label: (window.heading as string | undefined) || "default",
                 windows: [] };
      grouped.set(bucketId, bucket);
    }
    for (const field of ["model", "feature"]) {
      if (window[field] !== undefined) bucket[field] = window[field];
    }
    const child: Dict = {};
    for (const [k, v] of Object.entries(window)) {
      if (!["bucket_id", "heading", "model", "feature"].includes(k)) {
        child[k] = v;
      }
    }
    (bucket.windows as Dict[]).push(child);
  }
  const reading: Reading = { schema_version: 1, source,
    as_of: epoch(pyGet(value, "as_of")), buckets: [...grouped.values()],
    account: safeAccount };
  // Absent, not empty, when there are none, so a reading without credits
  // is the same as before they were read.
  const found = credits(pyGet(value, "credits"));
  if (found.length) reading.credits = found;
  return reading;
}

// An envelope alone is not a source response and must not replace cache.
export function hasReading(value: unknown): boolean {
  if (!isDict(value)) return false;
  const rawAccount = pyGet(value, "account");
  const account: Dict = isDict(rawAccount) ? rawAccount : {};
  const buckets = pyGet(value, "buckets");
  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    const windows = isDict(bucket) ? pyGet(bucket, "windows") : null;
    for (const window of Array.isArray(windows) ? windows : []) {
      if (isDict(window) && number(pyGet(window, "used_percent")) !== null) {
        return true;
      }
    }
  }
  const found = pyGet(value, "credits");
  if (Array.isArray(found) && found.some((c) =>
      isDict(c) && number(pyGet(c, "remaining")) !== null)) return true;
  return ["input_tokens", "cached_input_tokens", "output_tokens",
          "reasoning_output_tokens", "cost_usd"]
    .some((name) => number(pyGet(account, name)) !== null);
}

// `kind:` and the first 24 hex digits of the sha256 of an account's id, or
// "" for no id: what keys the calibration cache to an account
// (seedLimitsSnapshot) without the id itself reaching any file.
export function hashedAccountId(kind: string, value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return kind + ":" + sha256Hex(value).slice(0, 24);
}

// An account's id as hashedAccountId gives it, and nothing else: the one
// identity a reading carries from its source, through the cache, to the
// calibration scope.
const ACCOUNT_ID = /^(?:profile|account):[0-9a-f]{24}$/;

export function accountId(value: unknown): string | null {
  const text = isDict(value) ? pyGet(value, "account_id") : null;
  return typeof text === "string" && ACCOUNT_ID.test(text) ? text : null;
}

// Re-whitelist cache content and make stale/expired state visible.
export function cachedReading(value: unknown, source: string, now: number,
                              ttl: number): Reading {
  const clean = normalise(value, source);
  if (!hasReading(clean)) return {};
  const asOf = epoch(pyGet(value as Dict, "as_of"));
  clean.as_of = asOf;
  clean.stale = asOf === null || now - asOf >= ttl;
  for (const name of ["fetched_at", "attempted_at", "retry_at",
                      "fail_count"]) {
    const n = number(pyGet(value as Dict, name));
    if (n !== null) clean[name] = n;
  }
  // Not normalise's: a command's output does not name the account.
  const account = accountId(value);
  if (account !== null) clean.account_id = account;
  // A quota whose reset has passed is historical, not a live availability.
  for (const bucket of clean.buckets as Dict[]) {
    for (const window of bucket.windows as Dict[]) {
      const reset = window.resets_at;
      if (typeof reset === "number" && reset <= now) window.expired = true;
    }
  }
  return clean;
}

// Refresh cadence follows fetch time, never an old provider observation.
export function refreshDue(rawCache: unknown, now: number,
                           ttl: number): boolean {
  const cache = isDict(rawCache) ? rawCache : null;
  const retryAt = cache ? number(pyGet(cache, "retry_at")) : null;
  if (retryAt !== null && now < retryAt) return false;
  const fetched = cache ? number(pyGet(cache, "fetched_at")) : null;
  return fetched === null || now - fetched >= ttl;
}

function failureCache(rawCache: unknown, now: number, _ttl: number,
                             retryAfter: number | null = null): Dict {
  const value: Dict = isDict(rawCache) ? { ...rawCache } : {};
  const count = Math.trunc(number(pyGet(value, "fail_count")) || 0) + 1;
  let delay = Math.min(300.0, 2 ** Math.min(count, 8));
  if (retryAfter !== null) {
    delay = Math.min(300.0, Math.max(delay, retryAfter));
  }
  Object.assign(value, { attempted_at: now, fail_count: count,
                         retry_at: now + delay,
                         fetched_at: pyGet(value, "fetched_at") });
  return value;
}

// Attach non-secret scope to every returned normalized reading.
export function tagIdentity(reading: Reading, agent: string, source: string,
                            namespace: string, periodKey: string): Reading {
  if (!isDict(reading) || !pyTruthy(reading)) return reading;
  return { ...reading, agent,
           source: source || pyGet(reading, "source", ""),
           account_name: namespace, period_start: periodKey };
}

export function validateSource(_agent: string, spec: string | null): string {
  spec = spec || "auto";
  if (spec.startsWith("cmd:")) return spec;
  if (!(VALID_SOURCES as readonly string[]).includes(spec)) {
    throw new Error("unknown usage source '" + spec + "'");
  }
  return spec;
}

// The UTC period an account reading covers, as [start, end].  End is now
// through a datetime, so to the microsecond.
export function periodBounds(kind: string, now: number): [number, number] {
  const [secs, us] = splitTimestamp(now);
  const day = Math.floor(secs / 86400);
  let startDay: number;
  if (kind === "day") startDay = day;
  // 1970-01-01 was a Thursday: Monday is three days on.
  else if (kind === "week") startDay = day - ((day + 3) % 7 + 7) % 7;
  else if (kind === "month") {
    const d = new Date(day * 86400000);
    startDay = daysFromCivil(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  } else throw new Error("account period must be day, week, or month");
  return [startDay * 86400, (secs * 1e6 + us) / 1e6];
}

const CREDENTIALS: { [spec: string]: string } = {
  "anthropic-admin": "ANTHROPIC_ADMIN_KEY",
  "experimental-claude-oauth": "CLAUDE_OAUTH_ACCESS_TOKEN",
};

// Avoid cache reuse after an implicit managed-account switch.  The
// credentials are read from `env`, which the edge passes in.
export function cacheNamespace(spec: string, account: string, context: unknown,
                               env: { [k: string]: string | undefined }):
    string {
  if (account && account !== "default") return String(account);
  const ctx = isDict(context) ? context : {};
  // os.environ.get("") is "" in practice, as the empty name is never set.
  const name = CREDENTIALS[spec] ?? "";
  const value = (name && env[name]) || "";
  if (value) {
    return "credential:" +
      sha256Hex(value).slice(0, 24);
  }
  const session = safeText(pyGet(ctx, "session"), 256);
  if (session) return "session:" + session;
  return "default";
}

// Claude Code's name for the weekly Fable window, beside `seven_day`: a
// window a week long that the 💳 row draws apart from the plan's own.
export const FABLE_WINDOW = "seven_day_overage_included";

// The other weekly windows the 💳 row can draw after the Fable one, each
// by its key in the `weekly-windows` option and the `hide` group `plan`,
// with the window's id.  A seven_day_* window not named here is kept in
// the reading but drawn nowhere: it has no mark of its own.
export const WEEKLY_WINDOWS = [["opus", "seven_day_opus"],
  ["sonnet", "seven_day_sonnet"], ["omelette", "seven_day_omelette"],
  ["oauth_apps", "seven_day_oauth_apps"],
  ["cowork", "seven_day_cowork"]] as const;
export type WeeklyKey = typeof WEEKLY_WINDOWS[number][0];

// Translate Claude Code's rate_limits without inventing fields.
export function nativeWindows(value: unknown): Dict[] {
  const raw = isDict(value) ? pyGet(value, "rate_limits", value) : {};
  const windows: Dict[] = [];
  if (!isDict(raw)) return windows;
  const sourceBucket = valueText(pyTruthy(raw.limit_id) ? raw.limit_id
                             : "default");
  const others: string[] = WEEKLY_WINDOWS.map(([, id]) => id);
  const weekly = ["seven_day", FABLE_WINDOW, ...others];
  for (const key of ["five_hour", "seven_day", FABLE_WINDOW, ...others]) {
    const item = pyGet(raw, key);
    if (!isDict(item)) continue;
    const usage = pyGet(item, "used_percentage", pyGet(item, "used_percent"));
    if (usage === null) continue;
    let duration = pyGet(item, "duration_seconds");
    if (duration === null && key === "five_hour") duration = 5 * 3600;
    if (duration === null && weekly.includes(key)) {
      duration = 7 * 86400;
    }
    windows.push({
      id: key, duration_seconds: duration, used_percent: usage,
      resets_at: pyGet(item, "resets_at", pyGet(item, "reset_at")),
      bucket_id: valueText(firstTruthy(pyGet(item, "bucket_id"),
                                   pyGet(item, "limit_id"), sourceBucket)),
      heading: valueText(firstTruthy(pyGet(item, "heading"), sourceBucket)),
    });
  }
  return windows;
}

// `a or b or c`.
function firstTruthy(...values: unknown[]): unknown {
  for (const v of values.slice(0, -1)) if (pyTruthy(v)) return v;
  return values[values.length - 1];
}

// Native readings are supplied by Claude Code, never refreshed.
export function nativeReading(_agent: string, context: unknown): Reading {
  const ctx = isDict(context) ? context : {};
  const raw = firstTruthy(pyGet(ctx, "rate_limits"), {});
  const windows = nativeWindows(raw);
  if (!windows.length) return {};
  return normalise({ schema_version: 1, as_of: pyGet(ctx, "as_of"),
                     windows }, "native");
}

// The tracker's figures, read down by trackerReading, as a v1 reading.
// Apart from the read, so the reading is pure and the read is not.
export function trackerV1(raw: Dict): Reading {
  const windows: Dict[] = [];
  for (const [ident, pct, reset, duration] of [
    ["five_hour", pyGet(raw, "session_pct"),
     pyGet(raw, "session_resets_at"), 18000],
    ["seven_day", pyGet(raw, "weekly_pct"),
     pyGet(raw, "weekly_resets_at"), 604800],
    ["seven_day_opus", pyGet(raw, "weekly_opus_pct"),
     pyGet(raw, "weekly_resets_at"), 604800],
    ["seven_day_overage_included", pyGet(raw, "weekly_fable_pct"),
     pyGet(raw, "weekly_resets_at"), 604800],
  ] as const) {
    if (pct !== null) {
      windows.push({ id: ident, duration_seconds: duration,
                     used_percent: pct, resets_at: reset });
    }
  }
  const reading = normalise({ schema_version: 1, as_of: pyGet(raw, "as_of"),
                              windows }, "claude-usage-tracker");
  const account = accountId(raw);
  if (pyTruthy(reading) && account !== null) reading.account_id = account;
  return reading;
}

// What a command is handed on stdin: the scalar scope, never a payload.
// json.dumps writes the period bounds as floats, so they keep their ".0".
export function commandInput(context: unknown): string {
  const ctx = isDict(context) ? context : {};
  const safe: Dict = {};
  for (const key of ["agent", "session", "model", "account", "period"]) {
    const text = safeText(pyGet(ctx, key), 256);
    if (text !== null) safe[key] = text;
  }
  for (const key of ["period_start", "period_end"]) {
    const value = epoch(pyGet(ctx, key));
    if (value !== null) safe[key] = value;
  }
  return stableJson(safe, { floats: ["period_start", "period_end"] });
}

// A command's stdout, as a reading: strict UTF-8, one JSON value, and the
// old flat adapter shape still accepted.  {} for anything else.
export function commandOutput(output: Uint8Array): Reading {
  let value: unknown;
  try {
    const text = utf8(output, true, true);
    value = parseJson(text);
  } catch {
    return {};
  }
  if (isDict(value) && !Object.hasOwn(value, "schema_version") &&
      ["session_pct", "weekly_pct", "session_resets_at", "weekly_resets_at"]
        .some((key) => Object.hasOwn(value as Dict, key))) {
    // old flat adapter
    value = { schema_version: 1, as_of: pyGet(value, "as_of"), windows: [
      { id: "session", used_percent: pyGet(value, "session_pct"),
        resets_at: pyGet(value, "session_resets_at") },
      { id: "week", used_percent: pyGet(value, "weekly_pct"),
        resets_at: pyGet(value, "weekly_resets_at") }] };
  }
  return normalise(value, "cmd");
}

// ════════════════════════════════════════════════════════════════════════════
// collect: which reading, from where.
// ════════════════════════════════════════════════════════════════════════════

// The scoped cache, in the state directory.  sources_node.ts's fileStore is
// the real one in Node; the plugin's reads through `$`, so each method may
// answer with a promise.
export interface Store {
  load(agent: string, source: string, account: string,
       periodStart: string): Dict | Promise<Dict>;
  save(agent: string, source: string, account: string, periodStart: string,
       value: Dict): void | Promise<void>;
  findCompatible(agent: string, account: string,
                 periodStart: string): Dict | Promise<Dict>;
}

// Runs one collector.  `failure` may be given a retry_after, as the HTTP
// sources do; none of the ones read here sets it.
/** oauthWindowNames: the plan windows of /api/oauth/usage's answer `raw`
 * to read, in order: the 5-hour one, the plan's week and the Fable week,
 * then every other `seven_day_*` key, by name, since the answer adds
 * per-model weeks under names of its own (seven_day_opus,
 * seven_day_sonnet, seven_day_omelette, …).  The plan's week comes before
 * the others, which are as long. */
export function oauthWindowNames(raw: Dict): string[] {
  const first = ["five_hour", "seven_day", FABLE_WINDOW];
  return [...first, ...Object.keys(raw)
    .filter((k) => k.startsWith("seven_day_") && !first.includes(k) &&
      k !== FABLE_KEY)
    .sort()];
}

/** The answer's key that also holds the Fable week, read where
 * FABLE_WINDOW's own key has no utilization. */
const FABLE_KEY = "seven_day_fable";

/** The window `name` of the answer `raw` as its keys give it, where it has
 * a utilization, else null: the Fable window from FABLE_WINDOW's key, else
 * from FABLE_KEY. */
function legacyWindow(raw: Dict, name: string): Dict | null {
  const keys = name === FABLE_WINDOW ? [FABLE_WINDOW, FABLE_KEY] : [name];
  for (const key of keys) {
    const item = pyGet(raw, key, {});
    if (isDict(item) && pyGet(item, "utilization") !== null) return item;
  }
  return null;
}

// The per-model weeks of the answer's `limits` list, by the words a
// model's scope is told by, as Claude Usage.app tells them: a display name
// equal to one, or a model id holding one.  The first that matches wins.
const OAUTH_LIMIT_MODELS: [string, string, string[]][] = [
  ["fable", FABLE_WINDOW, ["fable", "mythos"]],
  ["opus", "seven_day_opus", ["opus"]],
  ["sonnet", "seven_day_sonnet", ["sonnet"]],
  ["omelette", "seven_day_omelette", ["design", "omelette"]],
];

/** The per-model weeks in the `limits` list of
 * /api/oauth/usage's answer `raw`, as [key, window id, entry], in the
 * list's order.  Each is a `weekly_scoped` entry with a model scope and a
 * percent: the Fable one is FABLE_WINDOW, the Opus, Sonnet and Design
 * ones their seven_day_* windows, and another model
 * `seven_day_<its id, else its name>`, lowercased with every run of other
 * characters an underscore.  An entry of any other kind, the session's
 * and the plan's week among them, is not read here. */
export function oauthLimitWindows(raw: unknown): [string, string, Dict][] {
  const limits = isDict(raw) ? pyGet(raw, "limits") : null;
  const out: [string, string, Dict][] = [];
  for (const entry of Array.isArray(limits) ? limits : []) {
    if (!isDict(entry) || pyGet(entry, "kind") !== "weekly_scoped" ||
        pyGet(entry, "percent") === null) continue;
    const scope = pyGet(entry, "scope");
    const model = isDict(scope) ? pyGet(scope, "model") : null;
    if (!isDict(model)) continue;
    const text = (v: unknown) => typeof v === "string" ? v.toLowerCase() : "";
    const id = text(pyGet(model, "id"));
    const name = text(pyGet(model, "display_name"));
    const known = OAUTH_LIMIT_MODELS.find(([, , words]) =>
      words.some((w) => name === w || id.includes(w)));
    if (known) {
      out.push([known[0], known[1], entry]);
      continue;
    }
    const key = (id || name).replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (key) out.push([key, "seven_day_" + key, entry]);
  }
  return out;
}

/** The experimental-claude-oauth source's reading of /api/oauth/usage's
 * answer `raw`, taken at `now`: each window oauthWindowNames names that
 * has a utilization, and each per-model week of its `limits` list, which
 * stands over the window of the same id, keeping that window's reset
 * where it gives none.  The answer nulls the per-model seven_day_* windows
 * where the list holds them. */
export function claudeOauthReading(raw: unknown, now: number): Reading {
  if (!isDict(raw)) return {};
  const scoped = new Map<string, Dict>();
  for (const [, id, entry] of oauthLimitWindows(raw)) scoped.set(id, entry);
  const names = oauthWindowNames(raw);
  const first = names.slice(0, 3);
  const rest = [...new Set([...names.slice(3), ...scoped.keys()])]
    .filter((k) => !first.includes(k)).sort();
  const windows: Dict[] = [];
  for (const name of [...first, ...rest]) {
    const legacy = legacyWindow(raw, name);
    const entry = scoped.get(name);
    const duration = name === "five_hour" ? 18000 : 604800;
    if (entry !== undefined) {
      const reset = pyGet(entry, "resets_at");
      windows.push({ id: name, duration_seconds: duration,
                     used_percent: pyGet(entry, "percent"),
                     resets_at: reset !== null ? reset
                       : legacy !== null ? pyGet(legacy, "resets_at") : null });
    } else if (legacy !== null) {
      windows.push({ id: name, duration_seconds: duration,
                     used_percent: pyGet(legacy, "utilization"),
                     resets_at: pyGet(legacy, "resets_at") });
    }
  }
  return normalise({ schema_version: 1, as_of: now, windows },
                   "experimental-claude-oauth");
}

// The account's dollar credits are read apart from its plan windows, which
// auto takes from the payload and so never asks the OAuth answer for: the
// plugin asks it every CREDITS_TTL seconds and keeps the credits per account in
// one small file, and the status line reads that file without fetching.
export const CREDITS_SOURCE = "credits";
export const CREDITS_PERIOD = "credits";
export const CREDITS_TTL = 300;

/** The credits in /api/oauth/usage's answer `raw`, as credits[] entries
 * before `credits` checks them: each window with a dollar limit, taken by
 * its fields and never its name, as the cloud session credit; and extra
 * usage, while it is on and has a cap, its figures in dollars. */
export function oauthCredits(raw: unknown): Dict[] {
  if (!isDict(raw)) return [];
  const out: Dict[] = [];
  for (const [key, item] of Object.entries(raw)) {
    if (!isDict(item) || number(pyGet(item, "limit_dollars")) === null) {
      continue;
    }
    out.push({ id: key, kind: "cloud",
               remaining: pyGet(item, "remaining_dollars"),
               granted: pyGet(item, "limit_dollars"),
               spent: pyGet(item, "used_dollars"), currency: "USD",
               expires_at: pyGet(item, "resets_at") });
  }
  const extra = pyGet(raw, "extra_usage");
  if (isDict(extra) && pyGet(extra, "is_enabled") === true) {
    const cap = number(pyGet(extra, "monthly_limit"));
    const used = number(pyGet(extra, "used_credits"));
    if (cap !== null && used !== null) {
      out.push({ id: "extra_usage", kind: "extra",
                 remaining: Math.max(0, cap - used), granted: cap,
                 spent: used, currency: pyGet(extra, "currency") });
    }
  }
  return out;
}

/** The credits reading of the OAuth answer `raw`, taken at `now`. */
export function creditsReading(raw: unknown, now: number): Reading {
  return normalise({ schema_version: 1, as_of: now,
                     credits: oauthCredits(raw) }, CREDITS_SOURCE);
}

export type Fetch = (selected: string, context: Dict, start: number,
                     end: number, failure: Dict) => Promise<unknown>;

export type Env = { [name: string]: string | undefined };

// Claude Code's signed-in account, hashed, as configAccountId
// reads it from its config; "" for none.  The edge reads the file.
export type AccountOf = () => string | Promise<string>;

const HTTP_SOURCES = ["anthropic-admin", "experimental-claude-oauth"];

// Collect one selected reading with source/account/UTC-period isolation.
// Under auto, Claude's fallback is `claudeFallback`: the tracker, or for
// the plugin, which can ask with the session's own credential,
// experimental-claude-oauth.  The plugin alone may also pass
// `preferred`, the plan's usage windows it asked the account's usage
// endpoint for itself (hooks/plan_usage.ts), which auto takes over the
// native reading, since Claude Code's native reading names only the plan's
// week; null for none.
//
// The cache and the collectors are arguments, so this decides and they do.
// No lock is taken around the refresh: Node has no flock, and the cost of
// two refreshes racing is one extra tracker read.
//
// Each window of the reading is at the highest the account has read for it
// (accountHigh).
export async function collect(agent: string, spec: string | null,
                              account: string, period: string,
                              context: unknown, now: number, store: Store,
                              fetch: Fetch, env: Env = {},
                              configAccount: AccountOf = () => "",
                              claudeFallback = "claude-usage-tracker",
                              preferred: Reading | null = null):
    Promise<Reading> {
  return accountHigh(agent, await collectOne(agent, spec, account, period,
    context, now, store, fetch, env, configAccount, claudeFallback,
    preferred), now, store);
}

// A plan window's use only rises until it resets, so the highest any
// reading of the account has given for one window is the truest: a session
// idle since its last response keeps the figure that response carried, and
// its status line writes it again, stamped with the time of writing, on
// every draw.  The highs are kept per account in one small file, so no draw
// reads every cache.
export const HIGHS_SOURCE = "window-highs";
export const HIGHS_PERIOD = "highs";

/** The account a reading is of: its account id, else the account name a
 * reading shared by every session on the account is cached under. */
function accountOf(reading: Dict): string {
  for (const value of [pyGet(reading, "account_id"),
                       pyGet(reading, "account_name")]) {
    if (typeof value === "string" && ACCOUNT_ID.test(value)) return value;
  }
  return "";
}

/** A window's key among the highs.  Sources stamp one reset a fraction of
 * a second apart: by the nearest minute, rounded half up. */
function highKey(bucket: Dict, window: Dict, reset: number): string {
  const name = (d: Dict) => {
    const v = pyGet(d, "id");
    return pyTruthy(v) ? valueText(v) : "";
  };
  return name(bucket) + "\0" + name(window) + "\0" +
    String(Math.floor((reset + 30) / 60));
}

/** `reading` with each window's used percent raised to the highest the
 * account has read for that window, the bucket, window and reset the same;
 * and the account's highs raised to its figures, saved when they rise.  A
 * reading that names no account is left as it is. */
export async function accountHigh(agent: string, reading: Reading,
                                  now: number, store: Store):
    Promise<Reading> {
  if (!isDict(reading) || !hasReading(reading)) return reading;
  const id = accountOf(reading);
  if (!id) return reading;
  const loaded = pyGet(await store.load(agent, HIGHS_SOURCE, id,
                                        HIGHS_PERIOD), "windows");
  const stored: Dict = isDict(loaded) ? loaded : {};
  const highs: Dict = {};
  for (const [key, item] of Object.entries(stored)) {
    if (!isDict(item)) continue;
    const pct = number(pyGet(item, "used_percent"));
    const reset = epoch(pyGet(item, "resets_at"));
    if (pct !== null && reset !== null && reset > now) {
      highs[key] = { used_percent: item.used_percent, resets_at: reset };
    }
  }
  const raised = JSON.parse(JSON.stringify(reading)) as Dict;
  let rose = false;
  const buckets = pyGet(raised, "buckets");
  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    if (!isDict(bucket)) continue;
    const windows = pyGet(bucket, "windows");
    for (const window of Array.isArray(windows) ? windows : []) {
      if (!isDict(window)) continue;
      const pct = number(pyGet(window, "used_percent"));
      const reset = epoch(pyGet(window, "resets_at"));
      if (pct === null || reset === null || reset <= now) continue;
      const key = highKey(bucket, window, reset);
      const high = highs[key] as Dict | undefined;
      const was = high ? number(high.used_percent) ?? 0 : null;
      if (was === null || pct > was) {
        // The figure as the source gave it.
        highs[key] = { used_percent: window.used_percent, resets_at: reset };
        rose = true;
      } else if (was > pct) {
        window.used_percent = high!.used_percent;
      }
    }
  }
  if (rose || Object.keys(highs).length !== Object.keys(stored).length) {
    await store.save(agent, HIGHS_SOURCE, id, HIGHS_PERIOD,
                     { windows: highs });
  }
  return raised;
}

async function collectOne(agent: string, spec: string | null,
                          account: string, period: string,
                          context: unknown, now: number, store: Store,
                          fetch: Fetch, env: Env,
                          configAccount: AccountOf,
                          claudeFallback: string,
                          preferred: Reading | null):
    Promise<Reading> {
  spec = validateSource(agent, spec);
  const [start, end] = periodBounds(period, now);
  const periodKey = String(start);
  const ctx: Dict = { ...(isDict(context) ? context : {}), agent, account,
                      period, period_start: start, period_end: end };
  const namespace = cacheNamespace(spec, account, ctx, env);
  const native = nativeReading(agent, ctx);
  if (pyTruthy(native) && agent === "claude") {
    // The payload names no account; Claude Code's config does.
    const id = await configAccount();
    if (id) native.account_id = id;
  }
  let staleNative: Reading = {};
  const rawNativeCache = await store.load(agent, "native", namespace, periodKey);
  let cachedNative = cachedReading(rawNativeCache, "native", now, 60);
  let currentNative = pyTruthy(native)
    ? cachedReading(native, "native", now, 60) : {};
  // Native intake is local data, but a fresh normalized observation must be
  // available to a later Stop payload that contains no native quota block.
  // Stale input remains authoritative for this invocation only and may not
  // downgrade a newer cached observation.
  if (pyTruthy(currentNative) && !pyTruthy(currentNative.stale)) {
    const saved = tagIdentity(currentNative, agent, "native", namespace,
                              periodKey);
    saved.fetched_at = now;
    await store.save(agent, "native", namespace, periodKey, saved);
    cachedNative = currentNative = saved;
  }
  // The plugin's own reading of the account's usage endpoint, under auto,
  // over the native one: shared by every session on the account, as the
  // HTTP sources' are.
  if (spec === "auto" && agent === "claude" && preferred !== null &&
      hasReading(preferred)) {
    const id = await configAccount();
    const mine = cachedReading(preferred, "experimental-claude-oauth", now,
                               300);
    if (id) mine.account_id = id;
    return tagIdentity(mine, agent, "experimental-claude-oauth",
                       id || namespace, periodKey);
  }
  // Auto starts with active native data, then only its native cache;
  // external fallback is deliberately restricted to the local managed
  // integrations.
  if (spec === "native") {
    // A supplied native snapshot is live input, not a cache candidate.
    // In particular do not mask it behind the previous fetch TTL.
    return tagIdentity(pyTruthy(native) ? currentNative : cachedNative,
                       agent, "native", namespace, periodKey);
  }
  if (spec === "auto" && pyTruthy(native)) {
    if (!pyTruthy(currentNative.stale)) return currentNative;
    staleNative = currentNative;
  }
  if (spec === "none" || spec === "off") {
    const cachedAny = await store.findCompatible(agent, namespace, periodKey);
    const source = pyTruthy(native) ? "native"
      : String(pyGet(cachedAny, "source", ""));
    return tagIdentity(pyTruthy(native) ? currentNative
                       : cachedReading(cachedAny, source, now, 300),
                       agent, source, namespace, periodKey);
  }
  let selected = spec;
  // Under auto, the fallback's reading, or the newest native one where that
  // was taken later: a tracker that stopped polling keeps its last reading
  // in its store, which must not stand in for a newer native one, stale or
  // not.
  const nativeBest = pyTruthy(staleNative) ? staleNative : cachedNative;
  const newest = (r: Reading): Reading => {
    if (spec !== "auto" || !hasReading(nativeBest)) return r;
    const mine = hasReading(r) ? epoch(pyGet(r, "as_of")) : null;
    const theirs = epoch(pyGet(nativeBest, "as_of"));
    if (theirs === null || (mine !== null && mine >= theirs)) return r;
    return tagIdentity(nativeBest, agent, "native", namespace, periodKey);
  };
  if (spec === "auto") {
    if (pyTruthy(cachedNative) && !pyTruthy(cachedNative.stale)) {
      return tagIdentity(cachedNative, agent, "native", namespace, periodKey);
    }
    selected = claudeFallback;
  }
  const ttl = HTTP_SOURCES.includes(selected) ? 300 : 60;
  // An HTTP source asked with the session's own credential, not one in the
  // environment, answers for the signed-in account: every session on it
  // shares the reading, so the machine asks once per ttl, not each session.
  const shared = HTTP_SOURCES.includes(selected) &&
    namespace.startsWith("session:") ? await configAccount() : "";
  const ns = shared || namespace;
  const rawCache = await store.load(agent, selected, ns, periodKey);
  // cachedReading whitelists the source fields, dropping the identity;
  // every return carries it again, since the calibration cache is named
  // from it and a cached reading must name the same file as a fresh one.
  const cached = tagIdentity(cachedReading(rawCache, selected, now, ttl),
                             agent, selected, ns, periodKey);
  if (!refreshDue(rawCache, now, ttl)) return newest(cached);
  const failure: Dict = {};
  let fresh: unknown = await fetch(selected, ctx, start, end, failure);
  // All built-in/command collectors return the validated v1 form.  Do
  // not normalize it a second time: buckets are already canonical.
  fresh = pyTruthy(fresh) && isDict(fresh) && fresh.schema_version === 1
    ? fresh : {};
  if (pyTruthy(fresh) && hasReading(fresh)) {
    const f = fresh as Dict;
    // A source as_of is evidence: never relabel a stale reading fresh.
    f.as_of = pyGet(f, "as_of") !== null ? f.as_of : now;
    const done = cachedReading(f, selected, now, ttl);
    Object.assign(done, { agent, account_name: ns,
                          period_start: periodKey, fetched_at: now,
                          attempted_at: now, fail_count: 0 });
    await store.save(agent, selected, ns, periodKey, done);
    return newest(done);
  }
  const retryAfter = pyGet(failure, "retry_after");
  const failed = failureCache(rawCache, now, ttl,
    typeof retryAfter === "number" ? retryAfter : null);
  Object.assign(failed, { agent, account_name: ns,
                          period_start: periodKey });
  await store.save(agent, selected, ns, periodKey, failed);
  return newest(tagIdentity(pyTruthy(cached) ? cached : staleNative, agent,
                            pyTruthy(cached) ? selected : "native",
                            pyTruthy(cached) ? ns : namespace, periodKey));
}

export function identity(values: unknown[]): string[] {
  return values.map((x) => (pyTruthy(x) ? valueText(x) : ""));
}

export function cacheName(agent: string, source: string, account: string,
                          periodStart: string): string {
  const raw = identity([agent, source, account, periodStart]).join("\0");
  return sha256Hex(raw) + ".json";
}

/** A name cacheName could have given: the only files findCompatible opens,
 * as findCompatible's cache name. */
export function isCacheName(name: string): boolean {
  return /^[0-9a-f]{64}\.json$/.test(name);
}

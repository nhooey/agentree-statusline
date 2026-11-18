// The pool paying for the session's work, and what each row has spent of
// it: the column after 💰 on the 🎤, 🤖, 🎮 and subagent rows
// (agents/plans/credit-balances.md, "Spending on the rows").
//
// One pool pays at a time, chosen by the session's credential and its plan
// windows:
//
// - a Claude Code on the web session: ⛅ the cloud session credit;
// - an API key: 🎁 a promotional credit while one has a balance, then 💵
//   the prepaid balance;
// - a plan login with a window at 100% and extra usage on: 💸 extra usage;
// - a plan login otherwise: the plan, which 🔋 and 🪫 already show, and the
//   column is blank.
//
// A row's figure is its records' share of 💰, the API-equivalent estimate,
// counted from the moment the pool began paying, `since`: a turn that
// crossed into the pool shows the part after the crossing.  The 🎮 row
// takes the measured fall in the pool's balance instead, once a reading
// from before the session began and a later one bracket it.
//
// Pure: the edge (hooks/edges.ts) reads the environment and the kept
// credits, and keeps the spell and the bracket between documents in
// `$.state` (`agentree-statusline`'s `spending`) and in `$.store` under the
// session's spendingKey, each read back through keptSpending, so a reload
// of the mod, a restart or a `--resume` counts on from them.

import { E_CLOUD, E_EXTRA, E_PREPAID, E_PROMO } from "./spec.ts";
import { expired } from "./credits.ts";
import { turnCost } from "./claude_calib.ts";
import { tsEpoch } from "./claude_records.ts";
import type { Turn } from "./claude_records.ts";
import { isDict } from "./py.ts";
import type { Dict } from "./py.ts";

/** A pool other than the plan: the kind of the credit that pays. */
export type Payer = "cloud" | "promo" | "prepaid" | "extra";

/** Each payer's glyph, the credit's own on the 💳 row. */
export const PAYER_GLYPHS: { readonly [kind in Payer]: string } = {
  cloud: E_CLOUD, promo: E_PROMO, prepaid: E_PREPAID, extra: E_EXTRA,
};

/** The kind of the session's credential, as the edge reads it:
 * - `elsewhere`: Bedrock, Vertex or another provider, none of the
 *   account's pools;
 * - `remote`: a Claude Code on the web session;
 * - `key`: an API key;
 * - `plan`: the plan's login. */
export type Credential = "elsewhere" | "remote" | "key" | "plan";

function figure(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The credits of `kind` unexpired at `now`, in the reading's order. */
function live(credits: unknown, kind: string, now: number): Dict[] {
  return Array.isArray(credits) ? credits.filter((c): c is Dict =>
    isDict(c) && c.kind === kind && !expired(c, now)) : [];
}

/** The pool paying now, or null while the plan pays or none is known.
 * `pcts` are the plan windows' used percentages, null where unread;
 * `credits` the kept reading's credits[]. */
export function payerOf(cred: Credential, pcts: readonly (number | null)[],
  credits: unknown, now: number): Payer | null {
  switch (cred) {
    case "elsewhere":
      return null;
    case "remote":
      return "cloud";
    case "key":
      return live(credits, "promo", now).some((c) =>
        (figure(c.remaining) ?? 0) > 0) ? "promo" : "prepaid";
    case "plan": {
      const spent = pcts.some((p) => p !== null && p >= 100);
      return spent && live(credits, "extra", now).length ? "extra" : null;
    }
  }
}

/** The credit of the reading that `payer` draws on: the first unexpired
 * one of its kind with a balance, else the first of its kind; null with
 * none. */
export function payingCredit(payer: Payer, credits: unknown, now: number):
  Dict | null {
  const all = live(credits, payer, now);
  return all.find((c) => (figure(c.remaining) ?? 0) > 0) ?? all[0] ?? null;
}

/** The pool paying for a session and since when: null `since` for one
 * that has paid all along. */
export type Spell = {
  readonly session: string;
  readonly kind: Payer | null;
  readonly since: number | null;
};

/** The spell after a document that found `kind` paying for `session` at
 * `now`.  Two pools take over partway through a session, and are counted
 * from the first document that found them paying: extra usage, once a
 * window fills, and the prepaid balance, once the promotional credit runs
 * out.  When extra usage began before the first document is unknown, so
 * it too is counted from then.  Any other pool has paid all along: the
 * credential chose it, and a document that found otherwise read the
 * credits before they were kept. */
export function nextSpell(prev: Spell | null, session: string,
  kind: Payer | null, now: number): Spell {
  const fresh = prev === null || prev.session !== session;
  if (!fresh && prev.kind === kind) return prev;
  const crossed = kind === "extra" ||
    (kind === "prepaid" && !fresh && prev.kind === "promo");
  return { session, kind, since: crossed ? now : null };
}

/** The dollars of (epoch, dollars) parts billed from `since` on: an
 * unstamped part is in, and every part with no `since`. */
export function partsSince(parts: readonly (readonly [number | null,
  number])[], since: number | null): number {
  let sum = 0;
  for (const [e, c] of parts) {
    if (since === null || e === null || e >= since) sum += c;
  }
  return sum;
}

/** What `t` billed from `since` on: its parts by their stamps, or the
 * whole turn by its own stamp where it has none, as a compaction. */
export function turnSince(t: Turn, since: number | null): number {
  if (t.compact || t.parts.length === 0) {
    const ts = tsEpoch(t.ts);
    return since === null || ts === null || ts >= since ? turnCost(t) : 0;
  }
  return partsSince(t.parts, since);
}

/** A credit's balance as a reading before the session gave it. */
export type Bracket = {
  readonly session: string;
  readonly id: string;
  readonly remaining: number;
  readonly as_of: number;
};

/** The bracket kept after a reading `asOf` of `credit` paying for
 * `session`: the first reading of that credit for the session is kept.
 * With no credits read yet, as just after a load, the kept bracket
 * stands, as the kept spell does. */
export function nextBracket(prev: Bracket | null, session: string,
  credit: Dict | null, asOf: number | null): Bracket | null {
  const id = credit === null ? null : credit.id;
  const left = credit === null ? null : figure(credit.remaining);
  if (prev !== null && prev.session === session &&
      (prev.id === id || asOf === null)) {
    return prev;
  }
  if (typeof id !== "string" || left === null || asOf === null) return null;
  return { session, id, remaining: left, as_of: asOf };
}

/** How far `credit`'s balance fell over the session: the kept reading's
 * balance less this one's, where the kept one is from no later than the
 * session's start, `start`, and this one later than both; else null. */
export function measuredFall(kept: Bracket | null, credit: Dict | null,
  asOf: number | null, start: number | null): number | null {
  const left = credit === null ? null : figure(credit.remaining);
  if (kept === null || credit === null || credit.id !== kept.id ||
      left === null || asOf === null || start === null ||
      kept.as_of > start || asOf <= start || asOf <= kept.as_of) {
    return null;
  }
  return Math.max(0, kept.remaining - left);
}

/** The figures document's `spending`: the payer, when it began paying,
 * and each band row's figure of it, null where the row has none. */
export type Spending = {
  readonly kind: Payer;
  readonly since: number | null;
  readonly turn: number | null;
  readonly main: number | null;
  readonly session: number | null;
};

/** `spending` for a document: the open turn's records, the main thread's
 * own parts and every turn of the session, each counted from the spell's
 * `since`; the session's the measured `fall` where there is one.  Null
 * while the plan pays. */
export function spendingOf(spell: Spell, openTurn: Turn | null,
  ownParts: readonly (readonly [number | null, number])[] | null,
  turns: readonly Turn[] | null, fall: number | null): Spending | null {
  if (spell.kind === null) return null;
  const since = spell.since;
  return {
    kind: spell.kind, since,
    turn: openTurn === null ? null : turnSince(openTurn, since),
    main: ownParts === null ? null : partsSince(ownParts, since),
    session: fall ?? (turns === null ? null
      : turns.reduce((n, t) => n + turnSince(t, since), 0)),
  };
}

/** What the edge keeps between loads: the spell and the bracket. */
export type Kept = {
  readonly spell: Spell | null;
  readonly bracket: Bracket | null;
};

const PAYERS: readonly (Payer | null)[] = ["cloud", "promo", "prepaid",
  "extra", null];

/** `value`, as an earlier load kept it in `$.state` or `$.store`, read
 * back: the spell and the bracket each whole or null, so a value of
 * another shape, or none, is a load with nothing kept. */
export function keptSpending(value: unknown): Kept {
  const s = isDict(value) ? value.spell : null;
  const b = isDict(value) ? value.bracket : null;
  const since = isDict(s) ? s.since : undefined;
  const spell = isDict(s) && typeof s.session === "string" &&
    PAYERS.includes(s.kind as Payer | null) &&
    (since === null || figure(since) !== null)
    ? { session: s.session, kind: s.kind as Payer | null,
      since: since as number | null } : null;
  const bracket = isDict(b) && typeof b.session === "string" &&
    typeof b.id === "string" && figure(b.remaining) !== null &&
    figure(b.as_of) !== null
    ? { session: b.session, id: b.id, remaining: b.remaining as number,
      as_of: b.as_of as number } : null;
  return { spell, bracket };
}

/** Whether `kept` holds anything of `session`'s. */
export function keptFor(kept: Kept, session: string): boolean {
  return kept.spell?.session === session ||
    kept.bracket?.session === session;
}

/** The `$.store` key a session's spell and bracket are kept under, so a
 * restart or a `--resume` of it counts on from them. */
export function spendingKey(session: string): string {
  return SPENDING_PREFIX + session;
}

export const SPENDING_PREFIX = "spending:";

/** How long a session's entry is kept after it last changed: 31 days.  A
 * spell starts with a crossing in a billing month, extra usage's cap and
 * the plan's windows reset within one, so a start older than the longest
 * month belongs to a period already over; and the store, one JSON file
 * for every session, stays small. */
export const SPENDING_KEEP_S = 31 * 86400;

/** Whether a store entry, `{spell, bracket, saved_at}`, is past keeping
 * at `now`: saved more than SPENDING_KEEP_S ago, or of no shape that says
 * when. */
export function spendingStale(value: unknown, now: number): boolean {
  const at = isDict(value) ? figure(value.saved_at) : null;
  return at === null || now - at > SPENDING_KEEP_S;
}

// The grid's cells and label pieces, from figures to spans.
//
// One function per GRID_CELLS key, in CELLS, each drawing its cell from
// plain figures, and the helpers that build the pieces of each row's
// label.  The band and the receipt (band.ts, band_tree.ts, receipt.ts)
// draw real figures through them and mod/tools/layout-mockup.ts draws its
// made-up ones, so a cell looks the same in all three.  Each takes plain
// figures, never a figures document: reading a document is the builders'
// job, and a cell here cannot tell where its figures came from.
//
// The widths a cell is drawn at are here too, as grid.ts's width rules
// read them (A_RATE_W, aCtxW, ...): the ones that measure a glyph depend
// on the terminal profile, so they are worked out from the Settings each
// time.
//
// Nothing here reads the environment.  The clock cells draw `now` in the
// process's TZ, which the edge sets from the document's `clock.tz`; the
// eta cell reads the clock only where it is handed no `now`.
import {
  E_ACCT, E_CACHE, E_COST, E_COWORK, E_DATE, E_DIFF, E_DIR, E_DIRTY, E_DOWN,
  E_EFF_HIGH, E_EFF_LOW, E_EFF_MAX, E_EFF_MED, E_EFF_XHIGH, E_ETA, E_ETA_INF,
  E_FABLE, E_GAUGE, E_GIT_BAD, E_GIT_OK, E_HUNDRED, E_IDLE, E_INBOX, E_KIDS,
  E_MOD, E_OAUTH_APPS, E_OMELETTE, E_OPUS, E_PCT, E_PR, E_PROJ, E_RATE,
  E_KIND_CLAUDE, E_KIND_EXPLORE, E_KIND_FORK, E_KIND_GENERAL, E_KIND_GUIDE,
  E_KIND_OTHER, E_KIND_PLAN, E_KIND_REMOTE, E_KIND_SETUP, E_KIND_SHELL,
  E_KIND_TEAMMATE, E_KIND_WORKFLOW,
  E_RESET, E_ROW_COMPACT, E_SESS, E_SESSION, E_SONNET,
  E_STALE, E_STY, E_SUP_DIGITS, E_THREAD, E_TIME, E_TOOL, E_TURN,
  E_TURN_ID, E_UP, E_WAIT, E_WEEK, E_WORK, GAUGE_W, K, MAG_COST,
  MODEL_FAMILIES, TAG_SCOPE, TURN_ID_HEX, VAL_W, VAL2_W,
} from "./spec.ts";
import {
  S_DIFF, cacheColor, decAlign, durFmt, grade, humanize, limitPct, magDim,
  moneyFig, padVal, visWidth,
} from "./formatting.ts";
import type { Settings } from "./formatting.ts";
import { ink, paint, span, spans } from "./spans.ts";
import type { Span } from "./spans.ts";
import {
  asciiDigits, charSlice, firstMax, fixed, intText, stripEnd, toFloat,
} from "./exact.ts";
import { etaFinish } from "./claude_records.ts";
import type { AgentEta, Git, Transcript } from "./claude_records.ts";
import { hidden } from "./grid.ts";
import type { Piece } from "./grid.ts";

// ════════════════════════════════════════════════════════════════════════════
// The cells' widths, as grid.ts's width rules name them.
// ════════════════════════════════════════════════════════════════════════════

export const A_CLOCK_W = 6, A_RATE_W = 7;
// 🤖 🔧 🚦, each two columns of mark and GAUGE_W of gauge, one space apart.
export const A_SPLIT_W = 3 * (2 + GAUGE_W) + 2;
// 🔋 and 🪫 hold the share's point in one column (limit): LIMIT_IP
// integer columns, the point, limitPct's widest fraction (two at
// digits=3, three at 4) and ٪, after the two-column mark.  Below 100 the
// integer part is never wider than two, 💯 standing in from 99.5.
export const LIMIT_IP = 2;
export const A_LIMIT_W = 2 + LIMIT_IP + 1 + 2 + 1;
export const A_LIMIT_WEEK_W = A_LIMIT_W + 1;
// ⛳ and five for the figure: durFmt's widest is four, and an overrun
// spends one more on its "+".
export const A_ETA_FIG_W = 5;
// 🧠's share of the window at its widest, "100٪".
export const A_CTX_PCT_W = 4;

// aEtaW, aDiffW and aCtxW are grid.ts's width rules A_ETA_W, A_DIFF_W and
// A_CTX_W; the rows take them through cellWidth.
/** ⛳ and its figure: E_ETA measured on this terminal. */
export function aEtaW(st: Settings): number {
  return visWidth(E_ETA, st.widths) + A_ETA_FIG_W;
}

/** 💾 and the eleven columns diffFig lays after it. */
export function aDiffW(st: Settings): number {
  return visWidth(E_DIFF + " ", st.widths) + 11;
}

/** 🧠, the size, a blank and the share: "🧠 124k 12٪". */
export function aCtxW(st: Settings): number {
  return visWidth(st.sCtx, st.widths) + 4 + 1 + A_CTX_PCT_W;
}

// ════════════════════════════════════════════════════════════════════════════
// The cells, one per GRID_CELLS key.  Each returns [] where it has nothing
// to draw, and the grid leaves the column blank.
// ════════════════════════════════════════════════════════════════════════════

// Up to two short runs of digits right after the family, and nothing that
// runs on into more digits, which is the date stamp.  \p{Nd} is any
// Unicode decimal digit.
const MODEL_VERSION =
  /^[-_. ]*(\p{Nd}{1,3})(?:[-_.](\p{Nd}{1,3}))?(?!\p{Nd})/u;

/** A display name from a model id or alias: family from the id, version
 * from the dotted digits after it, never the 8-digit date. */
export function modelLabel(modelId: string): string {
  const low = (modelId || "").toLowerCase();
  const fam = (MODEL_FAMILIES as readonly string[])
    .find((f) => low.includes(f.toLowerCase())) ?? "";
  if (!fam) return charSlice(modelId, null, VAL_W);
  const tail = low.slice(low.indexOf(fam.toLowerCase()) + fam.length);
  const m = MODEL_VERSION.exec(tail);
  if (!m) return fam;
  return fam + " " + [m[1], m[2]].filter((g) => g).join(".");
}

/** Two terminal cells: family initial and superscript major version. */
export function modelSpec(modelId: string): string {
  const label = modelLabel(modelId);
  if (!label) return "";
  const sp = label.indexOf(" ");
  const fam = sp < 0 ? label : label.slice(0, sp);
  const ver = sp < 0 ? "" : label.slice(sp + 1);
  if (ver) {
    const d = charSlice(ver, null, 1);
    return charSlice(fam, null, 1) + (/^\p{Nd}$/u.test(d)
      ? Array.from(E_SUP_DIGITS)[Number(asciiDigits(d))] : d);
  }
  return charSlice(fam, null, 2);
}

const EFFORT_GLYPHS: Readonly<Record<string, string>> = {
  low: E_EFF_LOW, medium: E_EFF_MED, high: E_EFF_HIGH, xhigh: E_EFF_XHIGH,
  max: E_EFF_MAX,
};

/** The level's glyph on the ladder; the middle of it for one not on it. */
export function effortGlyph(effort: string): string {
  return Object.hasOwn(EFFORT_GLYPHS, effort) ? EFFORT_GLYPHS[effort]
    : E_EFF_MED;
}

/** model: the family and version, then the effort's glyph. */
function model(st: Settings, modelId: string, effort: string): Span[] {
  if (!modelId) return [];
  return spans([E_MOD, span(padVal(st, 2, modelSpec(modelId)), "F_PUR"),
    effort && effort !== "null" ? effortGlyph(effort) : ""]);
}

/** rate, 🛫: tokens a second, without a "/s", as humanize writes a count:
 * three columns of figure, its decimal among them, then the unit, "1.2k"
 * and "632 "; nothing with no reading.  `mark` stands in for 🛫. */
function rate(st: Settings, perSecond: number | null,
  mark: string = E_RATE): Span[] {
  if (perSecond === null) return [];
  const fig = humanize(st, perSecond);
  return [span(mark + " "),
    paint(grade("count", "F_RATE", fig, st.colourMode), padVal(st, 4, fig))];
}

/** What the main thread is doing, as the Doing mark and the epoch it
 * started; ["", 0] on an offline read. */
export function mainDoing(tr: Transcript): [string, number] {
  if (tr.tool_at) return [E_TOOL, tr.tool_at];
  if (tr.wait_at) return [E_WAIT, tr.wait_at];
  if (tr.idle_at) return [E_WAIT, tr.idle_at];
  if (tr.last_seen) return [E_WORK, tr.last_seen];
  return ["", 0.0];
}

/** The cost cell from a cost as text, "💰115 ", under `mark`, the
 * settings' S_COST unless one is given; nothing for no cost, or one that
 * does not read as a finite number. */
export function costText(st: Settings, costUsd: string,
  mark: string = st.sCost): Span[] {
  if (!costUsd || costUsd === "null") return [];
  const c = toFloat(costUsd);
  // json reads NaN and 1e400 as floats; both are dropped.
  if (c === null || !Number.isFinite(c)) return [];
  return [span(mark),
    span(padVal(st, 4, moneyFig(st, c)), "F_YEL", magDim(c, MAG_COST))];
}

/** cost, 💰: dollars.  An estimate, `est`, is marked "~" before the
 * figure, as ctx marks an estimated context; the mark takes the column the
 * profile pads 💰 with where there is one, and where the figure would
 * still not fit, its decimal goes. */
function cost(st: Settings, usd: number | null, est = false): Span[] {
  if (usd === null) return [];
  if (!est) return costText(st, fixed(usd, 4));
  const room = visWidth(st.sCost, st.widths) + 4 - visWidth(E_COST, st.widths);
  // moneyFig's unit column kept where it fits, so the figure stands where
  // an exact one would.
  const whole = moneyFig(st, usd);
  let fig = "~" + whole;
  if (visWidth(fig, st.widths) > room) fig = "~" + stripEnd(whole);
  if (visWidth(fig, st.widths) > room && usd >= K - K / 2000.0) {
    fig = "~" + fixed(usd / K, 0) + "k";
  }
  return [span(E_COST),
    span(padVal(st, room, fig), "F_YEL", magDim(usd, MAG_COST))];
}

/** spend, after 💰: what the pool paying for the row's work, other than
 * the plan, has paid, under that credit's glyph, `mark` (spending.ts),
 * drawn as 💰 draws its dollars; nothing while the plan pays. */
function spend(st: Settings, mark: string | null, usd: number | null):
  Span[] {
  if (mark === null || usd === null) return [];
  return costText(st, fixed(usd, 4), mark);
}

/** ctx, 🧠: the context's size and its share of the window, the share
 * blank where there is no window; its column stays either way.  An
 * estimate is marked "~" before the size, in the blank between the two
 * figures. */
function ctx(st: Settings, tokens: number, window = 0,
  est = false): Span[] {
  if (tokens <= 0) return [];
  const pct = window > 0 ? intText(tokens * 100 / window) + E_PCT : "";
  const size = humanize(st, tokens);
  const style = grade("count", "F_PNK", size, st.colourMode);
  const fig = paint(style, padVal(st, 4, size));
  const share = paint(style, padVal(st, A_CTX_PCT_W, pct));
  // An estimate's size and its blank become one field.
  if (est) {
    return [span(st.sCtx), { ...fig,
      text: padVal(st, 5, "~" + stripEnd(fig.text.trimStart())) }, share];
  }
  return [span(st.sCtx), fig, span(" "), share];
}

/** ctx on a turn's row, 🧠 +34k +3٪: how much the context grew, in
 * tokens and in points of the window, signed, the sign the tokens'.  The
 * two fields keep ctx's widths, and where a five-character figure would
 * push the cell wider, the blank between them goes. */
function ctxGrowth(st: Settings, tokens: number,
  points: number | null): Span[] {
  const sign = tokens < 0 ? "-" : "+";
  const size = padVal(st, 4, sign + stripEnd(humanize(st, Math.abs(tokens))));
  const pct = points === null ? ""
    : padVal(st, 4, sign + intText(Math.abs(points)) + E_PCT);
  const room = aCtxW(st) - visWidth(st.sCtx, st.widths);
  const gap = visWidth(size + " " + pct, st.widths) > room ? "" : " ";
  // The points a span of their own, so a hidden `context.share` can drop
  // them (grid.ts's figure).
  return [span(st.sCtx), span(size + gap, "F_PNK"),
    ...(pct ? [span(pct, "F_PNK")] : [])];
}

/** ctxGrowth from a turn's `dctx` over the window: nothing where the turn
 * has no reading, and no points where there is no window, as ctx draws
 * no share. */
function growth(st: Settings, dctx: number | null, window: number): Span[] {
  if (dctx === null) return [];
  return ctxGrowth(st, dctx,
    window > 0 ? Math.trunc(100 * dctx / window) : null);
}

/** tok, 🧩: ▴ the weighted input and ▾ the output, each dimmed on its own
 * figure; nothing where `up` is missing.  `downW` is the ▾ field's
 * width. */
function tok(st: Settings, up: unknown, down: unknown,
  downW: number = VAL2_W): Span[] {
  if (up === null || up === undefined) return [];
  const u = humanize(st, up as number), dn = humanize(st, down as number);
  return [span(st.sTok),
    paint(grade("count", "F_TUP", u, st.colourMode),
      padVal(st, VAL_W, E_UP + padVal(st, 4, u), true)),
    paint(grade("count", "F_TDN", dn, st.colourMode),
      padVal(st, downW, E_DOWN + padVal(st, 4, dn)))];
}

/** cache, 🎯: the share of the input read from the cache; nothing for a
 * negative rate, which is no input to rate. */
function cache(st: Settings, pct: unknown): Span[] {
  if (pct === null || pct === undefined) return [];
  const p = pct as number;
  if (p < 0) return [];
  // The bare 🎯: the cell draws no paint pad after it.
  return [span(E_CACHE),
    paint(cacheColor(p), (p >= 100 ? E_HUNDRED : padVal(st, 2, intText(p))) +
      E_PCT)];
}

/** clock, ⌛: a duration in seconds. */
function clock(st: Settings, secs: number | null): Span[] {
  if (secs === null) return [];
  const run = Math.max(0.0, secs);
  const fig = durFmt(st, run);
  return [span(E_IDLE),
    paint(grade("duration", "F_PRW", fig, st.colourMode), padVal(st, 4, fig))];
}

/** etaReading's three answers: null where there is no transcript to
 * report in, [] for no live estimate, and otherwise the share done and
 * the seconds left. */
export type EtaReading = null | readonly [] | readonly [number, number];

/** (share done, seconds left) off the latest ETA and the elapsed time;
 * `eta` is (epoch, seconds left), or null for no transcript.  `startMs`
 * is whatever the task record held, read as toFloat reads it: what it
 * cannot read is no start. */
export function etaReading(eta: readonly number[] | null | undefined,
  startMs: unknown, now: number, status = "running",
  end: number | null = null): EtaReading {
  if (eta === null || eta === undefined) return null;
  if (!eta.length) return [];
  let t = now;
  if (end !== null && (status === "killed" || status === "failed")) {
    t = Math.min(t, end);
  }
  const ms = toFloat(startMs);
  let t0 = ms === null ? null : ms / 1000.0;
  const [at, said] = eta;
  // A report older than the start is a resumed agent: read from the
  // report instead.
  if (t0 !== null) t0 = Math.min(t0, at);
  const total = said + (t0 !== null ? at - t0 : 0.0);
  const gone = t - (t0 !== null ? t0 : at);
  const share = total > 0 ? gone / total : 1.0;
  return [Math.min(1.0, Math.max(0.0, share)), total - gone];
}

// An agent whose file has been silent this long no longer holds the main
// thread's ⛳ open.
export const ETA_LIVE_S = 1800.0;

/** The finishes of `agentEtas`, (finish, last epoch) pairs, that hold the
 * main thread's ⛳ open at `now`: those written within ETA_LIVE_S, and an
 * ∞ written since the turn opened at `turnS`, however long ago, since an
 * agent waiting on a person is silent.  An ∞ from before the turn is an
 * agent whose end the main transcript may never see, and does not. */
export function liveFinishes(agentEtas: readonly AgentEta[], now: number,
  turnS: number | null): (number | null)[] {
  return agentEtas.filter(([f, last]) => last !== null &&
    (now - last <= ETA_LIVE_S ||
      (f === Infinity && !!turnS && last >= turnS))).map(([f]) => f);
}

/** `own` ETA, pushed out to the latest of the descendants' `finishes`.
 * An `own` of null, an agent with no transcript, comes back as it went
 * in. */
export function inheritEta<E extends readonly number[] | null>(own: E,
  finishes: readonly (number | null)[],
  startS: number | null): E | readonly number[] {
  const ends = finishes.filter((f): f is number => f !== null);
  const mine = own && own.length ? etaFinish(own) : null;
  if (mine !== null) ends.push(mine);
  if (!ends.length || (mine !== null && ends.length === 1)) return own;
  const top = firstMax(ends);
  // An ∞ finish is no epoch to count from: the latest finite one is.
  const at = startS ? startS : own && own.length ? own[0]
    : firstMax([0, ...ends.filter(Number.isFinite)]);
  return [at, top - at];
}

/** ⛳'s figure for `left` seconds left: E_ETA_INF for an ∞ report, which
 * is never counted down. */
export function etaLeftFig(st: Settings, left: number, digits = 3): string {
  return left === Infinity ? E_ETA_INF : durFmt(st, left, digits);
}

/** eta, ⛳: the time left on `reported`, an (epoch, seconds left) report,
 * [] for none yet or null for no transcript, at `now` (the clock where it
 * is null); see etaReading for `startMs`, when the work began, `status`
 * and `end`.  Late, an amber "+", or a red one when `signedOff`; blank
 * with no live estimate; ∞ for an ∞ report. */
function eta(st: Settings, reported: readonly number[] | null,
  startMs: unknown, now: number | null, status = "running",
  end: number | null = null, signedOff = false): Span[] {
  const got = etaReading(reported, startMs,
    now === null ? Date.now() / 1000 : now, status, end);
  if (got === null || !got.length) return [];
  const left = got[1];
  if (left < 0) {
    return [span(E_ETA), span(padVal(st, A_ETA_FIG_W,
      "+" + durFmt(st, -left)), signedOff ? "F_OVER" : "F_AMB")];
  }
  const fig = etaLeftFig(st, left);
  return [span(E_ETA),
    paint(grade("duration", "F_ETA", fig, st.colourMode),
      padVal(st, A_ETA_FIG_W, fig))];
}

/** `parts` shared out as whole dots that always sum to `dots`: largest
 * remainder, ties to the earlier part, and a part of 1% or more that
 * rounds to nothing raised to one dot taken from the largest. */
export function gaugeDots(parts: readonly number[],
  dots = 4 * GAUGE_W): number[] {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((p) => dots * p / total);
  const n = exact.map((x) => Math.trunc(x));
  const short = dots - n.reduce((a, b) => a + b, 0);
  const order = parts.map((_, i) => i)
    .sort((a, b) => (n[a] - exact[a]) - (n[b] - exact[b]));
  for (const i of order.slice(0, Math.max(0, short))) n[i] += 1;
  parts.forEach((p, i) => {
    if (n[i] === 0 && p >= 0.01 * total) {
      n[n.indexOf(firstMax(n))] -= 1;
      n[i] = 1;
    }
  });
  return n;
}

/** `mark` and `n` dots of E_GAUGE, shaded by the unit its seconds are
 * written in, as every duration on the row is. */
function gauge(st: Settings, mark: string, secs: number, n: number): Span[] {
  const steps = Array.from(E_GAUGE);
  let cells = "";
  for (let k = 0; k < GAUGE_W; k++) {
    cells += steps[Math.max(0, Math.min(4, n - 4 * k))];
  }
  return [span(mark),
    paint(grade("duration", "F_PRW", durFmt(st, secs), st.colourMode), cells)];
}

/** split, 🤖 🔧 🚦: each a gauge of its share of `elapsed`, the model's
 * and the tools' seconds and the rest; blank with no split to read. */
function split(st: Settings, elapsed: number | null, modelS: number | null,
  toolS: number | null = 0.0): Span[] {
  if (modelS === null || modelS === undefined || elapsed === null) return [];
  const m = Math.max(0.0, modelS), t = Math.max(0.0, toolS || 0.0);
  const parts = [m, t, Math.max(0.0, elapsed - m - t)];
  const dots = gaugeDots(parts);
  const out: Span[] = [];
  [E_WORK, E_TOOL, E_WAIT].forEach((mark, i) => {
    if (out.length) out.push(span(" "));
    out.push(...gauge(st, mark, parts[i], dots[i]));
  });
  return out;
}

/** `emoji` and a share of a plan window, drawn only while the plan has a
 * reading (`pctS`, the window's own percentage as given) and the row is
 * `billed`, "?" where the share is not known; `colour` names the row's
 * F_* constant, dimmed with `dim`. */
function limit(st: Settings, emoji: string, pctS: string,
  share: number | null, colour: string, billed = true, dim = false,
  digits = 3): Span[] {
  if (!pctS || toFloat(pctS) === null || !billed) return [];
  const style = ink(colour, dim);
  const fp = digits - 1;
  // The point holds one column on every row (see decAlign); 💯 takes the
  // integer columns and its ٪ the point's, and "?" the units column.
  let fig: Span;
  if (share === null || share === undefined) {
    fig = span(padVal(st, LIMIT_IP, "?") + " ".repeat(fp + 2), "F_CRM", true);
  } else if (share >= 99.5) {
    fig = paint(style, padVal(st, LIMIT_IP, E_HUNDRED)
      + padVal(st, fp + 2, E_PCT, true));
  } else {
    fig = paint(style,
      decAlign(st, limitPct(st, share, digits), LIMIT_IP, fp, E_PCT));
  }
  return [span(emoji), fig];
}

/** five, 🔋: a share of the five-hour window; see limit. */
function five(st: Settings, pctS: string, share: number | null,
  billed = true, dim = false): Span[] {
  return limit(st, E_SESS, pctS, share, "F_LIM_SESS", billed, dim);
}

/** week, 🪫: five's for the weekly window, a digit wider. */
function week(st: Settings, pctS: string, share: number | null,
  billed = true, dim = false): Span[] {
  return limit(st, E_WEEK, pctS, share, "F_LIM_WEEK", billed, dim, 4);
}

/** 💾 and +adds/-removes, each half dimmed on its own count; nothing
 * where `added` is "".  A figure that does not read as a finite number is
 * "?". */
export function diffFig(st: Settings, added: string,
  removed: string): Span[] {
  if (!added) return [];

  // int(float(v)): an infinity or a NaN is "?".
  const n = (v: string): number | null => {
    const f = toFloat(v);
    return f === null || !Number.isFinite(f) ? null : Math.trunc(f);
  };

  const half = (sign: string, v: number | null, col: string): Span => {
    // humanize's unit column kept, so 💾 stacks digit under digit down the
    // grid, " 30k" over "  6 ".
    const fig = v === null ? "? " : humanize(st, v);
    return paint(grade("count", col, fig, st.colourMode),
      sign + padVal(st, 4, fig));
  };

  return [span(S_DIFF), half("+", n(added), "F_GRN"), span(" "),
    half("-", n(removed), "F_RED")];
}

/** diff, 💾: lines added and removed, blank when neither: none changed,
 * or none counted. */
function diff(st: Settings, added: unknown, removed: unknown): Span[] {
  const a = intText(added as number), r = intText(removed as number);
  if (a === "0" && r === "0") return [];
  return diffFig(st, a, r);
}

/** The cells by GRID_CELLS key, with ctx's two other readings. */
export const CELLS = {
  model, rate, cost, spend, ctx, ctxGrowth, growth, tok, cache, clock, eta,
  split, five, week, diff,
};

/** A cache rate as the receipt works it out: int(100 * read / input), or
 * -1 for no input at all. */
export function cacheRate(read: number, whole: number): number {
  return whole ? Math.trunc(100 * read / whole) : -1;
}

// ════════════════════════════════════════════════════════════════════════════
// Label pieces.
// ════════════════════════════════════════════════════════════════════════════

/** Each agent type's mark at the head of its row's label. */
export const KIND_MARK: ReadonlyMap<string, string> = new Map([
  ["general-purpose", E_KIND_GENERAL], ["claude", E_KIND_CLAUDE],
  ["Explore", E_KIND_EXPLORE], ["Plan", E_KIND_PLAN],
  ["claude-code-guide", E_KIND_GUIDE], ["statusline-setup", E_KIND_SETUP],
  ["fork", E_KIND_FORK], ["local_agent", E_KIND_OTHER],
  ["local_bash", E_KIND_SHELL], ["local_workflow", E_KIND_WORKFLOW],
  ["remote_agent", E_KIND_REMOTE], ["in_process_teammate", E_KIND_TEAMMATE]]);

/** The mark of an agent's type, or of its task's kind, else 👥. */
export function renderKind(agentType: string, taskKind: string): string {
  return KIND_MARK.get(agentType || taskKind) ?? E_KIND_OTHER;
}

/** 👶🏻 and how many agents hang under a row. */
export function renderKids(n: number): Span[] {
  return !n ? [] : [span(E_KIDS), span(intText(n), "F_CRM")];
}

/** 🤏 and how often an agent's window has been compacted. */
export function renderCompactions(n: number): Span[] {
  return !n ? [] : [span(E_ROW_COMPACT), span(intText(n), "F_PNK")];
}

/** 📨 and how many messages wait for a thread's next tool round. */
export function renderInbox(n: number): Span[] {
  return !n ? [] : [span(E_INBOX), span(intText(n), "F_CYN")];
}

/** 💻 or 📡 and how many shells or Monitors a thread has running. */
export function renderBackground(mark: string, n: number): Span[] {
  return !n ? [] : [span(mark), span(intText(n), "F_CRM")];
}

/** A part of a row's label, with the path --hide names it by; see Piece. */
export function piece(path: string, text: string, colour: string | null = null,
  drop = 0, dim = false): Piece {
  return { path, spans: [span(text, colour, dim)], drop };
}

/** The clock's date, strftime("%Y-%m-%d") of localtime(now). */
export function ymd(now: number): string {
  const d = new Date(Math.floor(now) * 1000);
  return String(d.getFullYear()).padStart(4, "0") + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

/** The clock's time, strftime("%H:%M:%S") of localtime(now). */
export function hms(now: number): string {
  const d = new Date(Math.floor(now) * 1000);
  const two = (n: number): string => String(n).padStart(2, "0");
  return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" +
    two(d.getSeconds());
}

/** The time until a reset at `epoch`, as shortDur reads a bare epoch:
 * "now" once it has passed, null with no reset. */
export function untilReset(st: Settings, epoch: number | null,
  now: number): string | null {
  if (epoch === null) return null;
  const delta = Math.trunc(epoch) - Math.trunc(now);
  return delta <= 0 ? "now" : durFmt(st, delta);
}

/** The weekly windows beside the plan's pair, in the order the 💳 row
 * draws them, each by its key (its `hide` path's metric, `plan.<key>`,
 * and its Limits fields' prefix), with its mark and colour: 🦊 the Fable
 * window, then the others of sources.WEEKLY_WINDOWS. */
export const SIDE_MARKS = [["fable", E_FABLE, "F_LIM_FABLE"],
  ["opus", E_OPUS, "F_LIM_OPUS"], ["sonnet", E_SONNET, "F_LIM_SONNET"],
  ["omelette", E_OMELETTE, "F_LIM_OMELETTE"],
  ["oauth_apps", E_OAUTH_APPS, "F_LIM_OAUTH_APPS"],
  ["cowork", E_COWORK, "F_LIM_COWORK"]] as const;

/** Every window the 💳 row draws, in the order a group of them keeps: 🔋
 * the plan's 5-hour window and 🪫 its weekly one, then SIDE_MARKS. */
export const PLAN_MARKS = [["five_hour", E_SESS, "F_LIM_SESS"],
  ["week", E_WEEK, "F_LIM_WEEK"], ...SIDE_MARKS] as const;
export type PlanKey = typeof PLAN_MARKS[number][0];

/** A window as the 💳 row draws it: its key in PLAN_MARKS, its share, the
 * time until it resets, and `at`, the reset itself, which the windows that
 * reset together share; each null where it has none. */
export type PlanWindow = { readonly key: PlanKey; readonly pct: number | null;
  readonly reset: string | null; readonly at: number | null };

/** A window's mark and its share.  Three digits for every window, so 🪫
 * reads 87٪ as 🔋 does, not the 87.0٪ the wider 🪫 column draws for an
 * agent's small share; padded to three on the left, so 9.9٪ going to 10٪
 * moves nothing after it.  With `stale`, how long ago the reading was
 * taken, the share is followed by 🧊 and that. */
function windowSpans(st: Settings, mark: string, colour: string,
  v: number | null, stale: string | null): Span[] {
  return [span(mark + " "), ...(v === null ? [] :
    [span(limitPct(st, v, 3).padStart(3) + E_PCT, colour),
      ...(stale === null ? [] : [span(" " + E_STALE + stale)])])];
}

/** `windows` as the 💳 row draws them, in groups that reset together (the
 * same `at`), the soonest first, each led by its 🔜 reset, its windows in
 * PLAN_MARKS' order a blank apart, and two blanks after it: 🔜 6.7m 🔋
 * 15٪  🔜 1.9d 🪫 87٪ 🦊 4٪.  The windows with no reset are a last group,
 * with no 🔜; a window with neither a share nor a reset is left out.  The
 * windows are under the paths `plan.<key>`, the resets under `plan.reset`.
 * A group's blanks end its last window, which trimLast takes off the
 * row's last. */
export function planPieces(st: Settings, windows: readonly PlanWindow[],
  stale: string | null = null): Piece[] {
  type Drawn = { w: PlanWindow; mark: string; colour: string };
  const groups = new Map<number | null, Drawn[]>();
  for (const [key, mark, colour] of PLAN_MARKS) {
    const w = windows.find((x) => x.key === key);
    if (!w || (w.pct === null && w.reset === null)) continue;
    const at = w.reset === null ? null : w.at;
    groups.set(at, [...groups.get(at) ?? [], { w, mark, colour }]);
  }
  return [...groups.keys()]
    .sort((a, b) => a === null ? 1 : b === null ? -1 : a - b)
    .flatMap((at) => {
      const group = groups.get(at)!;
      const reset = group[0].w.reset;
      return [
        ...reset === null ? [] : [piece("plan.reset",
          E_RESET + " " + reset + " ", null, 0, true)],
        ...group.map(({ w, mark, colour }, i): Piece => ({
          path: "plan." + w.key,
          spans: [...windowSpans(st, mark, colour, w.pct, stale),
            span(i === group.length - 1 ? "  " : " ")],
          drop: 0 }))];
    });
}

/** `pieces` with the blanks after the last one taken off: they would only
 * take room a cut label needs. */
export function trimLast(pieces: readonly Piece[]): Piece[] {
  const out = [...pieces];
  const last = out.at(-1);
  if (last) {
    const s = last.spans.at(-1)!;
    out[out.length - 1] = { ...last, spans: [...last.spans.slice(0, -1),
      { ...s, text: s.text.replace(/ +$/, "") }] };
  }
  return out;
}

/** 💳 account, then `windows` in groups, each led by its 🔜 reset
 * (planPieces), then 📅 and 🕐 at the end, which leave first on a narrow
 * terminal.  With `stale`, how long ago the reading was taken, each share
 * is followed by 🧊 and that: the footer's tail draws in one style, so the
 * mark is in the text. */
export function accountLabel(st: Settings, windows: readonly PlanWindow[],
  date: string, time: string, stale: string | null = null,
  credits: readonly { kind: string; spans: readonly Span[] }[] = []):
  Piece[] {
  const plan = trimLast(planPieces(st, windows, stale));
  // The credits after the windows, each leaving before 📅 and 🕐 on a
  // narrow terminal.
  const owed: Piece[] = credits.map((c) => ({ path: "credits." + c.kind,
    spans: [span("  "), ...c.spans], drop: 1 }));
  // 📅 and 🕐 last, at the right end of the footer.
  return [
    piece("name.label", E_ACCT + " "), ...plan, ...owed,
    piece("clock.date", "  " + E_DATE + " " + date, null, 2, true),
    piece("clock.time", "  " + E_TIME + " " + time, null, 3, true)];
}

/** 🎤, the turn's mark. */
export function turnLabel(): Piece[] {
  return [piece("name.label", E_TURN)];
}

/** 🧵, and before it 📨 and `inbox`, the messages waiting for the main
 * thread's next turn, as an agent row's 📨 counts its own (agentLabel).
 * Where the row is drawn, above the prompt, under the footer line or on
 * the receipt, the band's tree draws its own label (band_tree.ts). */
export function mainLabel(inbox = 0): Piece[] {
  return [
    ...(inbox ? [{ path: "state.inbox",
      spans: [...renderInbox(inbox), span(" ")], drop: 0 }] : []),
    piece("name.label", E_THREAD)];
}

/** The project name: the main repository root's basename inside a repo,
 * and "[none]" outside one. */
export function projectName(git: Git, projectDir: string): string {
  if (!git.in_git) return "[none]";
  const base = (p: string): string => {
    const t = stripEnd(p, "/");
    return t.slice(t.lastIndexOf("/") + 1);
  };
  const n = base(git.main_root || git.toplevel) || base(projectDir);
  return n || "?";
}

/** Where the session works.  Each part is "" where there is none. */
export type Workspace = {
  readonly project: string;
  readonly branch: string;
  readonly dirty: boolean;
  readonly dir: string;
  /** Where in `dir` the project's own folder's name stands, drawn in 📦's
   * colour; absent outside the project. */
  readonly dirProject?: readonly [number, number];
  readonly pr: string;
  readonly style: string;
};

/** 🎮, the session's mark: where it works is the 💳 row's
 * (workspacePieces). */
export function sessionLabel(): Piece[] {
  return [piece("name.label", E_SESSION)];
}

/** The palette's colour for each of Claude Code's session colours (its
 * /color names), the nearest token in spec.ts's palette. */
export const SESSION_COLOURS: { readonly [name: string]: string } = {
  red: "F_RED", blue: "F_BLU", green: "F_GRN", yellow: "F_YEL",
  purple: "F_PUR", orange: "F_AMB", pink: "F_PNK", cyan: "F_CYN",
};

/** The colour a session's name is drawn in where it has no colour, or one
 * SESSION_COLOURS does not name. */
export const SESSION_COLOUR_NONE = "F_CRM";

/** The session's name, under the path `workspace.name`, in its colour
 * (SESSION_COLOURS), then two blanks; none for no name.  It stands in
 * the names' column of the band's tree, where the other rows' names
 * stand, so it needs no mark of its own.  It leaves 🎮's label after 🔀
 * and before 📦, which never leaves whole. */
export function sessionNamePieces(name: string, colour: string): Piece[] {
  if (!name) return [];
  return [{ path: "workspace.name", drop: 4, spans: [span(name,
    Object.hasOwn(SESSION_COLOURS, colour) ? SESSION_COLOURS[colour]
      : SESSION_COLOUR_NONE), span("  ")] }];
}

/** Where the session works, under the path `workspace`: 📦 the project,
 * 🌿 the branch (🍂 and ✱ on a dirty tree), 📁 the directory, 🔀 the PR and 🎨 the output style, the last three
 * leaving first, 🎨 before 🔀 before 📁; none for no workspace. */
export function workspacePieces(ws: Workspace | null): Piece[] {
  const out: Piece[] = [];
  if (!ws) return out;
  if (ws.project) {
    out.push(piece("workspace.project", E_PROJ + ws.project + " ", "F_PROJ"));
  }
  if (ws.branch) {
    out.push(ws.dirty
      ? piece("workspace.branch", E_GIT_BAD + ws.branch + " " + E_DIRTY +
        "  ", "F_AMB")
      : piece("workspace.branch", E_GIT_OK + ws.branch + "  ", "F_GRN"));
  }
  if (ws.dir && ws.dirProject) {
    const [a, b] = ws.dirProject;
    out.push({ path: "workspace.dir", drop: 3, spans: [
      span(E_DIR + ws.dir.slice(0, a), "F_BLU"),
      span(ws.dir.slice(a, b), "F_PROJ"),
      span(ws.dir.slice(b) + "  ", "F_BLU")] });
  } else if (ws.dir) {
    out.push(piece("workspace.dir", E_DIR + ws.dir + "  ", "F_BLU", 3));
  }
  if (ws.pr) out.push(piece("workspace.pr", E_PR + "#" + ws.pr + "  ", "F_CYN", 2));
  if (ws.style) out.push(piece("workspace.style", E_STY + ws.style, "F_CYN", 1));
  return out;
}


/** A turn's tag and when, "🔺🔖 8f37748e #12  📅 2026-10-19  🕐 13:06:02":
 * `arrow` then 🔖, the head of the promptId and Claude Code's turn index,
 * each only where the transcript wrote it and the tag not at all where it
 * wrote neither, as turnTag draws it; then the date and the time, where
 * there is a time. */
export function turnHead(arrow: string, promptId: string,
  turnIndex: number | null, date: string | null,
  time: string | null): string {
  const tag = turnTag(arrow, promptId, turnIndex);
  const when = turnWhen(date, time);
  return tag && when ? tag + "  " + when : tag + when;
}

/** A turn's tag line, "🔺🔖 8f37748e #12  💳 🔋  15٪  🪫  87٪  📅
 * 2026-10-19  🕐 13:06:02": turnTag, then the account's two windows, 🔋
 * `sess` and 🪫 `week`, each as the 💳 row draws it, without its reset,
 * two blanks apart, then turnWhen, each part where it has something, two
 * blanks apart.  The windows are under the paths `tag.plan.five_hour` and
 * `tag.plan.week` (TAG_SCOPE), which `hide` leaves out; 💳 goes with the
 * last of them.  [] with neither a tag nor a time, whatever the windows. */
export function turnLine(st: Settings, arrow: string, promptId: string,
  turnIndex: number | null, sess: number | null, week: number | null,
  date: string | null, time: string | null,
  hide: readonly string[]): Span[] {
  const tag = turnTag(arrow, promptId, turnIndex);
  const when = turnWhen(date, time);
  if (!tag && !when) return [];
  const windows = PLAN_MARKS.slice(0, 2).flatMap(([key, mark, colour], i) => {
    const v = [sess, week][i];
    return v === null || hidden(hide, TAG_SCOPE + ".plan." + key) ? []
      : [windowSpans(st, mark, colour, v, null)];
  }).flatMap((w, i) => i ? [span("  "), ...w] : w);
  const parts: Span[][] = [
    ...(tag ? [[span(tag)]] : []),
    ...(windows.length ? [[span(E_ACCT + " "), ...windows]] : []),
    ...(when ? [[span(when)]] : [])];
  return parts.flatMap((p, i) => i ? [span("  "), ...p] : p);
}

/** turnHead's tag, "🔺🔖 8f37748e #12", "" with neither part. */
export function turnTag(arrow: string, promptId: string,
  turnIndex: number | null): string {
  const parts = [...(promptId ? [charSlice(promptId, null, TURN_ID_HEX)] : []),
    ...(turnIndex !== null ? ["#" + intText(turnIndex)] : [])];
  return parts.length ? arrow + E_TURN_ID + " " + parts.join(" ") : "";
}

/** turnHead's when, "📅 2026-10-19  🕐 13:06:02", "" without a time. */
export function turnWhen(date: string | null, time: string | null): string {
  return date !== null && time !== null
    ? E_DATE + " " + date + "  " + E_TIME + " " + time : "";
}

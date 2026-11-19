// The pool paying for the session's work and the column after 💰
// (spending.ts), and the rows that draw it (band.ts, band_tree.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  measuredFall, nextBracket, nextSpell, partsSince, payerOf, payingCredit,
  keptFor, keptSpending, spendingKey, spendingOf, spendingStale, turnSince,
} from "../src/spending.ts";
import { CELLS } from "../src/cells.ts";
import { bandRows, treeOf } from "../src/band.ts";
import { settings } from "../src/formatting.ts";
import { decodeTurn } from "../src/figures.ts";
import type { Turn } from "../src/claude_records.ts";
import type { Span } from "../src/spans.ts";
import type { Dict } from "../src/py.ts";
import { corpusAgents, document } from "../tools/gen-row-cases.ts";

const st = settings({}, true, false);
const NOW = 1_793_800_000;
const text = (spans: readonly Span[]) => spans.map((s) => s.text).join("");

const extra = { id: "x", kind: "extra", remaining: 12, granted: 50,
  spent: 38 };
const promo = { id: "p", kind: "promo", remaining: 150, granted: 200,
  expires_at: NOW + 86400 };

test("the payer: the cloud credit on the web, a key's promotional credit " +
  "then prepaid, extra usage once a window is full, none elsewhere", () => {
  assert.equal(payerOf("remote", [100, 100], [extra], NOW), "cloud");
  assert.equal(payerOf("key", [null, null], [promo], NOW), "promo");
  assert.equal(payerOf("key", [null, null],
    [{ ...promo, remaining: 0 }], NOW), "prepaid");
  assert.equal(payerOf("key", [null, null],
    [{ ...promo, expires_at: NOW - 1 }], NOW), "prepaid");
  assert.equal(payerOf("plan", [99, 40], [extra], NOW), null);
  assert.equal(payerOf("plan", [100, 40], [extra], NOW), "extra");
  assert.equal(payerOf("plan", [40, 100], [], NOW), null);
  assert.equal(payerOf("elsewhere", [], [promo], NOW), null);
  assert.equal(payerOf("elsewhere", [100, 100], [extra], NOW), null);
});

test("the paying credit: the first of its kind with a balance", () => {
  const spent = { ...promo, id: "p0", remaining: 0 };
  assert.equal(payingCredit("promo", [spent, promo], NOW)?.id, "p");
  assert.equal(payingCredit("promo", [spent], NOW)?.id, "p0");
  assert.equal(payingCredit("prepaid", [spent], NOW), null);
});

test("a spell: extra usage and prepaid after promo are counted from the " +
  "crossing, any other pool from the start", () => {
  const a = nextSpell(null, "s", "cloud", NOW);
  assert.deepEqual(a, { session: "s", kind: "cloud", since: null });
  assert.equal(nextSpell(a, "s", "cloud", NOW + 5), a);
  const e = nextSpell(nextSpell(null, "s", null, NOW), "s", "extra",
    NOW + 60);
  assert.deepEqual(e, { session: "s", kind: "extra", since: NOW + 60 });
  assert.equal(nextSpell(null, "s", "extra", NOW).since, NOW);
  const p = nextSpell(nextSpell(null, "s", "promo", NOW), "s", "prepaid",
    NOW + 9);
  assert.equal(p.since, NOW + 9);
  // Prepaid first, then the promotional credit once it is kept: it paid
  // all along.
  const q = nextSpell(nextSpell(null, "s", "prepaid", NOW), "s", "promo",
    NOW + 9);
  assert.equal(q.since, null);
  assert.equal(nextSpell(e, "t", "promo", NOW).since, null);
});

test("what was billed since: stamped parts by their stamps, a turn " +
  "without parts by its own", () => {
  const parts = [[NOW - 10, 1], [NOW + 10, 2], [null, 4]] as const;
  assert.equal(partsSince(parts, null), 7);
  assert.equal(partsSince(parts, NOW), 6);
  const fig = document("status/01-baseline");
  const t = decodeTurn(fig.open_turn as Dict);
  const whole = t.usd_in + t.usd_out + t.usd_cr + t.usd_cw;
  assert.ok(Math.abs(turnSince(t, null) - whole) < 1e-9);
  const compact: Turn = { ...t, compact: true, parts: [] };
  assert.equal(turnSince(compact, 4e9), 0);
});

test("the session's measured fall: two readings bracketing its start", () => {
  const cloud = { id: "c", kind: "cloud", remaining: 10 };
  const kept = nextBracket(null, "s", cloud, NOW - 60);
  assert.deepEqual(kept, { session: "s", id: "c", remaining: 10,
    as_of: NOW - 60 });
  assert.equal(nextBracket(kept, "s", { ...cloud, remaining: 8 }, NOW), kept);
  const later = { ...cloud, remaining: 7.5 };
  assert.equal(measuredFall(kept, later, NOW + 600, NOW), 2.5);
  // The kept reading is after the start: no bracket.
  assert.equal(measuredFall(kept, later, NOW + 600, NOW - 120), null);
  assert.equal(measuredFall(kept, later, NOW - 30, NOW), null);
  assert.equal(measuredFall(kept, { ...later, id: "d" }, NOW + 600, NOW),
    null);
});

test("the kept bracket stands through a document with no credits read, as " +
  "just after a load", () => {
  const cloud = { id: "c", kind: "cloud", remaining: 10 };
  const kept = nextBracket(null, "s", cloud, NOW - 60);
  assert.equal(nextBracket(kept, "s", null, null), kept);
  const after = nextBracket(nextBracket(kept, "s", null, null), "s",
    { ...cloud, remaining: 7.5 }, NOW + 600);
  assert.equal(measuredFall(after, { ...cloud, remaining: 7.5 }, NOW + 600,
    NOW), 2.5);
  // Another session's bracket is not this one's.
  assert.equal(nextBracket(kept, "t", null, null), null);
});

test("spending: each row's figure, the session's fall where measured", () => {
  const spell = { session: "s", kind: "cloud" as const, since: null };
  const s = spendingOf(spell, null, [[null, 1.5]], [], 3);
  assert.deepEqual(s, { kind: "cloud", since: null, turn: null, main: 1.5,
    session: 3 });
  assert.equal(spendingOf({ ...spell, kind: null }, null, [], [], 3), null);
});

test("what a load kept, read back: each part whole or nothing", () => {
  const spell = { session: "s", kind: "extra", since: NOW };
  const bracket = { session: "s", id: "x", remaining: 12, as_of: NOW };
  assert.deepEqual(keptSpending({ spell, bracket }), { spell, bracket });
  assert.deepEqual(keptSpending({ spell: { ...spell, kind: null,
    since: null } }), { spell: { session: "s", kind: null, since: null },
    bracket: null });
  const none = { spell: null, bracket: null };
  for (const v of [undefined, null, 7, "x", [], {}, { spell: "x" },
    { spell: { ...spell, kind: "plan" } }, { spell: { ...spell,
      since: "now" } }, { bracket: { ...bracket, remaining: null } }]) {
    assert.deepEqual(keptSpending(v), none);
  }
  // The kept spell carries on: the same kind keeps its start.
  const was = keptSpending({ spell });
  assert.equal(nextSpell(was.spell, "s", "extra", NOW + 600), was.spell);
  assert.ok(keptFor(was, "s"));
  assert.ok(!keptFor(was, "t"));
  assert.ok(keptFor(keptSpending({ bracket }), "s"));
});

test("a store entry is kept 31 days from its last save", () => {
  assert.equal(spendingKey("abc"), "spending:abc");
  const at = (days: number) => ({ saved_at: NOW - days * 86400 });
  assert.equal(spendingStale(at(31), NOW), false);
  assert.equal(spendingStale(at(31.01), NOW), true);
  for (const v of [undefined, null, {}, { saved_at: "x" }]) {
    assert.equal(spendingStale(v, NOW), true);
  }
});

test("the column: the payer's glyph and dollars, drawn as 💰's", () => {
  assert.equal(text(CELLS.spend(st, "💸", 2.1)), "💸2.1 ");
  assert.equal(text(CELLS.spend(st, "⛅", 1234)), "⛅1.2k");
  assert.deepEqual(CELLS.spend(st, null, 2), []);
  assert.deepEqual(CELLS.spend(st, "🎁", null), []);
});

test("the 🎤, 🤖, 🎮 and subagent rows draw the column, blank while the " +
  "plan pays", () => {
  const fig0 = document("status/01-baseline");
  const opts = { rate: null, phase: "running" as const };
  const plain = bandRows(st, fig0, opts);
  for (const row of [plain.turn, plain.main, plain.session]) {
    assert.equal(row.cells.spend, undefined);
  }
  const fig = { ...fig0, spending: { kind: "extra", since: null, turn: 2.1,
    main: 6.4, session: 35 }, agents: corpusAgents("corpus/01-mixed", "") };
  const rows = bandRows(st, fig, opts);
  assert.equal(text(rows.turn.cells.spend), "💸2.1 ");
  assert.equal(text(rows.main.cells.spend), "💸6.4 ");
  assert.equal(text(rows.session.cells.spend), "💸 35 ");
  const tree = treeOf(st, fig, rows, opts, []);
  const agents = tree.filter((r) => r.scope === "agent" &&
    r.cells.cost !== undefined);
  assert.ok(agents.length > 0);
  for (const r of agents) assert.match(text(r.cells.spend ?? []), /^💸/);
});

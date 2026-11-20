// The main transcript's folds, broken anywhere: a fold finished at any
// record, or with a half-written last line, reads on to what the whole
// fold reads; and saved as text, read back and read on, with each
// fixture's save the one tests/fixtures/fold-saves.json holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as cr from "../src/claude_records_node.ts";
import * as mf from "../src/main_fold.ts";
import { digest, foldSaves, lineEnds } from "./fold_saves.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../..");
process.chdir(REPO);

/** Every fixture transcript that is a session's own, not an agent's. */
const FILES = execFileSync("git", ["ls-files", "tests/fixtures"]).toString()
  .split("\n").filter((f) => f.endsWith(".jsonl") &&
    !path.basename(f).startsWith("agent-"));

type Folds = { tr: cr.TranscriptFold; tu: cr.TurnsFold };

function foldAll(records: readonly cr.Rec[], f?: Folds): Folds {
  return { tr: cr.foldTranscriptAll(records, f?.tr),
    tu: cr.foldTurnsAll(records, f?.tu) };
}

/** Both finishes of `f`, with the agents beside `p` and a clock, so every
 * input a finish takes is in play; with what the turns' finish held. */
function finish(p: string, f: Folds): unknown {
  const etas: cr.AgentEta[] = [];
  const agents = cr.agentRecords(p, null, etas);
  const held = new Map<string, number>();
  return [cr.transcriptFinish(f.tr, agents, etas, 1e10),
    cr.turnsFinish(f.tu, (seen) => cr.agentRecords(p, seen), null, held,
      cr.agentLabel), [...held]];
}

test("there are fixture transcripts to fold", () => {
  assert.ok(FILES.length > 10, String(FILES.length));
});

// Finished at every record boundary, then folded on to the end, each
// fixture reads as its whole fold: a finish leaves the fold as it was.
test("a fold finished at any record reads on as the whole fold", () => {
  for (const p of FILES) {
    const records = cr._records(p);
    const whole = finish(p, foldAll(records));
    for (let k = 0; k <= records.length; k++) {
      const f = foldAll(records.slice(0, k));
      assert.deepEqual(finish(p, f), finish(p, foldAll(records.slice(0, k))),
        `${p} at ${k}`);
      foldAll(records.slice(k), f);
      assert.deepEqual(finish(p, f), whole, `${p} broken at ${k}`);
    }
  }
});

// A last line with no newline yet is folded on a copy, so the fold reads
// it now and the line completed later: cut inside each line, and just
// before its newline, where it parses whole.
test("a half-written last line reads now, and once completed", () => {
  for (const p of FILES) {
    const data = fs.readFileSync(p);
    const whole = finish(p, foldAll(cr._recordsOf(data)));
    for (let end = data.indexOf(10); end >= 0;
      end = data.indexOf(10, end + 1)) {
      const start = data.lastIndexOf(10, end - 1) + 1;
      for (const cut of new Set([start + ((end - start) >> 1), end])) {
        const f = foldAll(cr._recordsOf(data.subarray(0, start)));
        const before = finish(p, f);
        const tail = cr._recordsOf(data.subarray(start, cut));
        const view = { tr: cr.transcriptFoldWith(f.tr, tail),
          tu: cr.turnsFoldWith(f.tu, tail) };
        assert.deepEqual(finish(p, view),
          finish(p, foldAll(cr._recordsOf(data.subarray(0, cut)))),
          `${p} cut at ${cut}`);
        assert.deepEqual(finish(p, f), before, `${p} left as it was`);
        foldAll(cr._recordsOf(data.subarray(start)), f);
        assert.deepEqual(finish(p, f), whole, `${p} completed at ${cut}`);
      }
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// The folds saved as text.
// ════════════════════════════════════════════════════════════════════════════

type Texts = { parts: string[]; head: string };

/** A first save's texts of `f`, folded to `end` of `data`. */
function saved(f: mf.MainFold, data: Uint8Array, end: number,
  partBytes = mf.FOLD_PART_BYTES): Texts {
  const got = mf.foldSave(f, mf.foldMeta(data, end), mf.newSaveMark(),
    partBytes)!;
  return { parts: got.parts.map(([, t]) => t), head: got.head };
}

function foldMain(f: mf.MainFold, records: readonly cr.Rec[]): mf.MainFold {
  for (const r of records) mf.foldMain(f, r);
  return f;
}

const WHOLE = new Map<string, Texts>();

/** A first save of `p`'s whole fold, to its last newline: the texts whose
 * digest tests/fixtures/fold-saves.json holds. */
function fixtureOf(p: string): Texts {
  let got = WHOLE.get(p);
  if (!got) {
    const data = fs.readFileSync(p);
    const end = data.lastIndexOf(10) + 1;
    got = saved(foldMain(mf.newMainFold(),
      cr._recordsOf(data.subarray(0, end))), data, end);
    WHOLE.set(p, got);
  }
  return got;
}

/** A saved fold in `dir`, read as the plugin reads one. */
function loadDir(dir: string) {
  return mf.foldLoad((name) => {
    try {
      return fs.readFileSync(path.join(dir, name), "utf-8");
    } catch {
      return null;
    }
  });
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "main-fold-"));
}

// The format honest: a change to either fold, or to what is saved of it,
// changes the text, and the digests fail until the format is bumped and
// plugin/tools/gen-fold-saves.ts run.
test("each fixture's fold saves as tests/fixtures/fold-saves.json holds it",
  () => {
    const want = foldSaves("main-fold");
    assert.equal(want.format, mf.MAIN_FOLD_FORMAT,
      "run node plugin/tools/gen-fold-saves.ts");
    assert.deepEqual(Object.keys(want.saves).sort(), [...FILES].sort(),
      "run node plugin/tools/gen-fold-saves.ts");
    for (const p of FILES) {
      const got = fixtureOf(p);
      assert.equal(digest([...got.parts, got.head]), want.saves[p],
        `${p}: the fold changed; bump "main-fold" in plugin/src/state_spec.ts`);
    }
  });

// Saved at every line end, in parts of 300 bytes, and read back from
// the files, each reads on to the fixture's save.
test("a fold saved at any line end reads on to the whole", () => {
  for (const p of FILES) {
    const want = fixtureOf(p);
    const data = fs.readFileSync(p);
    const end = data.lastIndexOf(10) + 1;
    const dir = tmp();
    const f = mf.newMainFold();
    let done = 0;
    for (const k of lineEnds(data)) {
      foldMain(f, cr._recordsOf(data.subarray(done, k)));
      done = k;
      const got = mf.foldSave(f, mf.foldMeta(data, k), mf.newSaveMark(),
        300)!;
      const at = path.join(dir, String(k));
      fs.mkdirSync(at);
      for (const [i, t] of got.parts) {
        fs.writeFileSync(path.join(at, mf.partName(i)), t);
      }
      fs.writeFileSync(path.join(at, got.slot), got.head);
      const back = loadDir(at);
      assert.ok(back, `${p} at ${k}`);
      assert.equal(back.meta.offset, k);
      foldMain(back.fold, cr._recordsOf(data.subarray(k, end)));
      assert.deepEqual(saved(back.fold, data, end),
        { parts: want.parts, head: want.head }, `${p} read on from ${k}`);
    }
    fs.rmSync(dir, { recursive: true });
  }
});

// As the plugin saves it: a part at a time as the fold grows, then a head in
// the other slot; and with the newest head torn, the one before it reads.
test("a fold saved as it grows reads back, and past a torn head", () => {
  for (const p of FILES) {
    const want = fixtureOf(p);
    const data = fs.readFileSync(p);
    const end = data.lastIndexOf(10) + 1;
    const ends = lineEnds(data);
    const files = new Map<string, string>();
    const f = mf.newMainFold();
    let mark = mf.newSaveMark(), done = 0;
    for (const k of ends) {
      foldMain(f, cr._recordsOf(data.subarray(done, k)));
      done = k;
      const got = mf.foldSave(f, mf.foldMeta(data, k), mark, 300)!;
      for (const [i, t] of got.parts) files.set(mf.partName(i), t);
      files.set(got.slot, got.head);
      mark = got.mark;
      const back = mf.foldLoad((n) => files.get(n) ?? null);
      assert.ok(back, `${p} at ${k}`);
      assert.deepEqual(finish(p, back.fold), finish(p, f), `${p} at ${k}`);
    }
    if (ends.length < 2) continue;
    const newest = mf.HEAD_SLOTS[mark.seq % 2];
    const text = files.get(newest)!;
    files.set(newest, text.slice(0, text.length >> 1));
    const back = mf.foldLoad((n) => files.get(n) ?? null);
    assert.equal(back?.meta.offset, ends[ends.length - 2], p);
    foldMain(back!.fold, cr._recordsOf(data.subarray(back!.meta.offset,
      end)));
    assert.deepEqual(saved(back!.fold, data, end),
      { parts: want.parts, head: want.head }, `${p} past a torn head`);
  }
});

test("a head over its cap is not saved", () => {
  const f = mf.newMainFold();
  f.tr.userText = "x".repeat(2000);
  assert.equal(mf.foldSave(f, mf.foldMeta(new Uint8Array(0), 0),
    mf.newSaveMark(), 1000, 1000), null);
});

// JSON has no infinity: an ∞ report is saved, and read back, as one, on
// the thread and on its turn.
test("an ∞ report saves and reads back as ∞", () => {
  const stamp = "2026-11-16T12:00:00.000Z";
  const recs = [{ type: "user", userType: "external", timestamp: stamp,
    uuid: "u1", promptId: "p1",
    message: { role: "user", content: "do a thing" } },
  { type: "assistant", timestamp: stamp, uuid: "a1", requestId: "r1",
    message: { id: "m1", model: "claude-opus-4-5", role: "assistant",
      content: [{ type: "text",
        text: "⛳ skills/coding-agent-usage-line-report-eta: ETA ∞" }],
      stop_reason: "end_turn", usage: { input_tokens: 1,
        output_tokens: 1 } } }];
  const bytes = new TextEncoder().encode(
    recs.map((r) => JSON.stringify(r) + "\n").join(""));
  const f = mf.newMainFold();
  foldMain(f, cr._recordsOf(bytes));
  const want = [Date.parse(stamp) / 1000, Infinity];
  assert.deepEqual(f.tr.etaState[0], want);
  assert.equal(f.tr.etaState[1], false, "parked, not done");
  assert.deepEqual(f.tu.turns.at(-1)?.eta, want);
  const got = mf.foldSave(f, mf.foldMeta(bytes, bytes.length))!;
  const files = new Map<string, string>([...got.parts.map(
    ([i, t]) => [mf.partName(i), t] as [string, string]),
  [got.slot, got.head]]);
  const back = mf.foldLoad((n) => files.get(n) ?? null)!;
  assert.deepEqual(back.fold.tr.etaState[0], want);
  assert.deepEqual(back.fold.tu.turns.at(-1)?.eta, want);
});

// inbox_fold.ts: each fixture file's inbox entry, folded at each line
// end, digests as tests/fixtures/fold-saves.json holds it, which
// mod/tools/gen-fold-saves.ts writes; and the counts read on from the fold
// are the counts of the whole files.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cr from "../src/claude_records_node.ts";
import {
  foldInboxEntry, INBOX_CHECK_BYTES, INBOX_FOLD_FORMAT, INBOX_SLOTS,
  inboxEntryText, inboxFoldDir, inboxFoldLoad, inboxFoldOf, inboxFoldText,
  inboxTailDigest, newInboxEntry,
} from "../src/inbox_fold.ts";
import { digest, foldSaves, lineEnds } from "./fold_saves.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../..");
process.chdir(REPO);

type Fixture = { file: string; main: boolean; texts: [number, string][] };

function tailAt(data: Uint8Array, k: number): string {
  return inboxTailDigest(data.subarray(Math.max(0, k - INBOX_CHECK_BYTES), k));
}

let folded: Fixture[] | null = null;

/** Each file tests/fixtures/fold-saves.json names, its inbox entry folded
 * from the start at each line end: a session's own transcript as `main`,
 * whose deliveries are not folded.  Which files hold an inbox mark is
 * mod/tools/gen-fold-saves.ts's to say. */
function fixtures(): Fixture[] {
  folded ??= Object.keys(foldSaves("inbox-fold").saves).sort().map((file) => {
    const data = fs.readFileSync(file);
    const main = !path.basename(file).startsWith("agent-");
    const e = newInboxEntry();
    const texts: [number, string][] = [];
    let at = 0;
    for (const k of lineEnds(data)) {
      foldInboxEntry(e, data.subarray(at, k), main);
      at = k;
      e.tail = tailAt(data, k);
      texts.push([k, inboxEntryText(file, e)]);
    }
    return { file, main, texts };
  });
  return folded;
}

// The format honest: a change to the entry, or to what is saved of it,
// fails here until the format is bumped and the digests written again.
test("each fixture file's inbox entry folds as " +
  "tests/fixtures/fold-saves.json holds it", () => {
  const want = foldSaves("inbox-fold");
  assert.equal(want.format, INBOX_FOLD_FORMAT,
    "run node mod/tools/gen-fold-saves.ts");
  const all = fixtures();
  assert.ok(all.length > 3);
  for (const fx of all) {
    assert.equal(digest(fx.texts), want.saves[fx.file],
      `${fx.file}: the fold changed; bump "inbox-fold" in ` +
      "mod/src/state_spec.ts");
  }
});

// The entry at each line end, read back, reads on to the last.
test("the saved inbox entry reads on here", () => {
  for (const fx of fixtures()) {
    const data = fs.readFileSync(fx.file);
    const [end, last] = fx.texts[fx.texts.length - 1];
    for (const [k, text] of fx.texts) {
      const fold =
        `{"format":${INBOX_FOLD_FORMAT},"seq":3,"files":[${text}]}`;
      const [seq, entries] = inboxFoldOf(fold)!;
      assert.equal(inboxFoldText(entries, seq), fold, `${fx.file} at ${k}`);
      const g = entries.get(fx.file)!;
      foldInboxEntry(g, data.subarray(k, end), fx.main);
      g.tail = tailAt(data, end);
      assert.equal(inboxEntryText(fx.file, g), last, `${fx.file} from ${k}`);
    }
  }
});

test("the slots are read newest first, past a torn one", () => {
  const fold = (seq: number) => `{"format":${INBOX_FOLD_FORMAT},"seq":${seq},` +
    `"files":[${fixtures()[0].texts[0][1]}]}`;
  assert.equal(inboxFoldLoad([fold(4), fold(5)])[1], 5);
  assert.equal(inboxFoldLoad([fold(5).slice(0, 30), fold(4)])[1], 4);
  const [none, newest] = inboxFoldLoad([fold(5).slice(0, 30), null]);
  assert.deepEqual([none.size, newest], [0, 5]);
  assert.deepEqual(inboxFoldLoad([null, null])[1], 0);
});

/** inbox-now copied into a scratch session, each file cut to `k` bytes. */
function session(tmp: string, k: number): {
  tr: string; files: string[]; targets: Map<string, string>;
} {
  const src = "tests/fixtures/records/inputs";
  const tr = path.join(tmp, "inbox-now.jsonl");
  const sub = path.join(tmp, "inbox-now", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const names = fs.readdirSync(path.join(src, "inbox-now", "subagents"))
    .filter((n) => n.endsWith(".jsonl")).sort();
  const files = [tr, ...names.map((n) => path.join(sub, n))];
  const from = [path.join(src, "inbox-now.jsonl"),
    ...names.map((n) => path.join(src, "inbox-now", "subagents", n))];
  files.forEach((f, i) => {
    fs.writeFileSync(f, fs.readFileSync(from[i]).subarray(0, k));
    fs.utimesSync(f, 1_800_000_000, 1_800_000_000 + i);
  });
  return { tr, files, targets: new Map(files.slice(1).map((f) =>
    [path.basename(f).slice("agent-".length, -".jsonl".length), f])) };
}

test("the inbox read on from its fold counts as the whole files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-fold-"));
  const state = path.join(tmp, "state");
  const longest = 3100;
  const slots = new Set<string>();
  for (let k = 0; k <= longest; k += 37) {
    const { tr, files, targets } = session(tmp, k);
    for (const since of [null, 0, 4e9]) {
      assert.deepEqual(cr.inboxFoldCounts(state, tr, files, targets, since),
        cr.inboxCounts(files, targets, since), `at ${k}, since ${since}`);
    }
    for (const n of fs.readdirSync(inboxFoldDir(state, tr))) slots.add(n);
  }
  assert.deepEqual([...slots].sort(), [...INBOX_SLOTS]);
  const { tr, files, targets } = session(tmp, longest);
  assert.deepEqual(Object.fromEntries(
    cr.inboxFoldCounts(state, tr, files, targets)), { b1: 1 });
  fs.rmSync(tmp, { recursive: true });
});

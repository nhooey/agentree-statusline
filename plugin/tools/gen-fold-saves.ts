// Write tests/fixtures/fold-saves.json: a digest of the saved state of
// every fixture transcript's main fold, of every fixture agent's fold, and
// of every fixture file's inbox entry, under each fold's format.
//
//   node plugin/tools/gen-fold-saves.ts              # write the file
//   node plugin/tools/gen-fold-saves.ts --show PATH  # print PATH's saves
//
//   {"main-fold":  {"format": N, "saves": {TRANSCRIPT: SHA256, ...}},
//    "agent-fold": {"format": N, "saves": {AGENT FILE: SHA256, ...}},
//    "inbox-fold": {"format": N, "saves": {FILE: SHA256, ...}}}
//
// Each path is from the repository root, and each digest is digest()'s
// (plugin/test/fold_saves.ts) of the texts that fold's save writes:
//
//   main-fold   each committed transcript that is a session's own (not an
//               agent's): a first save of its whole fold, to its last
//               newline, its parts and then its head;
//   agent-fold  each committed agent transcript: the text of its fold at
//               each line end K, as a first save writes it, as [K, TEXT];
//   inbox-fold  each committed transcript holding an inbox mark
//               (SEND_QUEUED_MARK or INBOX_MARKS): the text of its entry at
//               each line end K, folded from the start with no mtime, as
//               [K, TEXT]; a session's own transcript folded as `main`,
//               whose deliveries are not folded.
//
// plugin/test/{main,agent,inbox}_fold.test.ts save each fold again, digest it,
// and fail where the digest differs or the format is not plugin/src/state_spec.ts's:
// a change to a fold, or to what is saved of it, cannot land without a new
// format.  Bump the format, then run this.  --show prints the texts a
// path's digests are of, to read what a change did by running it before
// and after.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cr from "../src/claude_records_node.ts";
import { AGENT_FOLD_FORMAT, agentFoldText, FOLD_CHECK_BYTES, tailDigest }
  from "../src/agent_fold.ts";
import {
  foldInboxEntry, INBOX_CHECK_BYTES, INBOX_FOLD_FORMAT, inboxEntryText,
  inboxTailDigest, newInboxEntry,
} from "../src/inbox_fold.ts";
import * as mf from "../src/main_fold.ts";
import { digest, lineEnds } from "../test/fold_saves.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const OUT = "tests/fixtures/fold-saves.json";

type Text = string | [number, string];

/** Every committed fixture transcript, from the repository root. */
function committed(): string[] {
  return execFileSync("git", ["ls-files", "tests/fixtures"], { cwd: REPO })
    .toString().split("\n").filter((f) => f.endsWith(".jsonl")).sort();
}

const isAgent = (f: string) => path.basename(f).startsWith("agent-");

/** A first save of `p`'s whole fold, to its last newline: its parts, then
 * its head. */
export function mainTexts(p: string): Text[] {
  const data = fs.readFileSync(path.join(REPO, p));
  const end = data.lastIndexOf(10) + 1;
  const f = mf.newMainFold();
  for (const r of cr._recordsOf(data.subarray(0, end))) mf.foldMain(f, r);
  const got = mf.foldSave(f, mf.foldMeta(data, end), mf.newSaveMark())!;
  return [...got.parts.map(([, t]) => t), got.head];
}

/** The text of `p`'s fold at each line end, as a first save writes it. */
export function agentTexts(p: string): Text[] {
  const data = fs.readFileSync(path.join(REPO, p));
  const f = cr.newAgentFold();
  const out: Text[] = [];
  let at = 0;
  for (const k of lineEnds(data)) {
    cr.foldAgentBytes(f, data.subarray(at, k));
    at = k;
    out.push([k, agentFoldText(f, 1, tailDigest(
      data.subarray(Math.max(0, k - FOLD_CHECK_BYTES), k)))]);
  }
  return out;
}

/** The text of `p`'s inbox entry at each line end, folded from the
 * start. */
export function inboxTexts(p: string): Text[] {
  const data = fs.readFileSync(path.join(REPO, p));
  const main = !isAgent(p);
  const e = newInboxEntry();
  const out: Text[] = [];
  let at = 0;
  for (const k of lineEnds(data)) {
    foldInboxEntry(e, data.subarray(at, k), main);
    at = k;
    e.tail = inboxTailDigest(
      data.subarray(Math.max(0, k - INBOX_CHECK_BYTES), k));
    out.push([k, inboxEntryText(p, e)]);
  }
  return out;
}

function holdsInboxMark(p: string): boolean {
  const data = fs.readFileSync(path.join(REPO, p));
  return [cr.SEND_QUEUED_MARK, ...cr.INBOX_MARKS].some((m) =>
    Buffer.from(data).includes(Buffer.from(m)));
}

type Fold = { name: string; format: number; paths: string[];
  texts: (p: string) => Text[] };

/** Each fold's name, format, the paths it saves and their texts. */
function folds(): Fold[] {
  const all = committed();
  return [
    { name: "main-fold", format: mf.MAIN_FOLD_FORMAT,
      paths: all.filter((f) => !isAgent(f)), texts: mainTexts },
    { name: "agent-fold", format: AGENT_FOLD_FORMAT,
      paths: all.filter(isAgent), texts: agentTexts },
    { name: "inbox-fold", format: INBOX_FOLD_FORMAT,
      paths: all.filter(holdsInboxMark), texts: inboxTexts },
  ];
}

const line = (t: Text) => (typeof t === "string" ? t : `${t[0]}\t${t[1]}`);

function show(p: string): void {
  const rel = path.relative(REPO, path.resolve(p));
  let found = false;
  for (const f of folds()) {
    if (!f.paths.includes(rel)) continue;
    found = true;
    console.log(`=== ${f.name}`);
    for (const t of f.texts(rel)) console.log(line(t));
  }
  if (!found) {
    console.error(`${rel}: no fold saves it`);
    process.exit(1);
  }
}

/** The file's text: keys sorted, one space a level, as the digests were
 * first written. */
function render(): string {
  const out: Record<string, { format: number; saves: Record<string, string> }>
    = {};
  for (const f of folds().sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const saves: Record<string, string> = {};
    for (const p of [...f.paths].sort()) saves[p] = digest(f.texts(p));
    out[f.name] = { format: f.format, saves };
  }
  return JSON.stringify(out, null, 1) + "\n";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--show") {
    show(args[1]);
  } else if (args.length === 0) {
    const text = render();
    fs.writeFileSync(path.join(REPO, OUT), text);
    const got = JSON.parse(text) as Record<string, { saves: object }>;
    console.log("fold-saves.json  " + Object.entries(got).map(([k, v]) =>
      `${Object.keys(v.saves).length} ${k}`).join(", "));
  } else {
    console.error("usage: node plugin/tools/gen-fold-saves.ts [--show PATH]");
    process.exit(2);
  }
}

// The committed figures documents, tests/fixtures/figures/<suite>/<name>.json,
// as the TypeScript reads them.  They are sparse, so a new field touches
// only the documents with a value for it: no `schema`, and no record field
// (of a Payload, Transcript, Git, Limits, CacheShares or Turn) whose value
// is null.  full() puts back this port's own schema number and a null for each
// record field the text lacks, so the decoders, which refuse a document
// with a field missing, read it as written.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FIGURES_SCHEMA, RECORD_FIELDS } from "../src/figures.ts";
import { TURN_FIELDS } from "../src/figures.ts";
import { isDict } from "../src/py.ts";
import type { Dict } from "../src/py.ts";

export const FIGURES = path.resolve(path.dirname(
  fileURLToPath(import.meta.url)), "../../tests/fixtures/figures");

/** Where each mode's document holds a record, and which: a key whose
 * value is the record, or null where there is none; or a list of them. */
const RECORDS: { readonly [mode: string]: { readonly [key: string]: string } } =
  {
    status: { payload: "Payload", transcript: "Transcript", git: "Git",
      limits: "Limits", cache_shares: "CacheShares", turn: "Turn",
      open_turn: "Turn" },
    cost: { turns: "Turn" },
  };

function fieldsOf(record: string): readonly string[] {
  return record === "Turn" ? TURN_FIELDS : RECORD_FIELDS[record];
}

/** Each record object of `doc`, with its record's name. */
function records(doc: Dict): [string, Dict][] {
  const out: [string, Dict][] = [];
  for (const [key, record] of Object.entries(RECORDS[doc.mode as string])) {
    const v = doc[key];
    for (const r of Array.isArray(v) ? v : [v]) {
      if (isDict(r)) out.push([record, r]);
    }
  }
  return out;
}

/** A committed document as the program reads one, in place: this port's
 * schema, and a null for each record field the text lacks. */
export function full<T = Dict>(doc: Dict): T {
  doc.schema = FIGURES_SCHEMA;
  for (const [record, r] of records(doc)) {
    for (const f of fieldsOf(record)) if (!Object.hasOwn(r, f)) r[f] = null;
  }
  return doc as T;
}

/** Where a document a run wrote has other keys than its records' fields:
 * [record, missing, extra] for each such record. */
export function keyProblems(doc: Dict): [string, string[], string[]][] {
  const out: [string, string[], string[]][] = [];
  for (const [record, r] of records(doc)) {
    const want = fieldsOf(record);
    const missing = want.filter((f) => !Object.hasOwn(r, f));
    const extra = Object.keys(r).filter((f) => !want.includes(f));
    if (missing.length || extra.length) out.push([record, missing, extra]);
  }
  return out;
}

/** The committed document `name` of `suite`, its placeholders filled by
 * `fill` and parsed by `parse`, filled out by full(). */
export function readFigures<T = Dict>(suite: string, name: string,
  fill: (text: string) => string = (t) => t,
  parse: (text: string) => unknown = JSON.parse): T {
  return full<T>(parse(fill(fs.readFileSync(
    path.join(FIGURES, suite, name + ".json"), "utf8"))) as Dict);
}

/** The names of `suite`'s committed documents, sorted. */
export function figuresNames(suite: string): string[] {
  return fs.readdirSync(path.join(FIGURES, suite))
    .filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

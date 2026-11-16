// The differential families' cases, written once: tests/fixtures/records/,
// calib/, render/cells.json, claude/ and formatting/ hold each call's
// arguments and result as committed data, in three shorthands this reads
// back into the cases as written out in full.
//
//   {"$": NAME}          the value `names[NAME]` of the file: a value
//                        the cases hold more than once, an argument or a
//                        result, written once under a name
//   {"$record": TYPE, …}  a record of TYPE (RECORDS), written with only
//                        the fields that differ from its defaults: the
//                        rest are the defaults', so a new field with a
//                        default touches no case
//   "cfg": [NAME, …]     on a case, the configurations (the file's
//                        `configurations`, by name) under which the
//                        call gives this one result: one case each,
//                        its `cfg` the configuration itself
//
// A record is written back with its keys sorted, as the cases held it.
import { EMPTY_TRANSCRIPT, NO_CACHE_SHARES, NO_GIT, NO_LIMITS, readPayload,
  turn } from "../src/claude_records.ts";
import { newAgentFold } from "../src/claude_records.ts";
import { agentUsageOf } from "../src/subagent_tasks.ts";

type Json = any;

/** Each record type's defaults, as plain JSON. */
export const RECORDS: { [type: string]: { [field: string]: Json } } =
  JSON.parse(JSON.stringify({
    Transcript: EMPTY_TRANSCRIPT,
    Turn: turn({ ts: "", text: "", fresh: 0, cache_write: 0, cache_read: 0,
      out: 0, ctx: 0, calls: 0, dur_s: 0, dctx: null, usd_in: 0,
      usd_out: 0, usd_cr: 0, usd_cw: 0 }),
    Payload: readPayload("{}"),
    Git: NO_GIT,
    Limits: NO_LIMITS,
    CacheShares: NO_CACHE_SHARES,
    AgentUsage: agentUsageOf(newAgentFold()),
  }));

/** `v` with every name and record written out in full. */
export function expand(v: Json, names: { [name: string]: Json } = {}): Json {
  const seen = new Map<string, Json>();
  const walk = (x: Json): Json => {
    if (Array.isArray(x)) return x.map(walk);
    if (x === null || typeof x !== "object") return x;
    const keys = Object.keys(x);
    if (keys.length === 1 && keys[0] === "$") {
      const name = x.$ as string;
      if (!(name in names)) throw new Error("no name " + name);
      if (!seen.has(name)) seen.set(name, walk(names[name]));
      return structuredClone(seen.get(name));
    }
    if ("$record" in x) {
      const { $record: type, ...fields } = x;
      const defaults = RECORDS[type as string];
      if (!defaults) throw new Error("no record type " + type);
      const full = { ...structuredClone(defaults), ...walk(fields) };
      return Object.fromEntries(Object.keys(full).sort()
        .map((k) => [k, full[k]]));
    }
    return Object.fromEntries(keys.map((k) => [k, walk(x[k])]));
  };
  return walk(v);
}

/** A file's text read back: its names and records written out, and each
 * case with several configurations one case per configuration, `cfg` the
 * configuration itself.  The file's other keys are kept. */
export function readCases(text: string): Json {
  const { names = {}, configurations: configs, ...rest } = JSON.parse(text);
  const doc = expand(rest, names);
  if (configs && Array.isArray(doc.cases)) {
    doc.cases = doc.cases.flatMap((c: Json) =>
      Array.isArray(c.cfg)
        ? c.cfg.map((name: string) => ({ ...structuredClone(c),
          cfg: configs[name] }))
        : [c]);
  }
  return doc;
}

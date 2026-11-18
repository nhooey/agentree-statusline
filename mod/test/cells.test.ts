// The band's cell helpers, cell by cell, cells.ts's.
//
// tests/fixtures/render/cells.json holds, as committed data, each helper
// over awkward inputs, under every profile, both mark spacings and the
// subscripts: each call's inputs and result.  This builds the same
// Settings, runs the same call and compares.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as cells from "../src/cells.ts";
import * as fm from "../src/formatting.ts";
import type { Env, Settings } from "../src/formatting.ts";
import { enc, revive as reviveSpans } from "./formatting_codec.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "..", "tests",
  "fixtures");

type Case = { [k: string]: any };

function load(dir: string, name: string): Case {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, name + ".json"),
    "utf-8"));
}

/** formatting_codec's revive, and a NamedTuple, {"rec": fields}, as the
 * record of its fields. */
function revive(v: any): any {
  if (Array.isArray(v)) return v.map(revive);
  if (v !== null && typeof v === "object" && Object.keys(v).length === 1 &&
    "rec" in v) {
    return Object.fromEntries(Object.entries(v.rec).map(([k, x]) =>
      [k, revive(x)]));
  }
  if (v !== null && typeof v === "object" && !("span" in v) &&
    !("$float" in v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) =>
      [k, revive(x)]));
  }
  return reviveSpans(v);
}

const ENVS: { [name: string]: Env } = load("formatting", "settings").envs;

const built = new Map<string, Settings>();
function settingsFor(cfg: [string, boolean, boolean]): Settings {
  const key = cfg.join("/");
  let st = built.get(key);
  if (!st) {
    st = fm.settings(ENVS[cfg[0]], cfg[1], cfg[2]);
    built.set(key, st);
  }
  return st;
}

/** Runs `body` with TZ restored after, as the zone cases change it. */
function keepingTz(body: () => void): void {
  const saved = process.env.TZ;
  try {
    body();
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
}

// Each case's function by name, called with the case's arguments:
// settings first where the function takes them.
const FNS: { [fn: string]: (st: Settings, a: any[]) => unknown } = {
  render_tokens: (st, a) => cells.CELLS.tok(st, a[0], a[1], a[2]),
  main_doing: (_st, a) => cells.mainDoing(a[0]),
  render_cost: (st, a) => cells.costText(st, a[0], a[1]),
  render_diff: (st, a) => cells.diffFig(st, a[0], a[1]),
  model_label: (_st, a) => cells.modelLabel(a[0]),
  model_spec: (_st, a) => cells.modelSpec(a[0]),
  effort_glyph: (_st, a) => cells.effortGlyph(a[0]),
  eta_reading: (_st, a) => cells.etaReading(a[0], a[1], a[2], a[3], a[4]),
  inherit_eta: (_st, a) => cells.inheritEta(a[0], a[1], a[2]),
  project_name: (_st, a) => cells.projectName(a[0], a[1]),
};

/** fn's result as the fixtures write it, or the mark of a throw. */
function attempt(fn: () => unknown): unknown {
  try {
    return enc(fn());
  } catch {
    return { raises: true };
  }
}

test("cells: every renderer over its awkward inputs", () => {
  const counts = new Map<string, number>();
  keepingTz(() => {
    for (const c of load("render", "cells").cases) {
      const st = settingsFor(c.cfg);
      if (c.tz) process.env.TZ = c.tz;
      const call = FNS[c.fn];
      assert.ok(call, "no function for " + c.fn);
      const got = attempt(() => call(st, revive(c.args)));
      assert.deepEqual(got, c.out,
        `${c.fn}${JSON.stringify(c.args)} under ${c.cfg} ${c.tz ?? ""}`);
      counts.set(c.fn, (counts.get(c.fn) ?? 0) + 1);
    }
  });
  for (const fn of Object.keys(FNS)) assert.ok(counts.get(fn), fn);
});

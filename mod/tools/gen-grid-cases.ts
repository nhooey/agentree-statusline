// Write the grid's shared cases, tests/fixtures/grid/, from src/grid.ts.
//
//   node mod/tools/gen-grid-cases.ts
//
// mod/test/grid.test.ts runs every case and fails when this generator's
// output differs from what is committed, so regenerating is the only way
// to change them.
//
// One file per terminal profile, since the profile widens 🧩, 🧠 and 💰 by a
// column.  The first profile's file holds every case.  The other profiles'
// hold a sample, the cases a profile can change: each layout case whose
// columns differ from the first profile's, with its draw cases, and every
// draw case at the widest width, where the widened cells show whole.
// mod/test/grid.test.ts replays the first profile's other layout cases
// under every profile.  Profiles whose samples come out the same share one
// file.  Each holds:
//
//   settings  the profiles, each with the environment it is read from
//   rows      the mockup's sample rows, by id, as plain data: each row's
//             scope, depth, label pieces (path, spans, drop rank) and
//             cells (spans by GRID_CELLS key).  The grid takes these and
//             nothing else, so a port lays them out without the renderers.
//   layout    one case a line: the rows laid out (`rows`, by id), `cols`,
//             `hide`, `fixed`, and the `keys` layout() keeps
//   draw      one case a line: a row (`row`, by id) drawn on `keys` at
//             `cols` with `hide` and `spill`, and what draw() makes of it,
//             as `spans`
//
// The first draw case in a file also has its spans joined with their
// escape codes, `line`; tests/fixtures/formatting/spans.json pins the
// joining for the rest.  A span is written as an array, [text] for plain
// text and [text, colour, dim, bold, bg] otherwise, trailing defaults left
// off.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { settings } from "../src/formatting.ts";
import type { Env, Settings } from "../src/formatting.ts";
import { join } from "../src/spans.ts";
import type { Span } from "../src/spans.ts";
import { draw, hidden, layout } from "../src/grid.ts";
import type { Row } from "../src/grid.ts";
import { sample, runningMain } from "./layout-mockup.ts";

export const OUT = pathJoin(dirname(fileURLToPath(import.meta.url)), "..",
  "..", "tests", "fixtures", "grid");

/** Each profile, by the environment it is read from. */
export const PROFILES: { readonly [name: string]: Env } = {
  unknown: {},
  iterm: { TERM_PROGRAM: "iTerm.app" },
  tmux: { TMUX: "/tmp/tmux-501/default,1,0" },
};

// The widths: a wide terminal, 300, where every column and label piece
// fits; then each width at which the mockup's columns drop under some hide
// set and grid (160 keeps every column and sheds the 💳 row's clock, 150
// drops the first column, and 125 to 20 each drop more); then the drop's
// end: at 11 columns a row nested two deep has no room for its label, and
// at 6 its chrome alone runs past the right edge.
const COLS = [300, 160, 150, 125, 100, 80, 60, 40, 20, 11, 6];
// Hide sets that reach each rule: a whole scope, a group on every row, one
// metric on one row, label pieces, a column hidden on some rows only.
const HIDES: readonly (readonly string[])[] = [
  [], ["account"], ["*.work"], ["turn.time.eta"],
  ["account.clock.date", "*.clock.time"], ["*.state.rate"],
  ["*.plan", "main", "agent.chat"], ["session", "turn.name", "agent.time"],
  // 🧠's share on every row, which narrows its column, and on one row only.
  ["*.context.share", "*.plan.five_hour"], ["agent.context.share"],
];

/** A span as the cases write it; see the header. */
export function spanJson(s: Span): unknown[] {
  const out: unknown[] = [s.text, s.colour, s.dim, s.bold, s.bg];
  while (out.length > 1 &&
    (out[out.length - 1] === null || out[out.length - 1] === false)) {
    out.pop();
  }
  return out;
}

/** A span read back from the cases. */
export function spanFrom(a: readonly unknown[]): Span {
  return { text: a[0] as string, colour: (a[1] ?? null) as string | null,
    dim: Boolean(a[2]), bold: Boolean(a[3]), bg: (a[4] ?? null) as string | null };
}

function rowJson(r: Row): unknown {
  const out: { [k: string]: unknown } = { scope: r.scope };
  if (r.depth !== undefined) out.depth = r.depth;
  out.label = r.label.map((p) =>
    ({ path: p.path, spans: p.spans.map(spanJson), drop: p.drop }));
  out.cells = Object.fromEntries(Object.entries(r.cells)
    .map(([k, v]) => [k, v.map(spanJson)]));
  return out;
}

/** A row read back from the cases. */
export function rowFrom(j: unknown): Row {
  const r = j as { scope: string; depth?: number;
    label: { path: string; spans: unknown[][]; drop: number }[];
    cells: { [k: string]: unknown[][] } };
  return { scope: r.scope, ...(r.depth === undefined ? {} : { depth: r.depth }),
    label: r.label.map((p) =>
      ({ path: p.path, spans: p.spans.map(spanFrom), drop: p.drop })),
    cells: Object.fromEntries(Object.entries(r.cells)
      .map(([k, v]) => [k, v.map(spanFrom)])) };
}

/** The sample rows by id: every row the mockup can draw. */
function rows(st: Settings): Map<string, Row> {
  const s = sample(st);
  return new Map<string, Row>([
    ["account", s.account], ["turn", s.turn], ["main", s.main],
    ["main.running", runningMain(s.main)], ["session", s.session],
    ["receipt.turn", s.receipt[0]], ["receipt.session", s.receipt[1]],
    ["agent.1", s.agents[0]], ["agent.2", s.agents[1]],
  ]);
}

/** A layout case's inputs, as the first profile's columns are looked up
 * by. */
function layoutKey(cols: number, hide: readonly string[], fixed: boolean,
  ids: readonly string[]): string {
  return JSON.stringify([cols, hide, fixed, ids]);
}

/** The cases under one profile's settings, as the file's text after its
 * settings line, and the columns of each layout case by layoutKey.  With
 * `first`, the first profile's columns, only the sample the header names. */
function cases(st: Settings, first?: ReadonlyMap<string, string>):
  [string, Map<string, string>] {
  const table = rows(st);
  const scope = (id: string): string => table.get(id)!.scope;
  const layouts: string[] = [], draws: string[] = [];
  const columns = new Map<string, string>();
  const seen = new Set<string>();
  for (const cols of COLS) {
    for (const hide of HIDES) {
      const shown = (ids: string[]): string[] =>
        ids.filter((id) => !hidden(hide, scope(id)));
      const band = shown(["account", "turn", "main", "session"]);
      const receipt = shown(["receipt.turn", "receipt.session"]);
      const agents = shown(["agent.1", "agent.2"]);
      // The mockup's two grids: every row the design can draw, or the rows
      // drawn with agents to each depth.
      const sets: [boolean, string[], string[]][] = [
        [true, [...band, ...receipt, ...agents], agents],
        ...[0, 1, 2].map((d): [boolean, string[], string[]] => {
          const a = agents.filter((id) => table.get(id)!.depth! <= d);
          return [false, [...band, ...receipt, ...a], a];
        }),
      ];
      for (const [fixed, ids, drawnAgents] of sets) {
        if (!ids.length) continue;
        const key = layoutKey(cols, hide, fixed, ids);
        if (seen.has(key)) continue;
        seen.add(key);
        const keys = layout(st, ids.map((id) => table.get(id)!), cols, hide,
          fixed);
        columns.set(key, JSON.stringify(keys));
        const moved = !first || first.get(key) !== JSON.stringify(keys);
        if (moved) {
          layouts.push(JSON.stringify({ cols, hide, fixed, rows: ids, keys }));
        }
        if (!moved && cols !== COLS[0]) continue;
        const drawn = [...band, ...(band.includes("main")
          ? ["main.running"] : []), ...receipt, ...drawnAgents];
        for (const id of drawn) {
          for (const spill of [true, false]) {
            const dk = JSON.stringify([id, keys, cols, hide, spill]);
            if (seen.has(dk)) continue;
            seen.add(dk);
            const out = draw(st, table.get(id)!, keys, cols, hide, spill);
            draws.push(JSON.stringify({ row: id, keys, cols, hide, spill,
              spans: out.map(spanJson),
              ...(draws.length ? {} : { line: join(out) }) }));
          }
        }
      }
    }
  }
  const rowLines = [...table].map(([id, r]) =>
    "  " + JSON.stringify(id) + ": " + JSON.stringify(rowJson(r)));
  return [' "rows": {\n' + rowLines.join(",\n") +
    '\n },\n "layout": [\n' + layouts.map((l) => "  " + l).join(",\n") +
    '\n ],\n "draw": [\n' + draws.map((l) => "  " + l).join(",\n") +
    "\n ]}\n", columns];
}

/** Every file, by name: the first profile's every case, and the other
 * profiles' samples, profiles whose samples come out the same sharing a
 * file, named for them all. */
export function generate(): Map<string, string> {
  const [first, ...rest] = Object.keys(PROFILES);
  const [body, columns] = cases(settings(PROFILES[first]));
  const groups = new Map<string, string[]>([[body, [first]]]);
  for (const name of rest) {
    const [sample] = cases(settings(PROFILES[name]), columns);
    groups.set(sample, [...(groups.get(sample) ?? []), name]);
  }
  return new Map([...groups].map(([text, names]) => [
    names.join("-") + ".json",
    '{"settings": ' + JSON.stringify({ profiles: Object.fromEntries(
      names.map((n) => [n, PROFILES[n]])) }) + ",\n" + text]));
}

if (import.meta.main) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of generate()) {
    writeFileSync(pathJoin(OUT, name), text);
    const j = JSON.parse(text);
    process.stdout.write(`grid/${name.padEnd(22)} ${j.layout.length} layout` +
      ` and ${j.draw.length} draw cases\n`);
  }
}

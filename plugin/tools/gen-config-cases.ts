// Write the configuration cases: tests/fixtures/config/cases.json and
// tests/fixtures/config/defaults-cases.json.
//
//   node plugin/tools/gen-config-cases.ts
//
// cases.json: each case is a tree of files, the environment and the
// directory the walk starts from, and what src/config.ts's `load` makes of
// them, recorded under "expected":
//
//   tree      relative path -> the file's text, YAML for a configuration
//             file, or null for a directory.  `${ROOT}` in a text is the
//             case's root
//   env       the variables the reader sees; `${ROOT}` as above.  HOME is
//             ${ROOT}/home unless the case says otherwise
//   start     where the walk starts
//   expected  root      the project root found, or null
//             paths     each file layer's path, found or not; null for a
//                       project layer with no root
//             options   every option whose layer is not "default", as
//                       [value, layer]; a table's or a record's fields are
//                       under "fields"
//             fields    "table.row.field" (or "record.field[.key]") ->
//                       [value, layer], for each field a file set
//             warnings  in order, each "PATH: what"
//
// defaults-cases.json: the shipped defaults file and changes to it, each
// read by parseDefaults as if at DEFAULTS_PATH, with the error it raised
// ("PATH: what; what") or null for none.
//
// The walk runs over a fake file system built from the case's tree, and
// every path it asks for must lie under the case's root, so no developer's
// own file can reach a result.  test/config.test.ts runs every case again
// and this generator in memory, and fails on any difference: regenerate,
// and read the diff, to change what a case records.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULTS_REL, DefaultsError, load, parseDefaults,
} from "../src/config.ts";
import type { ConfigFs, Defaults, FileStat, RecordValue, Rows }
  from "../src/config.ts";
import { OPTIONS } from "../src/options_spec.ts";

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CASES_PATH = path.join(PLUGIN, "..", "tests", "fixtures", "config",
  "cases.json");
export const DEFAULTS_CASES_PATH = path.join(PLUGIN, "..", "tests", "fixtures",
  "config", "defaults-cases.json");
// The shipped defaults file, which the cases copy and change.
export const SHIPPED = fs.readFileSync(path.join(PLUGIN, DEFAULTS_REL), "utf8");
const DEFAULTS = parseDefaults(path.join(PLUGIN, DEFAULTS_REL), SHIPPED);
// The case's root, which `${ROOT}` stands for.
export const ROOT = "/config-case";

export type Tree = { [rel: string]: string | null };
export type Expected = {
  root: string | null;
  paths: { [layer: string]: string | null };
  options: { [name: string]: [unknown, string] };
  fields: { [path: string]: [unknown, string] };
  warnings: string[];
};
export type Case = { id: string; about: string; tree: Tree;
  env: { [name: string]: string }; start: string; expected: Expected };
export type DefaultsCase = { id: string; about: string; path: string;
  text: string; expected: string | null };

const D = ".config/agentree-statusline/";
const USER = "home/" + D + "config.yaml";
const PROJECT = "home/p/" + D + "config.yaml";
const LOCAL = "home/p/" + D + "config.local.yaml";
const GIT = { "home/p/.git/": null };
const FOOTER = "rows:\n  turn: {place: footer}\n  agent: {place: footer}\n" +
  "  session: {place: footer}\n  subagents: {live: never}\n";

type Input = Omit<Case, "expected">;
const input = (id: string, about: string, tree: Tree,
  start = "${ROOT}/home/p", env: { [name: string]: string } = {}): Input =>
  ({ id, about, tree, env: { HOME: "${ROOT}/home", ...env }, start });

const INPUTS: Input[] = [
  // ── Precedence ──────────────────────────────────────────────────────
  input("defaults", "no file anywhere: the defaults", { ...GIT }),
  input("empty-user", "an empty user file: exactly the defaults",
    { [USER]: "", ...GIT }),
  input("comments-only-user", "a user file of comments alone, or of an" +
    " empty mapping: exactly the defaults",
    { [USER]: "# account: u\n\n# mark-spacing: false\n",
      [PROJECT]: "{}\n", ...GIT }),
  input("user", "the user file alone",
    { [USER]: "account: u\nmark-spacing: false\n", ...GIT }),
  input("project-over-user", "the committed project file over the user's",
    { [USER]: "account: u\naccount-period: week\n",
      [PROJECT]: "account: p\n", ...GIT }),
  input("local-over-project", "the local file over the committed one, and" +
    " each key from the highest layer that has it",
    { [USER]: "account: u\naccount-period: week\nsubscript-decimals: true\n",
      [PROJECT]: "account: p\naccount-period: month\n",
      [LOCAL]: "account: l\n", ...GIT }),
  input("config-dir-over-xdg", "the tests' directory over XDG's",
    { "cfg/config.yaml": "account: cfg\n",
      "xdg/agentree-statusline/config.yaml": "account: xdg\n",
      [USER]: "account: home\n" }, undefined,
    { AGENTREE_STATUSLINE_CONFIG_DIR: "${ROOT}/cfg",
      XDG_CONFIG_HOME: "${ROOT}/xdg" }),
  input("xdg-over-home", "XDG_CONFIG_HOME over ~/.config",
    { "xdg/agentree-statusline/config.yaml": "account: xdg\n",
      [USER]: "account: home\n" }, undefined,
    { XDG_CONFIG_HOME: "${ROOT}/xdg" }),
  input("xdg-relative-ignored", "a relative XDG_CONFIG_HOME is ignored",
    { [USER]: "account: home\n" }, undefined, { XDG_CONFIG_HOME: "xdg" }),

  // ── Lists replace ───────────────────────────────────────────────────
  input("list-empty-replaces", "a project's empty hide means none",
    { [USER]: "hide: [a, b]\n", [PROJECT]: "hide: []\n", ...GIT }),

  // ── Tables merge per field ──────────────────────────────────────────
  input("table-per-field", "rows merged field by field across three files",
    { [USER]: "rows:\n  agent:\n    transcript: true\n",
      [PROJECT]: "rows:\n  agent: {live: never}\n  turn: {live: never}\n",
      [LOCAL]: "rows: {turn: {live: always}}\n", ...GIT }),

  // ── The walk ────────────────────────────────────────────────────────
  input("walk-two-up", "a file two directories above the start",
    { [PROJECT]: "account: p\n", ...GIT, "home/p/a/b/": null },
    "${ROOT}/home/p/a/b"),
  input("walk-git-stops", "a .git between the start and the file stops" +
    " the walk",
    { [PROJECT]: "account: p\n", "home/p/sub/.git/": null,
      "home/p/sub/a/": null }, "${ROOT}/home/p/sub/a"),
  input("walk-file-at-git", "the directory with .git is still looked in",
    { [LOCAL]: "account: l\n", ...GIT, "home/p/a/": null },
    "${ROOT}/home/p/a"),
  input("walk-none", "no project file up to $HOME",
    { "home/p/a/": null }, "${ROOT}/home/p/a"),
  input("walk-stops-at-home", "$HOME's .config is the user file's, never" +
    " a project's, and nothing above $HOME is looked in",
    { [USER]: "account: home\n",
      [D + "config.yaml"]: "account: above-home\n", "home/p/": null }),
  input("walk-missing-start", "a start that does not exist still walks up",
    { [PROJECT]: "account: p\n" }, "${ROOT}/home/p/gone/deeper"),
  input("worktree-takes-main-local", "a worktree with no local file reads" +
    " its main checkout's, at the same place",
    { ["home/main/" + D + "config.local.yaml"]: "account: main\n",
      "home/main/.git/worktrees/wt/commondir": "../..\n",
      "home/wt/.git": "gitdir: ${ROOT}/home/main/.git/worktrees/wt\n",
      "home/wt/a/": null }, "${ROOT}/home/wt/a"),
  input("worktree-committed-and-main-local", "a worktree's committed file," +
    " with the main checkout's local file over it",
    { ["home/main/" + D + "config.yaml"]: "account: main-p\n",
      ["home/main/" + D + "config.local.yaml"]: "account: main-l\n",
      "home/main/.git/worktrees/wt/commondir": "../..\n",
      ["home/wt/" + D + "config.yaml"]: "account: wt-p\naccount-period: week\n",
      "home/wt/.git": "gitdir: ../main/.git/worktrees/wt\n" },
    "${ROOT}/home/wt"),
  input("worktree-own-local", "a worktree's own local file wins",
    { ["home/main/" + D + "config.local.yaml"]: "account: main\n",
      "home/main/.git/worktrees/wt/commondir": "../..\n",
      ["home/wt/" + D + "config.local.yaml"]: "account: wt\n",
      "home/wt/.git": "gitdir: ${ROOT}/home/main/.git/worktrees/wt\n" },
    "${ROOT}/home/wt"),
  input("submodule-no-main", "a submodule's .git file has no commondir," +
    " so no main checkout",
    { ["home/sup/" + D + "config.local.yaml"]: "account: sup\n",
      "home/sup/.git/modules/sub/HEAD": "ref: refs/heads/main\n",
      "home/sup/sub/.git": "gitdir: ../.git/modules/sub\n" },
    "${ROOT}/home/sup/sub"),

  // ── YAML ────────────────────────────────────────────────────────────
  input("yaml", "comments kept out, a # and a colon inside a scalar kept," +
    " a block list, and a flow list over two lines with a trailing comma",
    { [PROJECT]: "# a comment\nhide:\n  - a#b      # after\n" +
        "  - 'x: }'\n  - \"q\"\nband-order: [b,\n  agentree-statusline,]\n" +
        "account: \"a\\\"#,]\"   # quoted\n", ...GIT }),
  input("core-schema", "YAML 1.2's core schema: no is a string, TRUE a" +
    " boolean, 0o3 an integer, and a quoted 0x10 a string",
    { [USER]: "account: \"0x10\"\nsubscript-decimals: TRUE\nhint-inset: 0o3\n",
      [PROJECT]: "mark-spacing: no\n", ...GIT }),
  input("version", "version: 1 is read past",
    { [PROJECT]: "version: 1\naccount: v1\n", ...GIT }),
  input("version-unknown", "another version skips the file",
    { [USER]: "account: u\n",
      [PROJECT]: "version: 2\naccount: v2\n", ...GIT }),

  // ── Bad files and values ────────────────────────────────────────────
  input("bad-yaml", "a file that is not YAML is skipped whole, the line" +
    " and column named",
    { [USER]: "account: u\n", [PROJECT]: "account: p\nhide: [a,\n", ...GIT }),
  input("yaml-refused", "YAML past what the reader reads, an alias here," +
    " is refused, never read some other way",
    { [USER]: "account: u\n",
      [PROJECT]: "account: &name p\naccount-period: *name\n", ...GIT }),
  input("not-object", "a file that is not a mapping is skipped whole",
    { [USER]: "account: u\n", [PROJECT]: "- account\n", ...GIT }),
  input("unknown-keys", "an unknown key skips the whole file, each named" +
    " with the nearest known one when one is near, and the layer under" +
    " supplies every value",
    { [USER]: "account: u\n",
      [PROJECT]: "rwos: {}\nusage-sorce: none\nzzzzzz: 1\naccount: refused\n",
      ...GIT }),
  input("table-unknown-parts", "an unknown row or field of a table skips" +
    " the whole file",
    { [USER]: "rows: {turn: {live: never}}\n",
      [PROJECT]: "rows:\n  tunr: {}\n  session: {lvie: never, live: running}\n",
      ...GIT }),
  input("credits-unknown-parts", "an unknown field of a record, or key of" +
    " its show, skips the whole file",
    { [PROJECT]: "credits: {place: row, show: {gift: []}, x: 1}\n", ...GIT }),
  input("bad-values", "each value of the wrong type, out of range or not" +
    " the enum's is skipped, and the layer under supplies it",
    { [USER]: "mark-spacing: false\nhint-inset: 4\naccount-place: tail\n" +
        "account-period: week\naccount: U\n",
      [PROJECT]: "mark-spacing: no\nhint-inset: -1\naccount-place: rwo\n" +
        "account-period: year\naccount: 7\nstarts-kept: 0\n", ...GIT }),
  input("usage-source-unknown", "a usage source that is none is" +
    " skipped, and the layer under supplies it",
    { [USER]: "usage-source: native\n",
      [PROJECT]: "usage-source: bogus\n", ...GIT }),
  input("whole-floats", "a whole float is an int, another float is not",
    { [PROJECT]: "hint-inset: 3.0\nstarts-kept: 2.5\n", ...GIT }),
  input("list-bad-item", "one bad item skips the whole list",
    { [USER]: "hide: [u]\n", [PROJECT]: "hide: [a, 1]\n", ...GIT }),
  input("list-distinct-repeated", "a name given twice in a distinct list" +
    " skips the whole list, and the layer under supplies it; a name no" +
    " plugin draws under is kept",
    { [USER]: "band-order: [no-such-plugin, agentree-statusline]\n",
      [PROJECT]: "band-order:\n  - a\n  - agentree-statusline\n  - a\n",
      ...GIT }),
  input("table-bad-parts", "a table's bad rows and fields are skipped" +
    " alone, and the account row refuses to be stamped",
    { [PROJECT]: "rows:\n  turn: {live: allways, transcript: false}\n" +
        "  agent: 3\n  session: {live: running}\n" +
        "  account: {transcript: true, live: never}\n", ...GIT }),
  input("table-not-object", "a table that is not a mapping is skipped",
    { [USER]: "rows: {tag: {live: always}}\n",
      [PROJECT]: "rows: []\n", ...GIT }),
  input("table-fixed-place", "the tag lines' place is always footer: a" +
    " file that moves it is warned about, and another row's place is kept",
    { [PROJECT]: "rows:\n  tag: {place: above}\n  agent: {place: above}\n",
      ...GIT }),
  input("live-place-unknown", "live-place is no option: a file that sets" +
    " it is skipped with a warning, and the rows keep their places",
    { [USER]: "live-place: above\n", ...GIT }),

  // ── Derived values ──────────────────────────────────────────────────
  input("right-edge-derived", "right-edge follows rows.*.place: with no" +
    " file, the defaults' rows above the prompt give 5", { ...GIT }),
  input("right-edge-derived-footer", "right-edge follows rows.*.place:" +
    " every row under the footer line, and no subagents, gives 2",
    { [PROJECT]: FOOTER, ...GIT }),
  input("right-edge-derived-above", "right-edge follows rows.*.place" +
    " merged across the layers: one row above, from another file than" +
    " the rest, gives 5",
    { [USER]: FOOTER, [PROJECT]: "rows: {agent: {place: above}}\n", ...GIT }),
  input("right-edge-derived-never", "right-edge follows rows.*.place:" +
    " a row above that is never drawn does not count, so 2",
    { [PROJECT]: "rows:\n  turn: {place: footer}\n  agent: {place: footer}\n" +
        "  session: {place: above, live: never}\n" +
        "  subagents: {live: never}\n", ...GIT }),
  input("right-edge-set", "a right-edge a layer sets is not derived",
    { [USER]: "right-edge: 0\n",
      [PROJECT]: "rows: {agent: {place: above}}\n", ...GIT }),
  input("derived-null", "a derived option's null, the defaults file's own," +
    " is not set: no warning, and the value derived",
    { [USER]: "right-edge: null\n", [PROJECT]: FOOTER, ...GIT }),

  // ── A record: credits ───────────────────────────────────────────────
  input("credits-merge", "a record merges per field, and show per credit:" +
    " the project's cloud list over the user's, the user's promo and" +
    " place kept, each list replaced whole",
    { [USER]: "credits:\n  place: none\n  show:\n    cloud: []\n" +
        "    promo: [{field: balance, op: \">=\", value: 0, unit: usd}]\n",
      [PROJECT]: "credits:\n  show:\n    cloud:\n      - field: expiry\n" +
        "        op: \"<\"\n        value: 2.5\n        unit: hours\n" +
        "  red: []\n  command: /bin/credits\n", ...GIT }),
  input("credits-bad", "a record's faults, each named: a list with one bad" +
    " condition is skipped whole, the rest kept",
    { [PROJECT]: "credits:\n  place: row\n  original: true\n  show:\n" +
        "    cloud:\n" +
        "      - {field: balance, op: \">\", value: 0, unit: usd}\n" +
        "      - {field: balnce, op: \">\", value: 0, unit: usd}\n" +
        "    extra: [{field: spent, op: \"=>\", value: 1, unit: usd}]\n" +
        "  amber: [{field: spent, op: \">\", value: 1, unit: days}]\n" +
        "  red: [{field: expiry, op: \"<\", value: \"1\", unit: days}, 4]\n" +
        "  command: 7\n", ...GIT }),
  input("credits-not-object", "a record that is not a mapping",
    { [PROJECT]: "credits: [account]\n", ...GIT }),

  // ── The defaults file, copied ───────────────────────────────────────
  input("copied-defaults", "the defaults file copied as the user's with" +
    " one value changed: every key is the user's, at the default's" +
    " value but that one, and nothing warns",
    { [USER]: swap(SHIPPED, "account: default", "account: work"), ...GIT }),
];

/** `text` with the one `old` in it made `next`. */
function swap(text: string, old: string, next: string): string {
  if (text.split(old).length !== 2) throw new Error(`not once: ${old}`);
  return text.replace(old, next);
}

/** `text` without the one line holding `line`. */
function without(text: string, line: string): string {
  const lines = text.split("\n");
  const hits = lines.flatMap((l, i) => l.includes(line) ? [i] : []);
  if (hits.length !== 1) throw new Error(`not one line: ${line}`);
  lines.splice(hits[0], 1);
  return lines.join("\n");
}

export const DEFAULTS_PATH = "/plugin/defaults/config.yaml";
const DEFAULTS_INPUTS: [string, string, string][] = [
  ["shipped", "the shipped file reads whole", SHIPPED],
  ["missing-key", "a key left out is missing",
    without(SHIPPED, "account: default")],
  ["unknown-key", "a key that is no option, with the nearest",
    swap(SHIPPED, "hide: []\n", "hide: []\nacount: x\n")],
  ["wrong-type", "a value of another type: yes is a string",
    swap(SHIPPED, "mark-spacing: true", "mark-spacing: yes")],
  ["under-minimum", "an int under its minimum",
    swap(SHIPPED, "starts-kept: 400", "starts-kept: 0")],
  ["not-in-enum", "an enum's value it has not",
    swap(SHIPPED, "account-place: row", "account-place: rwo")],
  ["live-place", "live-place is no option",
    swap(SHIPPED, "rows:\n", "live-place: footer\nrows:\n")],
  ["null-default", "null for an option that is not derived",
    swap(SHIPPED, "account: default", "account: null")],
  ["derived-set", "a value for a derived option, which follows another",
    swap(SHIPPED, "right-edge: null", "right-edge: 5")],
  ["table-missing-row", "a table's row left out",
    without(SHIPPED, "tag:       {place")],
  ["table-missing-field", "a row's field left out",
    swap(SHIPPED, "agent:     {place: above,  live: always,  transcript",
      "agent:     {place: above,  transcript")],
  ["table-missing-place", "a row without its place",
    swap(SHIPPED, "turn:      {place: above,  live", "turn:      {live")],
  ["table-bad-field", "a row's field of another type, and one unknown",
    swap(SHIPPED, "session:   {place: above,  live: always, ",
      "session:   {place: above, live: sometimes, x: 1, ")],
  ["table-not-object", "a table that is not a mapping",
    swap(SHIPPED, "rows:\n", "rows: 3\n_:\n")],
  ["several", "every fault named, in the file's order, the missing last",
    swap(without(SHIPPED, "subscript-decimals: false"),
      "mark-spacing: true", "mark-spacing: 1")],
  ["record-missing-field", "a record's field left out",
    without(SHIPPED, "original: false")],
  ["record-missing-key", "a conditions-by key left out",
    without(SHIPPED, "passes:  []")],
  ["record-bad-condition", "a condition of another shape",
    swap(SHIPPED, "unit: percent}]", "unit: dollars}]")],
  ["version", "a version the plugin does not read",
    swap(SHIPPED, "usage-source: auto", "version: 2\nusage-source: auto")],
  ["not-yaml", "text that is not YAML, at its line and column",
    SHIPPED + "}\n"],
  ["tab-indent", "a tab that indents, at its line and column",
    swap(SHIPPED, "  place: account", "\tplace: account")],
  ["not-object", "YAML that is not a mapping", "[1, 2]\n"],
];

const fill = (text: string) => text.replaceAll("${ROOT}", ROOT);

/** A file system holding the tree and nothing else, which records every
 * path it is asked about. */
export function fakeFs(tree: Tree): { fs: ConfigFs; asked: string[] } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  for (const [rel, text] of Object.entries(tree)) {
    const p = ROOT + "/" + rel.replace(/\/$/, "");
    if (text === null) dirs.add(p);
    else files.set(p, fill(text));
  }
  for (const p of [...files.keys(), ...dirs]) {
    for (let d = path.posix.dirname(p); d !== "/"; d = path.posix.dirname(d)) {
      dirs.add(d);
    }
  }
  const asked: string[] = [];
  // As the OS reads one, `..` taken off the directory before it: a
  // worktree's `.git` may name its git directory relatively.
  const stat = async (p: string): Promise<FileStat | null> => {
    asked.push(p);
    p = path.posix.normalize(p);
    const text = files.get(p);
    if (text !== undefined) {
      return { kind: "file", size: Buffer.byteLength(text), mtimeMs: 1 };
    }
    return dirs.has(p) ? { kind: "dir", size: 0, mtimeMs: 0 } : null;
  };
  return {
    asked,
    fs: {
      stat,
      read: async (p) => {
        asked.push(p);
        return files.get(path.posix.normalize(p)) ?? null;
      },
      realPath: async (p) => (await stat(p)) ? p : null,
    },
  };
}

/** What `load` makes of a case, as "expected" records it, and every path
 * the walk asked for. */
export async function run(c: Input, defaults: Defaults = DEFAULTS):
    Promise<{ expected: Expected; asked: string[] }> {
  const env: { [name: string]: string } = {};
  for (const [k, v] of Object.entries(c.env)) env[k] = fill(v);
  const { fs: fake, asked } = fakeFs(c.tree);
  const found = await load(fill(c.start), env, fake, defaults);
  const options: Expected["options"] = {};
  const fields: Expected["fields"] = {};
  for (const [name, value] of Object.entries(found.options.values)) {
    const layer = found.options.layers[name];
    const type = (OPTIONS as { [n: string]: { type: string } })[name].type;
    if (type === "table") {
      for (const [row, rec] of Object.entries(value as Rows)) {
        for (const [field, v] of Object.entries(rec)) {
          const at = found.options.fields[`${name}.${row}.${field}`];
          if (at) fields[`${name}.${row}.${field}`] = [v, at];
        }
      }
    } else if (type === "record") {
      for (const [field, v] of Object.entries(value as RecordValue)) {
        const parts = v !== null && !Array.isArray(v) && typeof v === "object"
          ? Object.entries(v).map(([k, item]) => [`.${k}`, item] as const)
          : [["", v] as const];
        for (const [key, part] of parts) {
          const at = found.options.fields[`${name}.${field}${key}`];
          if (at) fields[`${name}.${field}${key}`] = [part, at];
        }
      }
    } else if (layer !== "default") {
      options[name] = [value, layer];
    }
  }
  const expected = { root: found.root, paths: found.paths, options, fields,
    warnings: [...found.options.warnings] };
  return { asked,
    expected: JSON.parse(JSON.stringify(expected).replaceAll(ROOT, "${ROOT}")) };
}

/** What parseDefaults makes of `text`: its error, or null. */
export function defaultsError(text: string): string | null {
  try {
    parseDefaults(DEFAULTS_PATH, text);
  } catch (err) {
    if (err instanceof DefaultsError) return err.message;
    throw err;
  }
  return null;
}

const lines = (items: unknown[]) =>
  "[\n" + items.map((i) => JSON.stringify(i)).join(",\n") + "\n]\n";

/** Both files' text, by path. */
export async function generate(): Promise<Map<string, string>> {
  const cases: Case[] = [];
  for (const c of INPUTS) cases.push({ ...c, expected: (await run(c)).expected });
  const defaults: DefaultsCase[] = DEFAULTS_INPUTS.map(([id, about, text]) =>
    ({ id, about, path: DEFAULTS_PATH, text, expected: defaultsError(text) }));
  return new Map([[CASES_PATH, lines(cases)],
    [DEFAULTS_CASES_PATH, lines(defaults)]]);
}

if (import.meta.main) {
  for (const [p, text] of await generate()) {
    fs.writeFileSync(p, text);
    console.log(path.relative(path.join(PLUGIN, ".."), p));
  }
}

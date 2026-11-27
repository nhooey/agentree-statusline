// Write the option tables of docs/options.md from src/options_spec.ts.
//
//   node plugin/tools/gen-option-docs.ts
//
// Each table goes between its `<!-- options:begin NAME -->` and
// `<!-- options:end NAME -->` markers: a row for every option whose
// `doc-table` is NAME, its Default cell the option's `doc-default`, or its
// value in the defaults file in YAML's flow style, and its Effect cell its
// `doc`.  The `generated` suite of tests/all.sh runs this and fails while
// the docs differ from what it writes.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS_REL, parseDefaults } from "../src/config.ts";
import type { Defaults } from "../src/config.ts";
import { OPTIONS } from "../src/options_spec.ts";
import { yamlOption } from "../src/yaml.ts";

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = path.join(PLUGIN, "..", "docs", "options.md");
// The tables of docs/options.md, by the name their markers give.
export const DOC_TABLES = ["settings"] as const;

type DocRecord = { "doc-table": string | null; "doc-default"?: string;
  doc: string };

const cell = (text: string): string => text.replaceAll("|", "\\|");

/** One table of docs/options.md, its lines from the header row down. */
export function optionTable(which: string, defaults: Defaults): string[] {
  const rows = ["| Key | Default | Effect |", "|---|---|---|"];
  for (const [name, o] of Object.entries(OPTIONS) as [string, DocRecord][]) {
    if (o["doc-table"] !== which) continue;
    const d = defaults[name];
    const mid = o["doc-default"] ??
      (Array.isArray(d) && d.length === 0 ? "none" : "`" + yamlOption(d) + "`");
    rows.push(`| ${cell("`" + name + "`")} | ${cell(mid)} | ${cell(o.doc)} |`);
  }
  return rows;
}

/** docs/options.md's text with each table between its markers anew. */
export function withOptionTables(text: string, defaults: Defaults): string {
  for (const which of DOC_TABLES) {
    const begin = `<!-- options:begin ${which} -->`;
    const end = `<!-- options:end ${which} -->`;
    const i = text.indexOf(begin + "\n");
    const j = text.indexOf("\n" + end, i);
    if (i < 0 || j < 0) throw new Error(`${DOC}: no ${begin} ... ${end}`);
    text = text.slice(0, i) +
      [begin, ...optionTable(which, defaults)].join("\n") + text.slice(j);
  }
  return text;
}

if (import.meta.main) {
  const p = path.join(PLUGIN, DEFAULTS_REL);
  const defaults = parseDefaults(p, fs.readFileSync(p, "utf8"));
  fs.writeFileSync(DOC, withOptionTables(fs.readFileSync(DOC, "utf8"),
    defaults));
}

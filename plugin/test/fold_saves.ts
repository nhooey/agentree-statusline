// tests/fixtures/fold-saves.json, read: each fold's format and a digest of
// each fixture's save, which plugin/tools/gen-fold-saves.ts writes and the
// *_fold tests hold the folds to.
import { createHash } from "node:crypto";
import * as fs from "node:fs";

export type FoldName = "main-fold" | "agent-fold" | "inbox-fold";

export type FoldSaves = {
  readonly format: number;
  readonly saves: Readonly<Record<string, string>>;
};

/** One fold's entry of tests/fixtures/fold-saves.json, read from the
 * repository root. */
export function foldSaves(name: FoldName): FoldSaves {
  return JSON.parse(fs.readFileSync("tests/fixtures/fold-saves.json",
    "utf-8"))[name];
}

/** The sha256 of a save's texts, in order: each a TEXT, or a [K, TEXT] at
 * line end K, written as `TEXT\n` or `K\tTEXT\n` in UTF-8. */
export function digest(texts: readonly (string | readonly [number, string])[]):
  string {
  const h = createHash("sha256");
  for (const t of texts) {
    h.update((typeof t === "string" ? t : `${t[0]}\t${t[1]}`) + "\n",
      "utf-8");
  }
  return h.digest("hex");
}

/** The offset just past each newline of `data`. */
export function lineEnds(data: Uint8Array): number[] {
  const out: number[] = [];
  for (let at = data.indexOf(10); at >= 0; at = data.indexOf(10, at + 1)) {
    out.push(at + 1);
  }
  return out;
}

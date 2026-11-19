// The files kept in the state directory, named by stateName and
// statePath from state_spec.ts's table.
import { joinPath } from "./exact.ts";
import { sha256Hex } from "./sha256.ts";
import { STATE_KINDS } from "./state_spec.ts";

export type StateKind = keyof typeof STATE_KINDS;

/** The kind's prefix, the sha256 of its format and the key's parts joined
 * by NULs, and its suffix.  Throws for the wrong number of parts. */
export function stateName(kind: StateKind, ...key: string[]): string {
  const row = STATE_KINDS[kind];
  if (key.length !== row.key.length) {
    throw new TypeError(`${kind} takes ${row.key.length} key parts`);
  }
  return row.prefix +
    sha256Hex([String(row.format), ...key].join("\0")) + row.suffix;
}

/** stateName's file in the state directory `dir`. */
export function statePath(dir: string, kind: StateKind,
  ...key: string[]): string {
  return joinPath(dir, stateName(kind, ...key));
}

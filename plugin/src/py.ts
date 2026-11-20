// Python's semantics for reading a record: one copy for every module.
//
// The JSON the modules read is read by the rules of dict.get, `or` and
// truthiness, none of which JavaScript spells the same way.  Each helper
// here is the Python expression in its doc comment, and a module writes
// the helper wherever that expression is what it means.

/** A parsed JSON object, which Python reads as a dict. */
export type Dict = { [key: string]: unknown };

/** Is `v` a dict?  A JSON object, a plist dict, or one built here.
 * Arrays, plist data (Uint8Array) and dates are objects too, and none of
 * them is a dict. */
export function isDict(v: unknown): v is Dict {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** bool(v): None, False, 0, "", an empty list or dict are false.  NaN is
 * true, which is where it differs from JavaScript's. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v) || v instanceof Uint8Array) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

/** `d.get(k, dflt)`: the value under an OWN key of a dict, else `dflt`.
 * Own, so a record's "constructor" is not Object's.  A key present with a
 * null value returns the null, not the default, which `a.get("x",
 * a.get("y"))` depends on.  A `d` that is not a dict reads as empty. */
export function pyGet(d: unknown, k: string, dflt: unknown = null): unknown {
  return isDict(d) && Object.hasOwn(d, k) ? d[k] : dflt;
}

/** `k in d`. */
export function pyHas(d: unknown, k: string): boolean {
  return isDict(d) && Object.hasOwn(d, k);
}

/** `a or b`: `a` when it is true, else `b`. */
export function pyOr<A, B>(a: A, b: B): A | B {
  return pyTruthy(a) ? a : b;
}

/** `(d.get(k) or {})` followed by `.get(k2)`, the chain the readers are
 * built from: a missing or non-dict link reads as missing. */
export function pyDig(d: unknown, ...keys: string[]): unknown {
  let cur: unknown = d;
  for (const k of keys) cur = pyGet(cur, k);
  return cur;
}

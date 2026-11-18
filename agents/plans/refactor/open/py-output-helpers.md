---
title: RF2 The helpers that define output bytes, named for what they make
state: proposed
kind: implementation
part-of: refactor
touches: [mod/src/py.ts, mod/src/sources.ts, mod/src/claude_records.ts, mod/src/config.ts, mod/src/claude_calib.ts, mod/src/formatting.ts]
cost: 2M tokens, $2, 0.2% of the weekly limit
---

# RF2 The helpers that define output bytes, named for what they make

## Now

`py.ts` (310 lines, 25 exports) and a second set spread over other
modules reproduce Python's behaviour. Some of it decides bytes the mod
writes, hashes or compares, and must stay exactly as it is; it is named
for the language it was ported from:

| Helper | Where | What it fixes |
| --- | --- | --- |
| `pyJsonDumps` | `sources.ts:204` | `json.dumps`'s spacing and float form: the cache files, `cacheNamespace`'s hash, `commandInput` |
| `pyJsonDumps` (a second, for a `Map`) | `claude_records.ts:132` | the agent state file |
| `PY_SPACE` | `py.ts:79`, read by `config.ts:225`, `claude_records.ts:1569`, `:2002`, `claude_calib.ts:223` | `str.isspace`'s set, in regexes over records |
| `pyFloatRepr`, `pyFormatF`, `pyIntStr` | `py.ts:111`, `:218`, `:253` | how a figure is printed |
| `pyJsonLoads`, `pyFloat`, `pyFloatText`, `pyStr`, `pyRepr` | `sources.ts:53`–`:117` | parsing as the collector did |
| `pyJoin`, `pyMax`, `pyMin`, `pyEq` | `claude_records.ts`, `claude_render.ts:378`, `claude_sources.ts:239` | path joining, first-of-equals |

Two "Python's semantics" sections head `claude_records.ts:42` and
`sources.ts:43`; the word "Python" is in 75 comments across 15 files.

## Target

- One module, `py.ts` renamed `exact.ts`, holding only these, each named
  for what it produces: `stableJson` (with an option for the `Map` form,
  replacing both `pyJsonDumps`), `UNICODE_SPACE`, `floatRepr`, `fixed`,
  `intText`, `parseJson`, `firstMax`/`firstMin`, `joinPath`.
- Its header says once why each is exact: the bytes it makes are in a
  file, a hash or a fixture. No other comment names Python.

The bytes are unchanged; this is renaming and moving.

## Checks

`tests` with fixtures and state files unchanged; `typecheck`. A test per
helper holds the cases that differ from the plain JavaScript form
(`JSON.stringify`, `\s`, `String(x)`), so the reason each exists is
pinned.

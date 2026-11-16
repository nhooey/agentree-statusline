# Usage sources

A **usage source** supplies account-level readings: how much of each plan or
quota window is used and when it resets — the 🔋 and 🪫 rows, and 💳 — or, for
organization sources, an account's token and dollar totals for a period.
Everything else on the readout — tokens, cost, context, time — comes from the
session's own transcript, whatever source you pick.

Most people need no configuration. Claude Code gives the mod the plan's
week, and the mod asks the account's usage endpoint for the rest; the
default, `auto`, reads those. To pick another, set `usage-source` in a
[configuration file](options.md#configuration-files):

```jsonc
"usage-source": "auto"                       // the default
"usage-source": "cmd:/path/to/your-reader"   // your own program
```

## Sources

| Source | Needs | Gives |
|---|---|---|
| `auto` | — | native data, then a local fallback (below) |
| `native` | — | only what Claude Code itself supplied; never runs anything |
| `none`, `off` | — | native data or an existing cached reading; never refreshes |
| `cmd:PATH` | your program | whatever it prints, in the [format below](#writing-a-custom-command) |
| `claude-usage-tracker` | the [Claude Usage Tracker](#claude-usage-tracker) app (macOS) | plan windows |
| `anthropic-admin` | `ANTHROPIC_ADMIN_KEY` | organization totals for the period; see [Organization reports](#organization-reports) |
| `experimental-claude-oauth` | the session's own sign-in | plan windows, from an undocumented endpoint |

A source the configuration names that is none of these is a warning, and
the layer under it gives the value.

### What `auto` does

Under the mod with `plan-usage` on (the default), the plan's windows the
mod asked the account's usage endpoint for in the last seven minutes come
first, over the steps below; see
[The plan's windows under the mod](#the-plans-windows-under-the-mod).

1. Use native data if Claude Code has given fresh native data.
2. Otherwise use a native reading cached in the last 60 seconds.
3. Otherwise ask the fallback: the account's own usage endpoint
   (`experimental-claude-oauth`), asked as the session.
4. Whichever the fallback gives, a native reading taken later wins over it,
   stale or not.

`auto` never picks an admin source just because its credential is set; you
have to name it. The cache files described under
[Refresh and storage](#refresh-and-storage) are internal and not for other
programs to read.

### An explicit source is final

Naming a source other than `auto`, `native`, `none` or `off` replaces native
data for account readings. If that source fails, the readings are unavailable
(or the last good reading is shown, marked stale); the mod never falls back
to a different source. The session's own figures are unaffected.

`none`/`off` never run a collector, but still use native data and any
compatible cached reading, marked stale once it is more than five minutes old.

## Writing a custom command

`"usage-source": "cmd:PATH"` runs your program and reads one JSON object from
its stdout. This is the way to plug in anything the built-in sources don't cover.

**How it is run.** `PATH` is run directly, with no shell, or through `bash` if
the file isn't executable. It inherits the environment, so only use programs
you trust. It must exit 0, print at most 1 MiB, and finish within five
seconds, or the reading is unavailable. It is run at most once a minute per
account scope; renders in between use the cached result.

**Input.** A small JSON object on stdin, which you are free to ignore:

```json
{"agent": "claude", "session": "…", "model": "claude-opus-5",
 "account": "default", "period": "day",
 "period_start": 1790380800.0, "period_end": 1790419360.0}
```

`session` and `model` are present when known. `period_start` and
`period_end` are Unix seconds for the UTC period `account-period` chooses.
No conversation text, raw payloads or credentials are ever sent.

**Output.** Version 1 of the reading format:

```json
{
  "schema_version": 1,
  "as_of": "2026-09-26T08:00:00Z",
  "buckets": [
    {"id": "default", "windows": [
      {"id": "five_hour", "duration_seconds": 18000, "used_percent": 41,
       "resets_at": "2026-09-26T10:15:00Z"},
      {"id": "seven_day", "duration_seconds": 604800, "used_percent": 63,
       "resets_at": "2026-10-01T17:17:00Z"}
    ]}
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema_version` | yes | Must be `1`. |
| `as_of` | no | When the reading was taken: Unix seconds or RFC 3339. Used to mark it stale. If omitted, the time of the fetch. |
| `buckets[].id` | yes | A stable identifier for the quota. |
| `buckets[].label` | no | Its heading on the readout. |
| `buckets[].model`, `buckets[].feature` | no | What the bucket applies to. Set these only when your source says so explicitly. |
| `windows[].id` | yes | The window's name within its bucket. |
| `windows[].duration_seconds` | no | The window's length: 18000 for five hours, 604800 for a week. |
| `windows[].used_percent` | no | Percent **used**, not remaining, 0–100. Missing means unknown, not zero. |
| `windows[].resets_at` | no | Unix seconds or RFC 3339. A window whose reset has passed is shown as expired. |
| `account` | no | Organization totals; see below. |
| `credits` | no | The account's dollar credits; see below. |

Buckets stay separate all the way to the readout: a bucket with no
five-hour window gets none filled in from another bucket's, even one of the
same length, since two meters with the same duration are not the same
meter. Don't give a bucket a `model` just because it is the model in use.

The optional `account` object carries period totals: `period_start`,
`period_end`, `input_tokens`, `cached_input_tokens`, `output_tokens`,
`reasoning_output_tokens`, `cost_usd` and `scope`. Cached input is part of
input, and reasoning output part of output — they are subsets, not extra
tokens.

The optional `credits` list carries the account's dollar credits, apart from
its plan windows:

```json
"credits": [
  {"id": "cloud-sessions", "kind": "cloud", "label": "Cloud sessions",
   "remaining": 4.42, "granted": 250, "currency": "USD",
   "expires_at": "2026-11-05T07:59:00Z"},
  {"id": "promo-1", "kind": "promo", "remaining": 199.99, "granted": 200,
   "granted_at": "2026-10-15T00:00:00Z", "expires_at": "2026-11-14T00:00:00Z"}
]
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | A stable identifier for the credit. The first entry with an id is kept. |
| `kind` | yes | `cloud` (the cloud session credit), `promo` (a promotional credit), `prepaid`, `extra` (extra usage) or `passes` (guest passes). It chooses the glyph and the `credits.show` list. |
| `remaining` | yes | What is left: dollars, or a count of passes. |
| `granted` | no | The original amount. Not less than `remaining`. |
| `spent` | no | What it has paid for since its period began, such as extra usage's month. |
| `currency` | no | Three capital letters, such as `USD`. |
| `expires_at`, `granted_at` | no | Unix seconds or RFC 3339. The expiry is not before the grant. An expired credit is kept in the reading and never drawn. |
| `label`, `applies_to` | no | Its name, and what it pays for. |

An entry missing a required field, or whose figures contradict each other, is
dropped whole rather than drawn with a guess. A reading with no credits has no
`credits` key.

**Validation.** Unknown keys are dropped. A number that is negative,
non-finite or out of range, and a label containing control characters, are
treated as missing. A subset larger than its total (cached input above input)
discards the token counts. Nothing but the whitelisted fields is ever
written to disk.

**Older shapes** are still accepted: a top-level `windows` list in place of
`buckets`, read as one unlabelled bucket, and a flat object with
`session_pct`, `weekly_pct`, `session_resets_at` and `weekly_resets_at` and
no `schema_version`.

## Organization reports

`anthropic-admin` names your organization's usage and cost reports, read
with an admin key, for the UTC day, week (from Monday) or month to date that
`account-period` chooses. The mod accepts the name and makes no request for
it, so it gives no reading: the plan cells stay blank under it.

## Experimental subscription sources

`experimental-claude-oauth` calls the undocumented endpoint Claude's own
apps use to show subscription usage. It may break without notice. The mod
reads no credential store or browser cookie, and refreshes no token.

`experimental-claude-oauth` reads the five-hour window and every seven-day
one the answer holds with a utilization: `seven_day`, the weekly Fable
window `seven_day_overage_included` (or `seven_day_fable` where that key
has none), then every other `seven_day_*` key by
name (`seven_day_opus`, `seven_day_sonnet`, …), so a per-model week under a
new name is kept too.

The mod asks it as the session, with no token in the environment: the
engine adds the session's own credential and sends it only to Anthropic's
host. It is the mod's `auto` fallback for Claude, so the plan stays current
while no session is making requests, as use on another machine or on
claude.ai moves it. A reading is kept for five minutes in the shared state
directory, under the account Claude Code is signed in to (`oauthAccount` in
its `.claude.json`), so the machine asks once per five minutes, whatever the
number of sessions. With `plan-usage` on, the mod's own ask below stands in
for this fallback, which then asks nothing.

### The plan's windows under the mod

Claude Code gives the mod only the plan's week (`seven_day`) through
`$.session.usage()`, so the weekly Fable window that 🦊 draws on the 💳 row,
the five-hour window and the per-model weeks would need the Claude Usage
Tracker or another app. With `plan-usage` on, the default, the mod asks the
account's usage endpoint for them itself, as Claude Usage.app does:

- **One request a minute** to `https://api.anthropic.com/api/oauth/usage`,
  with the header `anthropic-beta: oauth-2025-04-20`, and once at each load.
- **With the session's own credential, via the engine.** The mod asks
  `$.session.authorize()` for an opaque handle and passes it to
  `$.http.fetch`, which sets the credential header itself, over https to
  Anthropic's host only. The mod never sees the credential, and reads no
  keychain or credential file.
- **Only for a signed-in subscription.** With no first-party credential (a
  third-party provider, a gateway, no login) or with an API key, nothing is
  asked. With `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set, Claude Code
  refuses the request.
- **Never on a drawing's path.** Each status document takes the reading
  kept, and an ask that is due starts after it, whose answer the next
  document takes. The reading is kept in the mod's store under the signed-in
  account, so every session on the account shares one ask a minute.
- **One session asks at a time.** The ask is made under a lock directory,
  `plan-usage-<hash>.lock` in the state directory, which `mkdir` makes
  atomically: the session that makes it asks, and the others take its answer
  from the store. A lock left for over 30 seconds, by a session that died
  holding it, is taken over.
- **The per-model weeks from the answer's `limits` list too.** The answer
  nulls its per-model `seven_day_*` keys and lists those weeks as
  `weekly_scoped` entries with a model scope instead. Each is read as the
  window for its model, over the key of the same name: Fable (or Mythos) as
  `seven_day_overage_included`, which 🦊 draws, Opus as `seven_day_opus`,
  Sonnet as `seven_day_sonnet`, Design as `seven_day_omelette`, and another
  model as `seven_day_<its id, else its name>`, drawn nowhere. A model is
  told by a display name equal to the word or a model id holding it, as
  Claude Usage.app tells it. The list's other entries, the session's and
  the plan's week, are left to the keys.
- **Drawn under `auto` over Claude Code's own reading** while it is at most
  seven minutes old; past that, `auto` goes on as above.
- **A failed ask** keeps the last reading, is written to `usage-band.log`
  once per distinct failure (`plan usage failed: HTTP 429`), and the next ask,
  from any session on the account, waits: two minutes after the first
  failure in a row, doubling with each failure after it up to an hour, or as
  long as the answer's `Retry-After` says where that is longer. An answer
  ends the run. An ask with no answer in 20 seconds counts as failed.
- **The window keys are logged** once per load, and again when they change:
  `plan usage: seven_day · limits: fable opus · no reading: five_hour
  seven_day_opus`. The keys with a utilization come first, then the weeks
  read from the `limits` list, by model, then the keys that are null or
  hold none. Key names only, never a figure or a header. The line says which key carries a
  window when one is in doubt, read or not.

Turn it off with `"plan-usage": false` in a configuration file. The
[credits](#the-accounts-credits) are read from a session's answer of the
last minute, where it has one, rather than asked for again.

## Claude Usage Tracker

[Claude Usage Tracker](https://github.com/hamed-elfayome/Claude-Usage-Tracker)
is a macOS menu-bar app that polls Anthropic for your plan usage and keeps the
result in its preferences. Reading those needs no network call and no token.
Name it as the source to read the app's figures in place of Claude Code's
and the usage endpoint's.

The store is read with `defaults export` rather than by opening the `.plist`
file, because a running app's latest preferences may not have reached the file
yet. The account named by `activeProfileId` is read, falling back to the one
marked `isSelectedForDisplay`, then to the first. Only the usage figures are
taken: the five-hour, weekly, Opus-weekly and Fable-weekly percentages, their
reset times, and when the app last updated them, with the record's `id` hashed (see
[Calibration cache](#calibration-cache)). The same record holds an OAuth
account and a session key, and neither is read.

The app keeps its profiles in the Keychain from version 3.3 on, which the mod
does not read, so its preferences hold no `profiles_v3` and the source gives no
reading. The mod writes that to `usage-band.log` once a load, as
`tracker: Claude Usage.app's settings have no profiles_v3, …`.

The Fable-weekly percentage becomes the weekly Fable window
(`seven_day_overage_included`, 🦊 on the 💳 row). The app keeps no reset time
of its own for it, so it takes the weekly window's; a store without the
figure gives no Fable window.

Set `CODING_AGENT_USAGE_LINE_CLAUDE_TRACKER_PLIST` to read an exported store
from a file instead, for example one copied from another machine.

## Refresh and storage

| Source | Refreshed at most every |
|---|---|
| native, `cmd:`, tracker | 60 seconds |
| `experimental-claude-oauth` | 300 seconds |
| the mod's `plan-usage` | 60 seconds |

Between refreshes the cached reading is used. A failed refresh keeps the last
good reading and backs off exponentially, up to five minutes, and longer if
the server sent `Retry-After` (also capped at five minutes). A reading older
than its refresh interval is marked **stale** — freshness comes from the
source's `as_of`, not from when it was fetched.

Concurrent sessions don't refresh the same cache twice: each refresh takes a
lock scoped to the source, account and period.

Caches live under `$XDG_STATE_HOME/coding-agent-usage-line`
(`~/.local/state/coding-agent-usage-line` by default), or
`CODING_AGENT_USAGE_LINE_STATE_DIR`. The directory is mode 0700 and files
0600, written atomically. Each cache is keyed by source, account and the
start of the `account-period`, so readings never leak between them. With
`"account": "default"`, the account scope is the credential in use (hashed)
for a source that has one, and otherwise the session — so two sessions never
share a reading that might belong to different accounts. Name the account
with `account` to share a reading across sessions.

### The account's high for each window

A plan window's use only rises until it resets, so a reading that names its
account (an `account_id`, or a cache shared under the account's id) shows
each window at the highest any reading of that account has given for it.
A window matches on its bucket, its window id and its reset, to the nearest
minute. Without this, a session idle since its last response keeps the
figure that response carried, 16٪ say, while the account's other sessions
read 20٪ and its OAuth answer 21٪. All three show 21٪.

The highs are kept in one small file per account (source `window-highs`),
and a window's high is dropped once the window resets. A reading that names
no account is shown as its source gave it.

### The account's credits

The account's dollar credits are read apart from its plan windows, since
`auto` takes the windows from Claude Code and so never asks the usage
endpoint. Every 5 minutes the mod asks the account's usage endpoint as the
session, as `experimental-claude-oauth` does, and keeps the `credits` it
gives in one small file per signed-in account, source `credits`, period
`credits`.

- **The cloud session credit:** each window of the answer with a dollar
  limit, taken by its fields and never its name, is a `cloud` credit: its
  dollars left, its limit, what it has spent, and its reset as its expiry.
- **Extra usage:** an `extra` credit while it is on and has a monthly cap,
  what is left of the cap, the cap, and what it has spent.
- **A failed ask** keeps the last credits, and the next ask waits out the
  same 5 minutes. With no signed-in account nothing is asked or kept.

### Calibration cache

The calibration (the dollars in one percent of a plan window) is kept in its
own file, `claude-calibration-<sha256>.cache`. It is keyed by source, account and period, but not by session:
the cost it divides is everything spent on this machine in the window, and
the percentage is the plan's, so every session of one account shares it.
The account part is a hashed id, the first 24 hex digits of a sha256, from
the source:

| Source | Account id |
|---|---|
| Claude Usage Tracker | `profile:` and the hash of the profile record's `id` |
| native (Claude Code's payload) | `account:` and the hash of `oauthAccount.accountUuid` in `$CLAUDE_CONFIG_DIR/.claude.json` (`~/.claude.json` by default) |

Only those two fields are read, and only the hash is kept. The id is what
keeps two accounts apart, since the percentage stored with a scan is one
account's and two accounts' windows can open at the same minute. A source
with no id, or a tracker profile without one, falls back to the reading
cache's account scope above (for `"account": "default"`, the session).

A calibration file untouched for eight days belongs to a period, account or
session that has passed, and is removed. The mod sweeps at most once a day,
by the stamp on `claude-calibration-swept`, and removes files with `rm`,
since its file API cannot.

## Diagnostics

The mod writes what it read and why a figure is blank to `usage-band.log`
in the state directory: a source that failed and when it is asked again, the
plan usage's window keys, the tracker's missing profiles. A `cmd:` source is
logged as `cmd`, without its path.

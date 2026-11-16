# Options

Every option is a key of a [configuration file](#configuration-files), which the mod reads; there is no command line.
Every key and its default is in [`mod/defaults/config.jsonc`](../mod/defaults/config.jsonc).

| I want to… | Set |
|---|---|
| a tighter readout on a narrow terminal | `"mark-spacing": false` |
| change where plan figures come from | `"usage-source"` — see [Usage sources](usage-sources.md) |
| leave a column out | `"hide"` — see [Hiding](#hiding) |
| move a row, or stop drawing it | `"rows"` — see [What a file holds](#what-a-file-holds) |
| set an option for every session, or for one project | a [configuration file](#configuration-files) |
| see which file set what | the mod's log, `agentree-statusline.log` in the state directory |

## Settings

The settings the table below lists apply to every row the mod draws; the others, which say where each row goes and what it holds, are under [What a file holds](#what-a-file-holds).

<!-- options:begin settings -->
| Key | Default | Effect |
|---|---|---|
| `usage-source` | `"auto"` | Where plan/quota figures come from. See [Usage sources](usage-sources.md). |
| `account` | `"default"` | A non-secret label that keeps cached readings for different accounts apart. Never put a token here. |
| `account-period` | `"day"` | The UTC calendar period for organization reports (`anthropic-admin`). Weeks start on Monday. |
| `right-edge` | `5` with any of the mod's rows above the prompt (`rows.*.place`), else `2` | The columns every grid row leaves blank at the terminal's right edge. `2` matches the mod with its rows under the footer line, whose container stops two columns short of the edge; `5` is the room Claude Code keeps for the mod's band `[-]` above the prompt. Unset, it follows the mod's `rows.*.place` from the files: `5` when any row the mod draws live is placed `above`, else `2`, so every row ends in one column. |
| `hide` | none | Columns and parts of a row's label left out of the grid, or 🔋 and 🪫 off the turn tag lines (`tag.plan.five_hour`, `tag.plan.week`), each `scope[.group[.metric]]` with `*` for any one part; see [Hiding](#hiding). |
| `mark-spacing` | `true` | A blank between a mark and its value; `false` closes it. |
| `subscript-decimals` | `false` | Write fractions as subscript digits: `1.2٪` becomes `1₂٪`. |
<!-- options:end settings -->

### `"mark-spacing": false`

Closes the one-column gap between a mark and its value, for terminals too narrow for the full readout:

```
default   ⌛ ⛳    ? 🤖 2.8h 🔧  58m 🚦 5.5h
          🔋 🎤 1.2٪ 🎮 3.8٪ 💳  15٪ 🔜 6.7m
tight     ⌛ ⛳   ? 🤖2.8h 🔧 58m 🚦5.5h
          🔋 🎤1.2٪ 🎮3.8٪ 💳 15٪ 🔜6.7m
```

On the receipt it reaches only the marks with nothing after them — 🧩, 🎯, 💳, 📖 and 📝:

```
default   🧩 ▴9.6k ▾3.4k  🎯 98٪  🧠+ 8.0٪ + 16k  💰+  0.1   🔋+ 0.02٪ 📖 29٪
tight     🧩▴9.6k ▾3.4k  🎯98٪  🧠+ 8.0٪ + 16k  💰+  0.1   🔋+ 0.02٪ 📖29٪
```

The column after 🧠, 💰, 🔋, 🪫, ⌛🤖 and 🔧 holds a `+` on the prompt row and a blank on the totals row beneath it.
That column is what keeps the two rows stacked digit under digit, so it stays.

### `"subscript-decimals": true`

Writes the digits after a decimal point as subscripts (U+2080–U+2089), so the point takes no column:

```
off   🧩▴2.7M ▾841k    🔋 🎤 1.2٪ 🎮 3.8٪ 💳  15٪ 🔜 6.7m
on    🧩▴ 2₇M ▾841k    🔋 🎤  1₂٪ 🎮  3₈٪ 💳  15٪ 🔜  6₇m
```

(Two groups of cells, before and after.)

A reading under 1٪ keeps its leading zero — `.08٪` becomes `0₀₈٪` — because `₀₈` alone reads as a small 8.
That makes the sub-1 reading the same width in both forms, and it is the widest reading, so **no field gets narrower**: a shorter figure just gets another column of padding and nothing on the row moves.
The option changes how figures look, not how much room they take.

Ghostty draws the subscript digits one column wide, which is what the mod assumes.

## Hiding

`"hide"` is a list of paths, `scope[.group[.metric]]` with `*` for any one part, each leaving out a column or a label part.
A path names what it hides on rows of that scope; a column hidden on every row that could draw it is removed and the others close up, and one hidden on some rows only is left blank there.
The band's and the receipt's rows count too, so `agent.state.rate` blanks 🛫 on the agent rows and keeps its place, while `*.state.rate` removes it.

| Part | Values |
|---|---|
| scope | `account`, `turn`, `main`, `session`, `agent`, and `tag` for the turn tag lines, 🔻🔖 and 🔺🔖 |
| group | `plan` (🔋 🪫, and on the 💳 row 🦊 `fable` and the other weekly windows, 🎼 `opus`, 🎭 `sonnet`, 🍳 `omelette`, 🔌 `oauth_apps` and 🤝 `cowork`), `cost` (💰, and `spend`, the credit paying for it after it), `tokens` (🧩 🎯), `context` (🧠), `time` (⌛ ⛳ 🤖 🔧 🚦), `work` (💾), `state` (model, 🛫, and on agent rows the 👶🏻 🤏 💻 📡 📨 counts), `chat` (the activity, and the progress update and 🎤's prompt in the band's tree), `workspace` (🌿), `clock` (📅 🕐), `name` (the name and the kind) |

On an agent row:

| Path | Hides |
|---|---|
| `agent.name.kind` | the kind's mark and the phase circle |
| `agent.name.label` | the agent's name |
| `agent.workspace.branch` | 🌿 and a worktree's branch |
| `agent.chat.doing` | what it is doing, the activity text |
| `agent.chat.progress`, `main.chat.progress` | the first line of the last text the thread wrote, its progress update or, once it has ended, its answer, after the name in the band's tree |
| `turn.chat.prompt` | the prompt typed last, after 🎤's name in the band's tree |
| `agent.state.kids`, `.compact`, `.shells`, `.monitors`, `.inbox` | 👶🏻, 🤏, 💻, 📡, 📨 |
| `agent.state.model`, `.rate`, `agent.cost`, `agent.cost.spend`, `agent.context`, `agent.tokens.io`, `.cache`, `agent.time.elapsed`, `.eta`, `.split`, `agent.plan.five_hour`, `.week`, `agent.work` | the columns |
| `agent.context.share` | 🧠's ٪ of the window, its size set flush right; hidden on every scope (`*.context.share`), 🧠's column narrows by the ٪'s room |

On the turn tag lines, 🔻🔖 under the prompt and the receipt's 🔺🔖 ([docs/layout.md](layout.md#the-turn-tags)):

| Path | Hides |
|---|---|
| `tag.plan.five_hour` | 🔋, the account's 5-hour window; `*.plan.five_hour` hides it here and on every row |
| `tag.plan.week` | 🪫, the account's weekly window; `*.plan.week` hides it here and on every row |
| `tag.plan` | both, and 💳 with them |
| `name.tag` | both tag lines, with the blank rows around the receipt's |

```
"agent"                  every agent row, empty
"*.work"                 💾 on every row
"agent.time.eta"         ⛳ on the agent rows, blank in its column
"*.state.rate"           🛫 everywhere
"*.context.share"        🧠's ٪ everywhere, its column narrower
```

## Configuration files

Every option is in [`mod/defaults/config.jsonc`](../mod/defaults/config.jsonc), with its default and a line on what it does.

### Starting from the defaults

That file is the defaults: the mod reads it at every load, and no default is written anywhere else.
To change settings, write only the keys you change in your user file, or in a project's; a table such as `rows` takes just the fields you set:

```jsonc
// ~/.config/agentree-statusline/config.jsonc
{
  "mark-spacing": false,
  "rows": {"turn": {"live": "always"}}
}
```

Every key the file leaves out keeps the default, so a later change to a default in the repository reaches you.
A full copy of the defaults file works too, but sets every option, so it keeps the defaults of the day you copied it.
`right-edge` is `null` in the defaults file, which means "follow `rows.*.place`"; `null` in your file means the same, and is not a setting.

The defaults file is read strictly.
A key missing from it, a key that is no option, or a value of the wrong type is an error naming the file and the key, never a value made up in its place: the mod draws it in red under the footer line in place of its rows, with one line in the transcript.
The mod reads the defaults file once each time it is loaded, once it reads whole: a change to it on disk shows after the next `/reload-plugins`, which also loads the code written for it, and the mod's log says the change is waiting.
Your own files stay lenient, as below, and apply within a tick.

### What a file holds

A file is JSON with `//` comments and trailing commas allowed, an object of `name: value`:

```jsonc
{
  "usage-source": "claude-usage-tracker",
  "hide": ["*.work"],   // a list replaces the lower layers' whole
  "mark-spacing": false,
}
```

A setting comes from the first of these that has it:

| Layer | Where |
|---|---|
| `project-local` | `<root>/.config/agentree-statusline/config.local.jsonc`: one person's, not committed |
| `project` | `<root>/.config/agentree-statusline/config.jsonc`: committed, for everyone |
| `user` | `$AGENTREE_STATUSLINE_CONFIG_DIR/config.jsonc`, else `$XDG_CONFIG_HOME/agentree-statusline/config.jsonc`, else `~/.config/agentree-statusline/config.jsonc` |
| `default` | `mod/defaults/config.jsonc` in the repository, which the plugin carries |

The project `<root>` is found by walking up from the session's root, where the session started or `/cd` took it, to the first directory holding either project file.
The walk stops at a `.git`, at `$HOME` and at `/`.
A git worktree with no local file of its own reads its main checkout's.

Lists replace and tables merge per field: a project that sets `rows.agent.transcript` keeps every other row from the layers under it.
`credits` merges per field too, and its `show` per credit.

Nothing in your own files stops a run.
A key a file leaves out comes from the layer under it, and in the end from the defaults file.
A file that is not valid JSONC or not an object is skipped whole, and so is a file with an unknown key at any depth (an option, a row of `rows`, a field), so a misspelt key can't go unnoticed.
A value of the wrong type or out of range is skipped alone, the layer under it supplying the value.
Each is a warning naming the file, and an unknown key's names the nearest known one.

The mod reads the files at each load (a session's start or a `/reload-plugins`), again on `session.start`, and every 30 seconds while idle, a stat of each file, reading again only when one has come, gone or changed, or `/cd` has moved the session's root; a change draws every row again under the new options, with no reload.
Each read writes what each file gave and every warning to `agentree-statusline.log` in the state directory, one line each, and a read that changes the options writes them too, each with its layer.
A file with a warning also gets one notice line in the transcript, `agentree-statusline: config <path>: …`, once per change to the file.

Under the files the mod has one layer of its own, `mod`: `SETTINGS` in `mod/hooks/config.ts`, for a setting it draws with that is not the default and that no file gives.
It is empty: a person's own settings go in their user file.
The mod's log names it.

`right-edge` follows the places in `rows` when no layer sets it: 5 when any row whose `live` is not `"never"` has `place` `"above"`, as under the defaults, else 2.

`plan-usage` is on in the defaults: the mod asks `https://api.anthropic.com/api/oauth/usage` for the plan's windows once a minute, one request with the session's own credential, which Claude Code sets on the request and the mod never sees, and only for a signed-in subscription.
Under `usage-source` `auto` it draws them over Claude Code's own reading, which names only the plan's week, so the weekly Fable window (🦊 on 💳) shows without the Claude Usage Tracker.
`false` turns it off; see [The plan's windows under the mod](usage-sources.md#the-plans-windows-under-the-mod).

`weekly-windows` holds a field for each of the other weekly windows the usage source can give beside the plan's week and the Fable one, all `false` in the defaults:

| Field | Window | Mark |
|---|---|---|
| `opus` | `seven_day_opus` | 🎼 |
| `sonnet` | `seven_day_sonnet` | 🎭 |
| `omelette` | `seven_day_omelette` | 🍳 |
| `oauth_apps` | `seven_day_oauth_apps` | 🔌 |
| `cowork` | `seven_day_cowork` | 🤝 |

A field set `true` draws its window on the 💳 row after 🦊 wherever the source gives it ([The rows](layout.md#the-rows)).
It is a record, so it merges per field: a file that sets `{"opus": true}` leaves the other four off.
The windows are kept off here rather than in `hide`, since a file's `hide` replaces the defaults' list whole and would turn them all on.
`hide` still hides one that is on, `account.plan.opus` and the like.
A `seven_day_*` window not in the table is kept in the reading and drawn nowhere.

`rows.subagents.live` is `"always"` in the defaults: background subagents keep running between turns, so the band's tree keeps the running and paused ones under 🧵 then, and leaves the ones that ended to the turn's receipt ([Between turns](layout.md#between-turns)).
`"running"` draws them only while a turn runs.

`finished-within` is how many seconds a row of the band's tree that finished stays drawn where it stood, ⚫ and its figures as they ended, before it goes: a subagent that ended, and a background shell or Monitor that closed.
The rows above a finished one stay drawn with it, so it keeps its place in the tree.
It counts from when the row finished, the agent's last record or the record that closed the task, so a reload does not start it again.
The defaults say 120; 0 drops a row at once.

The tree draws every row it holds, however many subagents there are; scroll the band, or fold a row (⊟ ⊞) to hide its subtree ([The tree](layout.md#the-tree)).

The log's `config options:` line lists every option a layer above the defaults gave, each with its value and layer.

### The credits

The mod draws the account's dollar credits on the 💳 row, after 🪫, each as its glyph, what is left and 🔜 the time to its expiry: `⛅ $4.4 🔜 15h  🎁 $200 🔜 9.6d`.
`credits` says which and how:

| Field | Value | Effect |
|---|---|---|
| `place` | `"account"` or `"none"` | Draw them on the 💳 row, or not at all. |
| `show` | a list of conditions for each of `cloud` ⛅, `promo` 🎁, `prepaid` 💵, `extra` 💸 and `passes` 🎫 | A credit is drawn when any one condition in its list holds. An empty list never draws it. |
| `amber`, `red` | a list of conditions | A credit's figure is amber when one of `amber`'s holds, and red when one of `red`'s does. Red wins. |
| `original` | `true` or `false` | Draw each original amount after the figure: `⛅ $4.4/250`. |
| `command` | a program's path, or `null` | A program that prints `{"schema_version": 1, "credits": [...]}`, as [the reading's `credits`](usage-sources.md#writing-a-custom-command) has them, run every 5 minutes for the Console's credits. |

A condition is one map of `field`, `op`, `value` and `unit`:

```jsonc
{"field": "balance", "op": "<=", "value": 20, "unit": "usd"}
```

| `field` | `unit` | Means |
|---|---|---|
| `balance` | `usd` or `percent` | what is left, in dollars or as a share of what was granted |
| `spent` | `usd` | what it has paid for since its period began |
| `expiry` | `days`, `hours` or `minutes` | the time to its expiry |

`op` is one of `<`, `<=`, `=`, `!=`, `>=` and `>`.
A condition whose figure a credit doesn't have doesn't hold, and an expired credit is never drawn.
To draw a credit always, give it `{"field": "balance", "op": ">=", "value": 0, "unit": "usd"}`.
A list with a condition that is not of this shape is skipped whole, with a warning naming it.
On a narrow terminal the credits leave the row before 📅 and 🕐.

## Environment variables

| Variable | Effect |
|---|---|
| `AGENTREE_STATUSLINE_CONFIG_DIR` | The user-global [configuration](#configuration-files) directory. Default `$XDG_CONFIG_HOME/agentree-statusline`, or `~/.config/agentree-statusline`. |
| `AGENTREE_STATUSLINE_STATE_DIR` | Where caches, the mod's log and per-session state live. Default `$XDG_STATE_HOME/agentree-statusline`, or `~/.local/state/agentree-statusline`. |
| `AGENTREE_STATUSLINE_CLAUDE_TRACKER_PLIST` | Read an exported Claude Usage Tracker store from this path instead of the running app's preferences. |
| `ANTHROPIC_ADMIN_KEY`, `CLAUDE_OAUTH_ACCESS_TOKEN` | Credentials for the sources that need them. See [Usage sources](usage-sources.md#sources). |

`AGENTREE_STATUSLINE_CLAUDE_CALIB_CACHE` supplies a prepared calibration, for the tests; it is not for everyday use.

No environment variable is a setting: an option is a key of a configuration file.

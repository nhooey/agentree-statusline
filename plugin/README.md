# plugin

The whole project: the Claude accounting, the usage-source reader and the
cells under `src/`, and the Claude Code plugin, `agentree-statusline`, that
draws them ([Layout and rendering](../docs/layout.md)).

Node 23.6 or later runs the sources directly, with no build, so the code
keeps to TypeScript's erasable syntax: no `enum`, no `namespace`, no
parameter properties, and imports name their `.ts` files. The tests need no
packages; type checking needs the two dev dependencies, TypeScript and
Node's type definitions.

    cd plugin && node --test 'test/*.test.ts'
    cd plugin && npm ci && npm run typecheck

`src/spec.ts`, `src/state_spec.ts` and `src/options_spec.ts` hold the
constants: the glyphs, colours and widths, the state files and the options.
Each module's tests check it against
the cases under `tests/fixtures/`: committed data, or written by the generators under `tools/`
([tests/README.md](../tests/README.md) says which).

## The plugin

This folder is the plugin. `.claude-plugin/plugin.json` names it
`agentree-statusline`, `hooks/register.tsx` is its hooks module, and
`types/index.d.ts` its `$.state` contract. It draws four places, and writes one:

- **The band** above the prompt (`AbovePrompt`), which Claude Code can
  collapse with its `[-]`: the session's threads as a tree, 🎮 the
  session at its root with where the session works, then 🧵 the main
  thread and, under it, 🎤 its turn while one runs and the subagents it
  started (between turns, those still running or paused), each with its
  latest progress update. A click on a row's `⊟` or `⊞` folds or opens
  it, one on a thread's label shows that thread's transcript, and 🎮's
  📦 🌿 🔀 link to GitHub; see
  [The tree](../docs/layout.md#the-tree). Each row of the `rows` table goes where
  its `place` puts it, `"above"` here or `"footer"` under the footer
  line; see
  [docs/layout.md](../docs/layout.md#above-the-prompt-and-under-the-footer-line).
  The rows in both places are the grid's, for the session, from the last
  status figures document, redrawn as the session starts, after each tool
  call, as a turn starts and ends, every 5 seconds while a turn runs
  (never more often than three times as long as the last read took) and
  every 30 seconds otherwise. Their clocks (🔧 ⌛ ⛳ 🕐 🔜) move each
  second between reads. While a turn runs its 🎤 and 🎮 rows are that
  turn's, live. While a survey (a question picker) holds the band, the plugin
  draws nothing there.
- **The footer** under the prompt, `-- INSERT -- ⏵⏵ auto mode on …`:
  Claude Code's own line, whose pills stay live, then the rows placed
  under it, in colour: 💳, the account and where the session works but
  for what the tree's root draws, on a row of its own (`account-place`
  `"row"`; `"tail"` puts it dim at the line's right end). 📁 on 💳 draws
  the whole path, the project's own folder in 📦's colour, so in
  `📁~/git/repo/plugin` the `repo` stands out as the project. 🧵 draws the model and effort its next turn
  runs on, between turns too, and while a turn runs, its answering or
  waiting time is in 🛫's column.
- **The closing line,** `✻ Worked for 1m 5s`, as the receipt: as a turn
  ends, the rows the `rows` table stamps (🎤 alone as the plugin ships)
  stamped there, frozen, and under them the turn's 🔺🔖 tag, the
  account's 💳 🔋 and 🪫 then and when it was stamped, so every turn's receipt stays in the transcript to scroll
  back to.
- **The start tag,** under a prompt typed at the composer, at no indent:
  🔻🔖, the turn's tag, the account's 💳 🔋 and 🪫 then and when it
  started, dim.

The hooks import the modules of `src/`. The plugin's runtime has no Node and
loads nothing from outside the plugin's folder, so the modules that read
files keep their reads in `src/*_node.ts`, which only Node imports, and
`hooks/` makes the same reads through the engine's `$`, in
`engine.ts`, `transcripts.ts`, `usage.ts`, `calibration.ts` and
`configuration.ts`, and `edges.ts` builds the documents from them.

### Configuration

The plugin draws from the options merged from the
[configuration files](../docs/options.md#configuration-files): the
project's local file, the project's, the user's, then the defaults file,
`defaults/config.jsonc` here, which the plugin carries, with `right-edge`
following the rows' places where no file sets it. The plugin reads the defaults file once per load, so a change
to it waits for `/reload-plugins` with the code written for it. It is
read strictly: while anything in it is
wrong, the plugin draws nothing from it, and shows the error in red under the
footer line in place of its rows (see
[Starting from the defaults](../docs/options.md#starting-from-the-defaults)).
Every option is listed in `plugin/src/options_spec.ts`: the
usage source, `plan-usage` (the plan's windows asked of api.anthropic.com
once a minute; see [Usage sources](../docs/usage-sources.md#the-plans-windows-under-the-plugin)),
the account and period, the `hide` paths, `mark-spacing`
and `subscript-decimals`, the `rows` table (for each of 🎤, 🧵, 🎮, the subagents, the
🔖 tag lines and 💳, where it is drawn, above the prompt or under the
footer line, when, and whether a turn's end stamps it into the
transcript), `account-place`, `weekly-windows` (the 💳 row's other weekly windows, all off by default), `right-edge` (following the rows' places),
the footer's layout (`hint-inset`, `hint-tuck`, `footer-ruler`),
`agent-message-row`, `slow-toast` (a slow read shown as a toast as well as
in the log) and `starts-kept` (how many start lines and receipts the
plugin's store keeps). `hooks/configuration.ts` reads the
files at each load, on `session.start`, and every 30 seconds on the tick,
a stat of each file, reading again only one that has changed, or the
files of a new root after a `/cd`; a change draws everything again, with
no `/reload-plugins`. Each read goes to `agentree-statusline.log` (the
files, the options a layer above the defaults gave, and every warning), and
a file with a warning gets one notice line in the transcript per change.

`hooks/config.ts` holds what no file sets: the ticks (idle, running, and
the clocks'), how long the receipt waits for its turn, and the version the
plugin's caches are keyed by. It also holds `SETTINGS`, the plugin's own layer
under the files, for a setting it draws with that is not the option's
default and that no file gives; it is empty, since a person's own
settings go in their user file.

The state directory and the projects directory:
`AGENTREE_STATUSLINE_STATE_DIR` (else
`$XDG_STATE_HOME/agentree-statusline`, else
`~/.local/state/agentree-statusline`) and `$CLAUDE_CONFIG_DIR/projects`
(else `~/.claude/projects`). The tracker override,
`AGENTREE_STATUSLINE_CLAUDE_TRACKER_PLIST`, names an exported store to
read in place of the app's.

The plugin keeps the session's transcript as its two running folds, and folds
only the lines written since the last read. It saves them once a minute
(`foldSaveMs`) into the state directory, in
`claude-main-fold-<digest>/`, as `plugin/src/state_spec.ts`'s `main-fold` row
names them, so a `/reload-plugins` reads on from there rather than from
the start. A saved fold is passed over when the transcript is no longer
the bytes it was folded from, or its format is not the spec's.

Each agent's file is kept as its fold the same way, in
`claude-agent-fold-<digest>/`, the `agent-fold` row's directory, one file
per agent written to two slots in turn.

A long stretch to fold, as on the first read of a long session, the plugin
folds 8 MiB at a time, the transcript's and each agent's file alike, so
no more than a piece is held at once and the hooks worker is free between
pieces. Once the fold is saved, a reload reads on from it.

### The receipt

As a turn ends the plugin stamps its receipt as the turn's closing line, in
place of Claude Code's `✻ <word> for <duration>`: the rows whose
`transcript` is set in `rows`, frozen and dim, in their colours. As the
plugin ships that is 🎤 alone, since 🧵 and 🎮 stay live on screen
(`usage-dev figures
tests/fixtures/figures/cost/10-turn-id.json --cols 160 --part
receipt --inset 2 --right-edge 5 --plain`):

```
                         🎤                   💰0.2   🧠+21k +10٪  🧩▴ 18k ▾3.5k  🎯97٪  ⌛  3m         🤖⠶⠄ 🔧⠦⠀ 🚦⠀⠀  🔋  .03٪  🪫  .043٪

🔺🔖 8f37748e #12  💳 🔋  41٪  🪫  63٪  📅 2026-08-16  🕐 02:23:20
```

A blank row, then the stamped rows laid out at the width the band last
drew at, `hint-inset` columns in as every row is, so each column is under
the live rows'; then, after a blank row, the turn's tag line, drawn as the start tag is, so
its 🔺🔖 is under the 🔻🔖; then a blank row. Until the stamp lands the
closing line is a blank row, and the band keeps 🎤 until a second after it
lands (`receiptHoldMs`), so the turn's figures are never off screen. The
option `rows` sets, for each of `turn`, `agent` and `session`, where it
is drawn (`place`), whether it is drawn while a turn runs, always or
never (`live`), and whether the receipt stamps it (`transcript`), apart;
`--rows` to `tools/draw-figures.ts` takes the same table.
`"rows": {"agent": {"transcript": true}, "session": {"transcript": true}}`
stamps 🧵 and 🎮 under 🎤. A turn that ran subagents stamps the band's
tree, drawn whole and pressing nothing: 🧵 the parent, under it 🎤 and
then every agent the turn ran that had finished, 🏁, from the
band's last status document (`--agents` with `--status` draws it;
[docs/layout.md](../docs/layout.md#the-receipt)). The receipt is Text in the transcript rather
than a `$.ui.log` line, which Claude Code draws as its own notice,
`⏺ agentree-statusline:` before it and a blank row after, in plain dim text.

Claude Code writes a turn's records to the transcript only after its Stop
hooks have run, after the plugin hears `turn.complete`, so the stamp waits
for them: it reads the transcript every half second until the newest
prompt's turn is billed and two reads agree on it, for up to 30 seconds,
and goes on after the handler has returned. Then it builds the cost
document as the band builds its status document, times the turn by the
engine's duration, and logs it.

Each turn is stamped once: its key, by session, is kept in the plugin's
store, so a second `turn.complete` over it logs nothing. A turn whose
records never land, and any failure, logs nothing to the transcript and
says why in the plugin's log (below).

A Stop hook that prints a receipt of its own belongs out of `hooks.Stop`
with the plugin loaded, or each turn gets both.

### Running it

For every session, installed from this repository's marketplace
(`.claude-plugin/marketplace.json` at its root):

    claude plugin marketplace add "$PWD"
    claude plugin install agentree-statusline@agentree-statusline

or from GitHub, in a session:

    /plugin marketplace add nhooey/agentree-statusline
    /plugin install agentree-statusline@agentree-statusline

Installed from a local marketplace, the plugin is read from `plugin/` itself: a
change here takes effect at the next session start or `/reload-plugins`,
with nothing to update. Installed from GitHub, it is a copy, and
`claude plugin update` brings it up to date.

The plugin draws the status line and the Stop hook's receipt: leave any
`statusLine` command and receipt-printing Stop hook out of `settings.json`.

For one session, with nothing installed and no settings changed:

    claude --plugin-dir "$PWD/plugin"

To try it in a session already running, as a dev mod: copy the folder into
the session's mods folder, which the `plugin-authoring` skill makes and
names (`~/.claude/dev-mods/<session id>/`), then reload. A copy and not a
symbolic link: the loader refuses a module that resolves outside the
folder it loads.

    rsync -a --delete --exclude node_modules --exclude test \
      --exclude tools plugin/ ~/.claude/dev-mods/<session id>/agentree-statusline/

and in the session, `/reload-plugins`. To remove it, delete that folder
and `/reload-plugins` again.

`--plugin-dir` holds for the one process it is given to: a session
resumed with `claude --resume <id>` alone runs without the plugin, and draws
neither the band, the start line nor the receipt. Resume with both:

    claude --plugin-dir "$PWD/plugin" --resume <id>

### Its log

The plugin's handlers catch what fails, so a failed read leaves the last
drawing up instead of failing Claude Code's event; what they catch is
logged, with what was thrown and where. Each line names its time and the
first eight characters of its session's id, and goes two ways:

- `agentree-statusline.log` in the state directory
  (`~/.local/state/agentree-statusline/agentree-statusline.log` by default),
  always: the newest 500 lines from every session.
- Claude Code's debug log, as `[agentree-statusline] $.ui.log (to debug):`
  lines, when Claude Code runs with `--debug-file <path>` (or `--debug`), beside
  the engine's own lines about the plugin's hooks: when each settled, and
  each `$` call that failed.

Each load of the plugin writes one line when its first event comes,
`started by session.start in <cwd>`: a session whose turns drew nothing
and that has no such line never loaded the plugin. A status read that failed
says why (`refresh: no status document: …`), as does a turn that got no
receipt (`no receipt: …`). The plugin times each read, step by step, and a
read over two seconds is logged and shown as a toast, at most one a
minute, with each step's length in ms: `slow read: <ms> (records,
load, fold, shell, pieces, decode, parse, agents, sum, turns, usage,
calib, git)`, each followed by its figure; `pieces` counts the shell
reads, and `foldPieces` the 8 MiB pieces folded.

### Its tests

`plugin-tests/` runs in Claude Code's own test runner, which loads the plugin as
a session would and stands in for the engine beneath it:

    usage-dev plugin-test

It validates the plugin and runs the harness tests from a scratch copy, since
the runner collects every `*.test.ts` under the folder it is given and
`test/` holds Node's. Each test answers `$.fs` from the fixture
transcripts (`plugin-tests/fixtures.gen.ts`, written by
`usage-dev plugin-fixtures`; `test/plugin-fixtures.test.ts` fails when it
is stale) and checks what the plugin drew, the receipt's closing line among
them, against the `src/` functions over the same bytes. It needs the
`claude` command, which CI does not have.

The hooks type-check against the engine's types, which it writes into
`.claude-plugin/types/` the first time it loads the plugin (with
`--plugin-dir`, or as a dev mod); they are not committed.

    cd plugin && npm run typecheck:plugin

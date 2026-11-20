# Layout and rendering

The reference for everything the program draws: the rows above the prompt and under Claude Code's footer line, the receipt each turn leaves in the transcript, the subagent rows and the row a message from another agent is folded into.
Each section opens with a real render, then says what every cell is.
The [legend](../README.md#legend) in the README names every glyph.

The mod, `agentree-statusline` in [`mod/`](../mod/README.md), draws inside Claude Code's own screen: the band's tree of threads above the prompt, the 💳 row under the footer line, the receipt and the turn's tags.
The subagent rows, one per subagent, hang in the band's tree, drawn by `agent_row.ts`.
Every row of all of them has the same columns in the same order, so a figure stands on the same screen column wherever it is drawn.
Claude Code's own agent panel draws its rows itself.
Why it is laid out this way is in [the plan it was built from](../agents/plans/closed/redesign.md), and the tree in [The band's tree](../agents/plans/open/one-panel-port.md#the-bands-tree).

All examples below are the programs' own output against the test fixtures (clock pinned to 2026-08-16 02:23:20 UTC, the `unknown` terminal profile), with colour stripped: `usage-dev figures` for the mod's rows, from `tests/fixtures/figures/`, with the subagents of a case of `tests/fixtures/panel/inputs.json` where the tree has some (`--agents`).
Colour and brightness carry meaning of their own — see [Colour and brightness](#colour-and-brightness).

- [Above the prompt and under the footer line](#above-the-prompt-and-under-the-footer-line)
  - [The rows](#the-rows)
  - [The tree](#the-tree)
  - [The grid](#the-grid)
  - [Column by column](#column-by-column)
  - [Labels](#labels)
  - [Fixed widths](#fixed-widths)
  - [Narrow terminals](#narrow-terminals)
  - [Between turns](#between-turns)
  - [Hiding](#hiding)
- [The receipt](#the-receipt)
  - [The turn tags](#the-turn-tags)
- [The subagent rows](#the-subagent-rows)
  - [Subagent cells](#subagent-cells)
  - [State](#state)
  - [Inbox](#inbox)
  - [Nesting](#nesting)
  - [ETA](#eta)
  - [Blank cells](#blank-cells)
- [Messages from agents](#messages-from-agents)
- [Colour and brightness](#colour-and-brightness)
  - [Under tmux](#under-tmux)
- [Other placements](#other-placements)
  - [Every row in one place](#every-row-in-one-place)
  - [The footer's tail](#the-footers-tail)
  - [The status line and the Stop hook](#the-status-line-and-the-stop-hook)

## Above the prompt and under the footer line

The mod draws its rows in two places: above the prompt, in the band Claude Code can collapse with its `[-]` and ctrl+x ctrl+a (`AbovePrompt`), and under Claude Code's own `-- INSERT -- ⏵⏵ auto mode on` footer line, in the same container (`PromptHint`).
While a turn runs, at 160 columns, above the prompt (`usage-dev figures tests/fixtures/figures/status/01-baseline.json --cols 160 --part above --inset 2 --right-edge 5 --rate 200 --plain`):

```
  ⊟ 🎮        📦repo 🌿golden-clean        💰  35                 🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠶⠄ 🔧⠆⠀ 🚦⠄⠀  🔋 3.8٪   🪫 8.45٪
  ╰⊟ 🧵    🟢 main        🧬O⁵🐇  🤖   3m  💰  35   🧠 115k  11٪  🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋 3.8٪   🪫 8.45٪
     ╰─ 🎤 🟢 turn  Why…  🧬O⁵🐇  🛫 200   💰 6.4   🧠 -42k  -4٪  🧩 ▴525k ▾151k  🎯98٪  ⌛  8m         🤖⠶⠆ 🔧⠆⠀ 🚦⠀⠀  🔋 1.2٪   🪫 1.56٪
```

and, past the prompt, under the footer line (the same with `--part footer`):

```
  -- INSERT -- ⏵⏵ auto mode on (shift+tab to cycle)
  📁~/src/statusline-fixture/deep/tree                                                    💳 🔜 6.7m 🔋  15٪  🔜 1.9d 🪫  87٪    📅 2026-08-16  🕐 02:23:20
```

The footer's first line is Claude Code's, drawn by Claude Code, so its pills stay live; the mod draws the rest under it.
Claude Code draws its `[-]` in the five rightmost columns of the band's first row, beside 🎮.
The fixture's transcript writes no lines and reports no ETA, so 💾 and ⛳ are blank here; [the tree's render](#the-tree) has both.

### The rows

Each row is one scope: its label says which, and its figures count that scope alone.
Where each is drawn and when are the option `rows` in the [configuration files](options.md#configuration-files), a `place`, a `live` and a `transcript` for each row ([mod/README.md](../mod/README.md#configuration)); as the mod ships:

| Row | Scope | Place | Drawn |
|---|---|---|---|
| 💳 | the account: the plan's two windows and the Fable window, and where the session works but for what 🎮's label has, all on the label | under the footer line | always |
| 🎮 `session` | the session: the main thread and every agent, summed; on its label, its name and where it works | above the prompt, the tree's root | always |
| 🧵 `agent` | the main thread alone, before any agent's figures are added | above the prompt, under 🎮 | always |
| `subagents` | each subagent alone | above the prompt, under the thread that started it | always; between turns, those running or paused |
| 🎤 `turn` | the turn: what it has cost so far | above the prompt, under 🧵, first | while a turn runs |

Above the prompt the rows are [a tree](#the-tree): 🎮, then 🧵, and under it 🎤 and the subagents.
Under the footer line they stand in one order, whatever the places: 💳, 🎤, 🧵, 🎮, the lowest just over Claude Code's agent panel.
The subagents are drawn in the tree alone, and their place is always above the prompt.
When the turn ends, 🎤 becomes [the receipt](#the-receipt), frozen, in the transcript just above the band.

Every row, above the prompt and under the footer line, and the receipt, starts at one column and ends at one column, so a figure on 🎮 stands over the same figure on 🧵 and on the subagent rows:

- **The left edge.** Claude Code draws the footer's container `hint-inset` (2) columns in from each edge, and the mod draws its rows there that much narrower; the band above the prompt starts at the terminal's left edge, so its rows, and the receipt, are indented `hint-inset` columns instead.
- **The right edge.** Every row ends `right-edge` columns short of the terminal's edge: 5 when any row drawn live is above the prompt, clear of the `[-]`, else 2 (`right-edge` follows `rows.*.place`; the subagents count unless their `live` is `never`).

Under the rows Claude Code's blank row stays, between the footer and the panel's `⏺ main`; `hint-tuck` draws them with a bottom margin of -1 instead, taking it up.

**The 💳 row** is all label, starting where the other rows start.
On the left, what is the project's: 📦 project, 🌿 branch, 📁 directory, 🔀 PR and 🎨 output style, less 📦 🌿 🔀 while the tree's root draws them on its label.
Then, flush right where the other rows end, what is global: 💳 and each window's share, 🔋 the 5-hour and 🪫 the weekly, then 🦊 the weekly Fable window (Claude Code's `seven_day_overage_included`) where the usage source has one, then the other weekly windows that the option [`weekly-windows`](options.md#what-a-file-holds) turns on, all off by default: 🎼 `seven_day_opus`, 🎭 `seven_day_sonnet`, 🍳 `seven_day_omelette`, 🔌 `seven_day_oauth_apps` and 🤝 `seven_day_cowork`; then four blank columns and 📅 and 🕐, the date and time now.
The windows that reset at the same time are a group, led by one 🔜 and the time until they reset, its windows one blank apart in the order above, and the groups two blanks apart, the soonest reset first, so the first 🔜 comes right after 💳: `💳 🔜 6.7m 🔋 15٪  🔜 1.9d 🪫 87٪ 🦊 4٪ 🎼 30٪  🔜 3.9d 🎭 56٪`.
A hidden window leaves its group, and a group with no window left leaves its 🔜: with 🔋 hidden, `💳 🔜 1.9d 🪫 87٪ 🦊 4٪`.
A window the source does not give is not drawn.
A reading 10 minutes old or more has each share followed by 🧊 and its age, `🔜 1.9d 🪫 87٪ 🧊3h`, in the text rather than a colour, since [the footer's tail](#the-footers-tail) draws in Claude Code's one style.
It draws nothing in the columns: its figures are the plan's own, read from the configured [usage source](usage-sources.md), and can include use from other machines, the web and the phone.
Both shares take three digits, so 🪫 reads `87٪` as 🔋 does, and so does each window after it.
Too wide for its row, it sheds 🎨, then 🔀, then 📁, then 📅, then 🕐, then the windows' 🔜, and only then is cut with `…`; the windows themselves are never shed.

No row takes a press: each is plain text, above the prompt, under the footer line and in the receipt.

While a survey (a question picker) holds the band, the mod draws nothing above the prompt, and Claude Code draws the picker there: the tree is gone until it is answered, and the receipt, stamped at the turn's end, is not touched.
The rows under the footer line are drawn wherever Claude Code draws its footer line.
Each change of the band's widths or of a survey goes to the mod's log, `band: {"bodyColumns":…,"viewportColumns":…,"isFullscreen":…,"hasSurvey":…}`, and the footer's own log line ends with the same `isFullscreen` and whether a survey held the band when it was drawn.

### The tree

Above the prompt the rows are a tree of the session's threads: 🎮 the root, with the session's name and where it works (📦 🌿 🔀) on its label; under it 🧵 main, the main thread; under 🧵 first 🎤, the turn the main thread is working, then the subagents it started, each under the thread that started it, in the order they started, and after a thread's agents its open background shells and Monitors.
🎤 is a leaf: it folds away with 🧵, and is not a subagent row.
Between turns 🎤 is gone, and 🧵 has a fold mark only while subagents, shells or Monitors hang under it.
The rows under the footer line keep their own order, 🎤 then 🧵, and so does the receipt of a turn that ran no subagent; one that ran any stamps the same tree, its agents without their shells or Monitors ([The receipt](#the-receipt)).
With seven subagents at work (the render above with `--agents corpus/01-mixed --progress "Checking the binary, then the changelog" --cols 200`):

```
  ⊟ 🎮        📦repo 🌿golden-clean                                        💰  35                         🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠶⠄ 🔧⠆⠀ 🚦⠄⠀  🔋 3.8٪   🪫 8.45٪
  ╰⊟ 🧵    🟢 main  Checking the binary, then the chang…  🧬O⁵🐇  🤖   3m  💰  35           🧠 115k  11٪  🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋 3.8٪   🪫 8.45٪
     ├─ 🎤 🟢 turn  Why does the elapsed row report two…  🧬O⁵🐇  🛫 200   💰 6.4           🧠 -42k  -4٪  🧩 ▴525k ▾151k  🎯98٪  ⌛  8m         🤖⠶⠆ 🔧⠆⠀ 🚦⠀⠀  🔋 1.2٪   🪫 1.56٪
     ├─ 🎩 🟢 Clover                                      🧬O⁵🐇  🤖  13m  💰 0.0           🧠  32k  16٪  🧩 ▴7.1k ▾400   🎯93٪  ⌛ 15m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
     ├─ 🔍 🟢 Marigold  Running the suite                 🧬O⁵🐇  🔧  11m  💰 0.1           🧠  32k  16٪  🧩 ▴ 14k ▾800   🎯93٪  ⌛ 12m ⛳ +50s 🤖⠄⠀ 🔧⠶⠦ 🚦⠀⠀  🔋  .02٪  🪫  .022٪  💾 +  9  -  4
     ├─ 🤖 🟢 Willow                                      🧬H⁴    🤖 8.3m  💰 0.0           🧠  10    0٪  🧩 ▴ 10  ▾ 10   🎯 0٪  ⌛ 10m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .00٪  🪫  .000٪
     ├─ 🔩 🟢 Bluebell                                    🧬So🐌  🤖 333   💰 0.1           🧠  60k  30٪  🧩 ▴ 13k ▾1.3k  🎯97٪  ⌛6.7m         🤖⠶⠦ 🔧⠄⠀ 🚦⠀⠀  🔋  .01٪  🪫  .016٪
     ├─ 📐 🟢 Thistle                                     🧬O⁵🐇  🚦 4.7m  💰 0.0           🧠  32k  16٪  🧩 ▴7.1k ▾400   🎯93٪  ⌛  5m         🤖⠄⠀ 🔧⠀⠀ 🚦⠶⠦  🔋  .01٪  🪫  .011٪
     ├─ 🐚 🟢 sleep 300 && make test                                                                                             ⌛  2m
     ╰─ 🤖 🟡 Quince                                      🧬O⁵🐇  🥚  30s
```

- **The lines.** `├─` and `╰─` join a row to its parent, `│` carries a parent's line past its children, three columns a level.
  The lines are the start of each row's label, so every figure keeps its column at every depth.
  The labels start at the left, as every row's do.
- **The columns.** Only the lines and each row's kind glyph (🎮 🧵 🎤 🎩 🔍 💻 📡 …) move with its depth.
  Every state circle stands in one column, a blank past the deepest kind glyph drawn, and every name three columns after it, so the names, the text after them and every figure line up on every row.
  The column moves when a deeper row appears or goes.
  On 🎮 the session's name stands there, then 📦 🌿 🔀, and with no name 📦 does.
  On a narrow terminal the blanks before the circle stay and the name after it is cut with `…`.
- **The fold marks.** A row with children has `⊟` (opened) or `⊞` (folded) in place of its `─`, 🎮's before its label; a click on the mark folds or opens its row.
  A folded agent keeps its own figures and draws 👶🏻 and how many agents are hidden under it, and 💻 📡 how many of its own shells and Monitors; 🧵 folded hides 🎤 with its agents, and counts its own shells and Monitors with 💻 📡.
  Every row starts opened.
- **Every row drawn.** The tree draws every agent, shell and Monitor it holds, however many there are: when they outgrow the screen, scroll the band, or fold a row to hide its subtree.
- **The fold state.** Each row stays as it was left for the rest of the conversation, kept in the mod's `$.state` by key: an agent's id, and fixed keys for 🎮 and 🧵.
  Each change also keeps the folds in the mod's store under the session's id, so a restart, a `--resume` or a `--continue` of the conversation draws 🎮 and 🧵, and any agent still drawn, as they were left; an entry not written for 31 days is dropped as a session starts.
  A `/clear` or a forked session starts a new conversation, with every row opened.
  An agent's fold goes once the tree would no longer draw its row, whatever the phase draws, so no later row takes a fold it never had: one paused, one finished within `finished-within` and one over an agent at work keep theirs; 🎮's and 🧵's last the conversation.
- **The clicks.** A click on an agent's label (its kind, name and progress update) switches the transcript to that agent, as Claude Code's tasks list does, and one on 🧵 main's or 🎤 turn's goes back to the main conversation, since the turn is the main thread's.
  A click on a shell's or a Monitor's row shows what the band knows of it as a toast for 8 seconds, one line, its parts parted by ` · `:
  - its glyph and kind;
  - 🟢 running, or ⚫ ended for one that lingers;
  - ⌛ how long it has run, or ran, where its start is known;
  - its call's `description`, left out where it has none and its label is its command's own first line;
  - `$` and its whole `command`, on one line, each line break drawn as `⏎`, cut at 300 characters with `…`;
  - ⤷ the file its output is written to, where a record has named one: a shell's call's result names it, and a Monitor's notifications do, from its first event on.
    Under the home folder it starts with `~`, and one longer than 80 characters keeps its first two folders, `…` and its file name.

  As in `💻 shell · 🟢 running · ⌛ 6.2m · Run the plugin tests · $ npm test -- --watch · ⤷ /private/tmp/…/b3qupkikw.output`.
  Claude Code offers mods no way to open one task's own view.
  🎮 has no label click, and the session's name takes none.
  On 🎮's label 📦 the project, 🌿 the branch and 🔀 the pull request link to them on GitHub, when the `origin` remote is on GitHub; otherwise they are plain text.
  The clickable parts are drawn as before, with no hotkeys and no brackets, so no figure moves.
  The receipt's rows take no click.
- **The labels.** 🧵 and 🎤 draw their state's circle (🟢 working, 🟡 waiting, ⚫ between turns) and their name, and an agent its [subagent row's](#the-subagent-rows) head and name, with only its own counts between the circle and the name and no blank slots for the counts other rows have.
  A thread's latest text follows its name, dim, cut with `…` where the label ends: the first line of the last text the thread wrote, an ETA report left out, so a progress update while it works and its final answer once it has ended.
  The hide path `chat.progress` hides it.
  🎤's name is followed the same way by the prompt typed last, hidden by `chat.prompt`.
- **Waiting agents.** An agent that has ended its turn to wait on its own shell or Monitor, or that Claude Code otherwise holds, is `waiting` in `$.agent.list()` and ◯ waiting in Claude Code's panel.
  Its row is 🟡 paused, not 🟢: its 🛫 column is what it waits on, 💻 a shell, 📡 a Monitor, 💤 an agent under it, or 📋 for anything else, and how long since its last record ([State](#state)), not a work clock.
  It is live: it keeps its row and its progress update, and never goes while it waits.
- **Shells and Monitors.** Each background shell (a Bash call run in the background, or moved there past its timeout) and each Monitor that a thread started and has not heard the end of is a leaf under that thread: under 🧵 for the main thread's, under the agent for an agent's, after its agents, in the order they opened.
  Its label is 💻 for a shell or 📡 for a Monitor, 🟢, then the call's `description`, else the first line of its `command`, else `shell` or `monitor`; its one figure is ⌛, how long it has run.
  It does not fold; a click on it shows it as a toast, with its whole command and its output file (see the clicks above), which the folds keep with its label.
  Once the thread hears its end ([State](#state)) it stays where it stood, ⚫ with its ⌛ stopped at how long it ran, for `finished-within` seconds after the record that closed it (120 as the mod ships), and then leaves.
  An opened thread leaves its 💻 📡 counts to these rows; a folded one hides them and counts them.
  With the panel inputs' `corpus/02-parked`, whose Pine waits on a shell and Poppy on a Monitor and a shell, and a shell and a Monitor of the main thread's, at 120 columns (`--agents corpus/02-parked --background` and the progress above, `--cols 120`):

  ```
  ⊟ 🎮           📦repo 🌿golden-clean…  💰  35                 🧩 ▴2.7M ▾841k  ⌛9.3h          🔋 3.8٪   🪫 8.45٪
  ╰⊟ 🧵       🟢 main  Checkin…  🧬O⁵🐇  💰  35   🧠 115k  11٪  🧩 ▴2.7M ▾841k  ⌛9.3h          🔋 3.8٪   🪫 8.45٪
     ├─ 🎤    🟢 turn  Why doe…  🧬O⁵🐇  💰 6.4   🧠 -42k  -4٪  🧩 ▴525k ▾151k  ⌛  8m          🔋 1.2٪   🪫 1.56٪
     ├⊟ 🎩    🟡 Parsley         🧬O⁵🐇  💰 0.1   🧠  32k  16٪  🧩 ▴ 14k ▾800   ⌛ 20m ⛳  29m  🔋  .02٪  🪫  .022٪
     │  ╰─ 🔍 🟢 Chive           🧬O⁵🐇  💰 0.0   🧠  32k  16٪  🧩 ▴7.1k ▾400   ⌛ 20m ⛳  29m  🔋  .01٪  🪫  .011٪
     ├⊟ 🔩    🟡 Pine            🧬O⁵🐇  💰 0.1   🧠  32k  16٪  🧩 ▴ 14k ▾800   ⌛ 17m          🔋  .02٪  🪫  .022٪
     │  ╰─ 💻 🟢 Build the docs site                                            ⌛2.1m
     ├⊟ 🔩    🟡 Poppy           🧬O⁵🐇  💰 0.1   🧠  32k  16٪  🧩 ▴ 21k ▾1.2k  ⌛ 17m          🔋  .02٪  🪫  .033٪
     │  ├─ 📡 🟢 Watch the CI checks                                            ⌛2.1m
     │  ╰─ 💻 🟢 Build the docs site                                            ⌛2.1m
     ├─ 🔍    🟢 Sage            🧬O⁵🐇  💰 0.1   🧠  32k  16٪  🧩 ▴ 14k ▾800   ⌛ 15m ⛳  +8m  🔋  .02٪  🪫  .022٪
     ├─ 🔍    🟢 Sorrel          🧬O⁵🐇  💰 0.1   🧠  32k  16٪  🧩 ▴ 14k ▾800   ⌛ 15m ⛳  +5m  🔋  .02٪  🪫  .022٪
     ├─ 📐    🟡 Peony           🧬O⁵🐇  💰 0.0   🧠  32k  16٪  🧩 ▴7.1k ▾400   ⌛ 10m ⛳  15m  🔋  .01٪  🪫  .011٪
     ├─ 💻    🟢 Run the plugin tests                                           ⌛6.2m
     ╰─ 📡    🟢 Watch PR #38 for comments                                      ⌛ 25m
  ```
- **Finished agents.** A subagent that ends keeps its own row where it stood, ⚫ and its figures as they ended, for `finished-within` seconds after its last record (120 as the mod ships), and its parents stay drawn with it; then it goes, and the turn's receipt holds it.

The subagents' `live` in `rows` picks when they are drawn: `"running"` while a turn runs, `"always"` between turns too, `"never"` not at all; the mod ships `"always"`.
Between turns the running and paused subagents are drawn, and the ones that ended for `finished-within` seconds: the turn's receipt holds the ones that ended ([Between turns](#between-turns)).
Their `place` is always `"above"`.
With 🎮 placed under the footer line the tree has no root, and 🧵 is its top row, with 🎤 under it; with 🧵 placed there, 🎤 and then the subagents hang from 🎮, and with both placed there, 🎤 and the subagents stand at the top.

### The grid

Every row of the mod's rows, the receipt and the subagent rows draws the same columns, in this order:

```
model  🛫  💰  💸  🧠  🧩 ▴ ▾  🎯  ⌛ ⛳ 🤖 🔧 🚦  🔋  🪫  💾
```

A row with nothing for a column leaves it blank, so the columns hold.
A row's label runs on over its own row's leading blank columns, up to its first figure; labels therefore end at different points on different rows, and the figures never move.
Which columns there are follows from the terminal's width and the `--hide` setting alone, laid out over every row any of the three can draw, agent rows two levels deep included, so no column moves when the turn ends, a figure goes missing or an agent starts.

### Column by column

Not every scope fills every column: the model and 🛫 are a thread's state, so only the 🎤 and 🧵 rows and the agent rows draw them, and the session has no context and no ⛳ of its own.

- **model**, `🧬O⁵🐇`: the model as its family initial and superscript major version (`O⁵` Opus 5, `S⁵` Sonnet 5, `H⁴` Haiku 4.5), then the reasoning effort as a glyph: 🐌 low, 🐢 medium, 🐇 high, 🏃 xhigh, 🚀 max.
  The turn's, on the 🎤 row.
- **🛫**, `🛫 200`: the main thread's token rate, how fast 🧩's total is climbing, worked out by the mod from one reading to the next.
  It jumps by a request's whole prompt at each request, so it measures pace, not generation speed.
  While a tool runs the column says that instead, `🔧 42s`, since the oldest call still running.
  On the 🧵 row, while the turn runs, it says what the main thread is doing and for how long, the same states as an [agent row's](#state): 🤖 the model has the floor, amber once it has written nothing for ten minutes; 🚦 waiting on a question to you or a foreground agent.
  The unit of a time sits where a rate's blank does, so the figures stack.
- **💰**, `💰 35`: dollars at API prices, each request priced at its own model's rates.
  The 🧵 row's includes its compactions, priced from an estimate of each summary, and is marked `~` when it has any.
- **The credit paying**, `💸2.1`: which of the account's credits pays for the row's work, by its glyph, and what it has paid, in 💰's dollars.
  Blank while the plan pays, which 🔋 and 🪫 already show.
  A Claude Code on the web session is paid for by ⛅ the cloud session credit; an API key (`ANTHROPIC_API_KEY`) by 🎁 a promotional credit while one has a balance, then 💵 the prepaid balance; a plan login, once a window is at 100% and extra usage is on, by 💸 extra usage.
  Each row bills its own records from the moment that credit began paying, so a turn that crossed into it shows the part after the crossing; extra usage, and the prepaid balance after a promotional credit, are counted from the first reading that found them paying, a start the mod keeps through a `/reload-plugins`, a restart and a `--resume`, for 31 days after it last changed.
  The 🎤, 🧵, 🎮 and agent rows draw it; the 🎮 row draws the fall in the credit's balance instead once a reading from before the session began and a later one bracket it.
  The mod alone draws it, and only for the pool paying now.
- **🧠**: on the 🧵 row, `🧠115k  11٪`, the main thread's context size and its share of the model's window; agents are left out, since this is the number that decides when *this* window needs compacting.
  On the 🎤 row, `🧠-42k  -4٪`, how much the context grew in the turn, in tokens and in points of the window, signed: a compaction shrinks it.
  A size read from an estimate is marked `~`.
- **🧩**, `🧩▴2.7M ▾841k`: tokens in and out.
  ▴ is billable-equivalent input — fresh input, plus cache writes at 2× and cache reads at 0.1× — and ▾ is output.
- **🎯**, `🎯98٪`: prompt-cache hit rate, cache reads as a share of all input.
- **⌛**: how long the scope has run.
  The turn's, from the prompt that opened it, through any prompt typed and handed over mid-turn, which opens no turn of its own (see [Turns](accounting.md#turns)): up to now while it runs, so it counts on through a tool call that writes no record until it ends; between turns and on the receipt, up to its last record, or the transcript's own duration for it once that is written.
  The main thread's, from its first record; the session's, from its earliest turn, so the receipt's 🎮 reads the same start.
- **⛳**: the time the thread says it has left (see [ETA](#eta)).
  On the 🎤 row, the turn's own last report; on the 🧵 row, the main thread's, pushed out to the latest finish of any agent still answering.
- **🤖 🔧 🚦**, `🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄`: how the time split, as gauges with eight dots between the three: 🤖 with the model, 🔧 inside tools, 🚦 waiting, on a question to you, an agent, or between turns.
  `AskUserQuestion`, `ExitPlanMode` and `Agent` calls count as 🚦, since their duration is a person reading or an agent working; a permission prompt does not, since nothing in the transcript marks one.
  The main thread's split is its own, read by the same rule as each agent's (see [time](accounting.md#time)).
  The 🎤 and 🎮 rows sum agent-seconds, which can outrun the wall clock, so their gauges are proportions of themselves and need not add up to ⌛.
- **🔋** and **🪫**, `🔋 3.8٪   🪫 8.45٪`: the scope's share of the 5-hour and the weekly window.
  These are estimates: the program prices the requests and divides by a calibrated dollars-per-percent figure (see [Accounting](accounting.md)).
  `?` means no calibration exists yet; with no plan reading at all the cells are blank.
  🪫 takes one decimal more.
  Each holds its point in one column, two integer columns before it and room for every decimal after, so rows stack units over units: `🔋  .38٪`, `🔋 1.2٪ `, `🔋12٪   `, and `🪫  .380٪`, `🪫 1.23٪ `, `🪫12.3٪  `.
  A whole figure puts its ٪ in the point's column, and so does a full window, `🔋💯٪   `; a `?` stands in the units column.
- **💾**, `💾 +3.4k - 214`: lines added and removed by the scope's own edits and writes.
  Blank where none were: none changed, or none counted.

### Labels

Every label is drawn from the left, and each row draws the same label wherever it is: in [the tree](#the-tree) and on [the receipt](#the-receipt) after the tree's lines, and under the footer line with none, each row standing alone.

- **🎤**, the turn: its mark, its circle, `turn` and the prompt typed last.
  On the receipt its circle is 🏁.
  The turn tags tie it to the prompt (🔻🔖) and the receipt (🔺🔖).
- **🧵**, the main thread: its mark, its circle, `main` and the first line of the last text it wrote.
  While messages wait for its next turn (typed while it works, an agent's SendMessage, a task notification), 📨 and how many after its circle, `🧵 🟢 📨3 main`, as an agent row's [📨](#inbox) counts its own.
  The receipt's 🧵 row leaves the 📨 out.
- **🎮**, the session: its mark, and in the names' column the session's name, then, above the prompt, 📦 🌿 🔀, which the 💳 row keeps elsewhere.
  The name is the one /rename gives the session, read off the main transcript: its latest `custom-title` record, else its latest `agent-name`.
  It is drawn in the session's colour, its latest `agent-color` (/color), as the palette's nearest colour, and cream (`F_CRM`) with none (or `default`); with no name 📦 stands in its place.
  A later record wins, so a /rename shows on the next read.

  | Claude Code's colour | Drawn in |
  |---|---|
  | `red` | `F_RED` |
  | `blue` | `F_BLU` |
  | `green` | `F_GRN` |
  | `yellow` | `F_YEL` |
  | `purple` | `F_PUR` |
  | `orange` | `F_AMB` |
  | `pink` | `F_PNK` |
  | `cyan` | `F_CYN` |
  | none, `default` or another | `F_CRM` |

- **💳** carries where the session works: 📦 the project (in a linked git worktree, the main repository, since 🌿 already names the worktree's branch), 🌿 the branch, 📁 the current directory, 🔀 the branch's pull request and 🎨 the output style, when not the default.
  A dirty working tree turns 🌿 into 🍂 and adds `✱`.
  📁 draws the whole path, the project's own folder in 📦's colour, so in `📁~/git/repo/mod` the `repo` stands out as the project.
  Its windows and clock are in [The rows](#the-rows).

A label keeps at least 12 columns before columns drop: an agent row's head on the [subagent rows](#the-subagent-rows) and the first letters of its name.
It sheds its ranked parts whole before anything is cut, least important first: 🎨, then 🔀, then 📁 on a label that has them, then the session's name on 🎮's; 📦 and 🌿 are only ever cut.
A part leaves whole rather than showing as `📁~/sr…`.
What is left is cut with `…`.
Which columns drop on a narrow terminal is worked out without a label's spill, so a long agent name never changes the grid.

### Fixed widths

Every value is formatted to a fixed number of columns and every cell reserves its width whether or not it has content.
A number therefore stays in the same place from the first prompt to the thousandth, and right-aligned rows put each metric on the same screen column in every terminal tab.

To stay fixed as values grow, figures carry a unit instead of more digits: `1.2k`, `4.5M`, `1.5h`, `2.4d`.
Money follows the same ladder: `29.8`, `123`, `1.2k`.

Percentages use the Arabic percent sign `٪` (U+066A) because it is reliably one column wide; see [Glyphs and terminals](glyphs-and-terminals.md).
Plan shares take three characters at every magnitude — `5.4`, `.38`, `12` — and `--subscript-decimals` draws sub-1 readings with subscript digits instead (`0₀₁٪`).
The `iterm` and `tmux` terminal profiles pad 🧩, 🧠 and 💰 one column wider, `💰 35` where the renders here read `💰35`; every row on the screen is drawn in the same profile, so they still stack.

### Narrow terminals

Past a label's 12 columns, whole columns drop, from every row at once, so the grid never breaks.
Least important first:

```
💸  🛫  💾  🎯  🤖 🔧 🚦  model  🧩  ⛳  ⌛  🧠  🪫  🔋  💰
```

At 100 columns, the rows above the prompt, then the footer line and the rows under it, with the prompt between them left out (`--part above`, then `--part footer`, each with `--cols 100 --inset 2 --right-edge 5`):

```
  ⊟ 🎮        📦re…  💰  35                 🧩 ▴2.7M ▾841k  ⌛9.3h          🔋 3.8٪   🪫 8.45٪
  ╰⊟ 🧵    🟢 main   💰  35   🧠 115k  11٪  🧩 ▴2.7M ▾841k  ⌛9.3h          🔋 3.8٪   🪫 8.45٪
     ╰─ 🎤 🟢 turn…  💰 6.4   🧠 -42k  -4٪  🧩 ▴525k ▾151k  ⌛  8m          🔋 1.2٪   🪫 1.56٪
  -- INSERT -- ⏵⏵ auto mode on (shift+tab to cycle)
                              💳 🔜 6.7m 🔋  15٪  🔜 1.9d 🪫  87٪    📅 2026-08-16  🕐 02:23:20
```

At 80:

```
  ⊟ 🎮        📦repo …   💰  35                 ⌛9.3h  🔋 3.8٪   🪫 8.45٪
  ╰⊟ 🧵    🟢 main       💰  35   🧠 115k  11٪  ⌛9.3h  🔋 3.8٪   🪫 8.45٪
     ╰─ 🎤 🟢 turn  Wh…  💰 6.4   🧠 -42k  -4٪  ⌛  8m  🔋 1.2٪   🪫 1.56٪
  -- INSERT -- ⏵⏵ auto mode on (shift+tab to cycle)
          💳 🔜 6.7m 🔋  15٪  🔜 1.9d 🪫  87٪    📅 2026-08-16  🕐 02:23:20
```

The 💳 row sheds its pieces to fit, as [The rows](#the-rows) says: 📁 at 100 columns.
The tree's lines are part of a label, so a deep row's name is cut first on a narrow terminal.

### Between turns

Once a turn ends and its receipt is stamped, 🎤 leaves the band, and its frozen copy is the receipt just above; with no subagent running, the band is 🎮 and 🧵, with Claude Code's `[-]` on 🎮's row, 🧵 ⚫ with the model its next turn runs on and no 🛫, and 💳 stays under the footer line (`--phase done`, above the prompt and under the footer line):

```
  ⊟ 🎮     📦repo 🌿golden-clean           💰  35                 🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠶⠄ 🔧⠆⠀ 🚦⠄⠀  🔋 3.8٪   🪫 8.45٪
  ╰─ 🧵 ⚫ main           🧬O⁵🐇           💰  35   🧠 115k  11٪  🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋 3.8٪   🪫 8.45٪
  -- INSERT -- ⏵⏵ auto mode on (shift+tab to cycle)
  📁~/src/statusline-fixture/deep/tree                                                    💳 🔜 6.7m 🔋  15٪  🔜 1.9d 🪫  87٪    📅 2026-08-16  🕐 02:23:20
```

Background subagents keep running, and spending, after the turn that started them ends, so they stay in the tree under 🧵, each with its 🟢 or 🟡, every one drawn as while a turn runs.
The ones that ended stay for `finished-within` seconds, ⚫, and then are left to the turn's receipt.
With subagents running between turns (`--phase done --agents corpus/01-mixed`, above the prompt):

```
  ⊟ 🎮        📦repo 🌿golden-clean                                        💰  35                         🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠶⠄ 🔧⠆⠀ 🚦⠄⠀  🔋 3.8٪   🪫 8.45٪
  ╰⊟ 🧵    ⚫ main                                        🧬O⁵🐇           💰  35           🧠 115k  11٪  🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋 3.8٪   🪫 8.45٪
     ├─ 🎩 🟢 Clover                                      🧬O⁵🐇  🤖  13m  💰 0.0           🧠  32k  16٪  🧩 ▴7.1k ▾400   🎯93٪  ⌛ 15m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
     ├─ 🔍 🟢 Marigold  Running the suite                 🧬O⁵🐇  🔧  11m  💰 0.1           🧠  32k  16٪  🧩 ▴ 14k ▾800   🎯93٪  ⌛ 12m ⛳ +50s 🤖⠄⠀ 🔧⠶⠦ 🚦⠀⠀  🔋  .02٪  🪫  .022٪  💾 +  9  -  4
     ├─ 🤖 🟢 Willow                                      🧬H⁴    🤖 8.3m  💰 0.0           🧠  10    0٪  🧩 ▴ 10  ▾ 10   🎯 0٪  ⌛ 10m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .00٪  🪫  .000٪
     ├─ 🔩 🟢 Bluebell                                    🧬So🐌  🤖 333   💰 0.1           🧠  60k  30٪  🧩 ▴ 13k ▾1.3k  🎯97٪  ⌛6.7m         🤖⠶⠦ 🔧⠄⠀ 🚦⠀⠀  🔋  .01٪  🪫  .016٪
     ├─ 📐 🟢 Thistle                                     🧬O⁵🐇  🚦 4.7m  💰 0.0           🧠  32k  16٪  🧩 ▴7.1k ▾400   🎯93٪  ⌛  5m         🤖⠄⠀ 🔧⠀⠀ 🚦⠶⠦  🔋  .01٪  🪫  .011٪
     ├─ 🐚 🟢 sleep 300 && make test                                                                                             ⌛  2m
     ╰─ 🤖 🟡 Quince                                      🧬O⁵🐇  🥚  30s
```

🎤 stays a second after the stamp lands (`CONFIG.receiptHoldMs`), so the turn's figures are never off screen.
The option `rows` sets, for each row, whether it is drawn while a turn runs (`live` `"running"`), always (`"always"`) or never (`"never"`), and whether the receipt stamps it (`transcript`), apart; as the mod ships, 🎤 is drawn while a turn runs and stamped, 🧵, 🎮 and 💳 are always drawn and not stamped, and the subagents are always drawn, between turns only those running or paused, and always stamped, every one the turn ran that had finished, with 🧵 over them.
`"rows": {"subagents": {"live": "running"}}` draws no subagent between turns.
`"rows": {"session": {"live": "running"}}` leaves the band empty between turns.

The rows are read again every 5 seconds while a turn runs, never more often than three times as long as the last read took, and every 30 seconds otherwise; their clocks (🔧 ⌛ ⛳ 🕐 🔜) move each second between reads.

### Hiding

`--hide scope[.group[.metric]]`, repeatable, with `*` for any one part.
One path means the same on the mod's rows, the receipt and the subagent rows, which take the paths in the option `hide`, from the [configuration files](options.md#configuration-files).

| Part | Values |
|---|---|
| scope | `account`, `turn`, `main` (the 🧵 row), `session`, `agent`, and `tag` for the turn tag lines' 🔋 and 🪫 (`tag.plan.five_hour`, `tag.plan.week`; [The turn tags](#the-turn-tags)) |
| group | `plan` (🔋 🪫 🔜, and on the 💳 row 🦊 `fable`, 🎼 `opus`, 🎭 `sonnet`, 🍳 `omelette`, 🔌 `oauth_apps` and 🤝 `cowork`), `cost` (💰, and `spend`, the credit paying for it after it), `tokens` (🧩 🎯), `context` (🧠), `time` (⌛ ⛳ 🤖 🔧 🚦), `work` (💾), `state` (model, 🛫; on agent rows also `kids`, `compact`, `shells`, `monitors`, `inbox`: 👶🏻 🤏 💻 📡 📨; on the 🧵 row `inbox`), `chat` (`doing`, on agent rows; `progress`, the latest text in the tree, on 🧵 and agent rows; `prompt`, the prompt typed last, on the tree's 🎤 row), `workspace` (📦 🌿 📁 🔀 🎨, and `name`, 🎮's session name), `clock` (📅 🕐), `name` (`label`, `kind`, `tag`: the row's name, an agent's kind, the turn's tag lines) |

```
--hide account                  the 💳 row
--hide '*.work'                 💾 on every row
--hide turn.time.eta            ⛳ on the 🎤 row only
--hide account.workspace        📦 🌿 📁 🔀 🎨 on the 💳 row
--hide account.plan.fable       🦊 on the 💳 row, and its 🔜 where no window shares it
--hide account.plan.opus        🎼 likewise, where weekly-windows turns it on
--hide session.workspace.name   the session's name on 🎮
--hide '*.state.rate'           🛫 everywhere
--hide '*.chat.progress'        every thread's latest text in the tree
--hide tag.plan                 🔋 🪫 and 💳 on the turn tag lines
```

A column hidden on every row it could show on is removed, and the others close up; hidden on some rows, it is left blank there.

Hiding 🔋 (`*.plan.five_hour`), 🧠's share of the window (`*.context.share`) and 🎯 (`*.tokens.cache`), above the prompt and under the footer line:

```
  ⊟ 🎮        📦repo 🌿golden-clean                      💰  35                    🧩 ▴2.7M ▾841k  ⌛9.3h         🤖⠶⠄ 🔧⠆⠀ 🚦⠄⠀  🪫 8.45٪
  ╰⊟ 🧵    🟢 main                      🧬O⁵🐇  🤖   3m  💰  35           🧠 115k  🧩 ▴2.7M ▾841k  ⌛9.3h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🪫 8.45٪
     ╰─ 🎤 🟢 turn  Why does the elap…  🧬O⁵🐇  🛫 200   💰 6.4           🧠- 42k  🧩 ▴525k ▾151k  ⌛  8m         🤖⠶⠆ 🔧⠆⠀ 🚦⠀⠀  🪫 1.56٪
  -- INSERT -- ⏵⏵ auto mode on (shift+tab to cycle)
  📁~/src/statusline-fixture/deep/tree                                                                     💳 🔜 1.9d 🪫  87٪    📅 2026-08-16  🕐 02:23:20
```

## The receipt

As a turn ends, the mod stamps its receipt as the turn's closing line, in place of Claude Code's `✻ <word> for <duration>`: the rows whose `transcript` is set in `rows`, as they stood when it ended, frozen and dim, in their colours, then the turn's tag.
Every receipt has one shape: its rows as the band's tree draws them, each with its tree label (see [Labels](#labels)), 🎤's being `🎤 🏁 turn` and the first words of the prompt the turn answered.
As the mod ships that is 🎤 alone, since 🧵 and 🎮 stay live on screen.
At 160 columns, from a cost document (`usage-dev figures tests/fixtures/figures/cost/10-turn-id.json --cols 160 --part receipt --inset 2 --right-edge 5 --plain`):

```
  🎤 🏁 turn  And this one?                💰 0.2   🧠 +21k +10٪  🧩 ▴ 18k ▾3.5k  🎯97٪  ⌛  3m         🤖⠶⠄ 🔧⠦⠀ 🚦⠀⠀  🔋  .03٪  🪫  .043٪

🔺🔖 8f37748e #12  💳 🔋  41٪  🪫  63٪  📅 2026-08-16  🕐 02:23:20
```

With `"rows": {"agent": {"transcript": true}, "session": {"transcript": true}}` it stamps 🧵 and 🎮 too, as the tree above the prompt stacks them: 🎮 the root, 🧵 under it and 🎤 under 🧵, 🧵 from a status document (the same with `--rows` set so and `--status tests/fixtures/figures/status/18-agents.json`):

```
  🎮                                       💰 0.2                 🧩 ▴ 27k ▾4.4k  🎯96٪  ⌛1.2h         🤖⠶⠆ 🔧⠆⠀ 🚦⠀⠀  🔋  .04٪  🪫  .059٪
  ╰─ 🧵    ⚫ main        🧬O⁵🐇           💰 0.0   🧠  41k   4٪  🧩 ▴  6k ▾700   🎯97٪  ⌛  1h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋  .01٪  🪫  .012٪
     ╰─ 🎤 🏁 turn  And this one?          💰 0.2   🧠 +21k +10٪  🧩 ▴ 18k ▾3.5k  🎯97٪  ⌛  3m         🤖⠶⠄ 🔧⠦⠀ 🚦⠀⠀  🔋  .03٪  🪫  .043٪

🔺🔖 8f37748e #12  💳 🔋  41٪  🪫  63٪  📅 2026-08-16  🕐 02:23:20
```

No fixture pairs a cost document with a status document of the same session, so here the 🧵 row comes from another one's.

The stamp waits for Claude Code to write the turn's records, which it does after the turn ends, so a reload or restart in that window, such as a `/reload-plugins` queued during the turn, can stop it short.
When the mod loads, it looks at the session's last turn: if the transcript shows it finished (a `turn_duration` record after its prompt) and no receipt is filed for it, the mod stamps it then, with that record's duration, so the turn's closing line draws it.
A turn still running is left to its own end.
The mod's log says `receipt stamped on load` when it does.

A turn that ran subagents stamps them too, as the band's tree draws them: 🧵 the parent, stamped whatever `rows` says of it, under it 🎤 first, then every agent the turn ran that had finished by the time it was stamped, each under the nearest agent above it stamped too, in the order they started.
An agent the turn ran started after the turn opened, or wrote its last record after it; it had finished once it had completed, failed or been killed, with no agent under it still at work.
One still running or paused is owed a row instead: the mod keeps it, and the first receipt stamped after it ends draws it, even when it wrote nothing in that turn, as an agent that ends between turns does.
The receipt's tree is drawn whole: no fold marks and every agent opened.
🏁 marks 🎤 and each agent, and 🧵 keeps its ⚫.
🎤 is followed by the prompt the turn answered, 🧵 and each agent by the first line of the last text it wrote.
With 🎮 stamped, the tree hangs from it; a turn that ran no subagent, or one whose agents are hidden (`--hide agent`), stamps its rows as above, 🧵 among them only where `rows` stamps it.
At 200 columns, the same with `--agents corpus/01-mixed --progress "All four suites pass"` and `--cols 200`: the agents of the case that had ended, with the ones still running owed to a later receipt:

```
  🧵    ⚫ main  All four suites pass                     🧬O⁵🐇           💰 0.0           🧠  41k   4٪  🧩 ▴  6k ▾700   🎯97٪  ⌛  1h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋  .01٪  🪫  .012٪
  ├─ 🎤 🏁 turn  And this one?                                             💰 0.2           🧠 +21k +10٪  🧩 ▴ 18k ▾3.5k  🎯97٪  ⌛  3m         🤖⠶⠄ 🔧⠦⠀ 🚦⠀⠀  🔋  .03٪  🪫  .043٪
  ├─ 🔍 🏁 Daisy                                          🧬O⁵🐇  ✅  42m  💰 0.1           🧠  32k  16٪  🧩 ▴ 14k ▾800   🎯93٪  ⌛8.3m         🤖⠶⠄ 🔧⠦⠀ 🚦⠀⠀  🔋  .02٪  🪫  .022٪
  ├─ 🔩 🏁 Fern                                           🧬O⁵🐇  ❌  32m  💰 0.0           🧠  32k  16٪  🧩 ▴7.1k ▾400   🎯93٪  ⌛1.7m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
  ├─ 🔩 🏁 Kale                                           🧬O⁵🐇  🛑  23m  💰 0.0           🧠  32k  16٪  🧩 ▴7.1k ▾400   🎯93٪  ⌛1.7m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
  ╰─ 🔍 🏁 Elm                                            🧬O⁵🐇  💥  18m  💰 0.0           🧠  32k  16٪  🧩 ▴7.1k ▾400   🎯93٪  ⌛ 50s         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪

🔺🔖 8f37748e #12  💳 🔋  41٪  🪫  63٪  📅 2026-08-16  🕐 02:23:20
```

The mod files a receipt as its drawn lines, the agents' with the rest, so every receipt filed draws as it was stamped, whatever rows it holds.

The rows are laid out at the width the mod's rows last drew at, `hint-inset` columns in and `right-edge` short of the edge, so each column is under theirs, and every turn's receipt stays in the transcript to scroll back to.
A blank row stands above the receipt, one before its tag line and one after it.

- **🎤** is the turn just answered, `🎤 🏁 turn` and its prompt: what it cost, its context's growth, its tokens, how long it ran, the last ETA it reported (kept after the turn ends, to compare with when it did end) and its share of each window.
  The model and 🛫 are not drawn: they were the turn's state.
- **🧵** is the main thread as the mod's 🧵 row last drew it.
- **The subagents** are each agent the turn ran that had finished, as the band's tree last drew it, with 🏁 for its ⚫.
- **🎮** is the session as it stood when the turn ended; it includes every row above it.

Claude Code writes a turn's records to the transcript only after its Stop hooks have run, so the mod waits for them: it reads the transcript every half second until the turn that just ended is billed and two reads agree on it, for up to 30 seconds; a task notification written after it, as a turn of its own, does not hold it back.
Until then the closing line is one blank row.
A turn whose records never land leaves it blank and says why in the mod's log ([mod/README.md](../mod/README.md#its-log)).
Each turn is stamped once.

Some turns end with no closing line, and their receipt is drawn under the turn's answer instead, its last block of text, the same rows in the same place.
Claude Code leaves the line out when it would only repeat the one before it, `Waiting for 1 background agent to finish`:

- the turn ends with background agents or dynamic workflows still at work, as many of each as when the turn before ended;
- no prompt you sent came between the two, so the turn was opened by a task notification, an agent's hand-back or another message the session got;
- the turn had no token budget and /focus hid none of its messages.

The ctrl+o transcript and `--verbose` draw that line after all; it stays blank there, and the receipt stays under the answer.

### The turn tags

The receipt's last line names the turn it bills, and the prompt that opened the turn carries the same tag under it, `🔻🔖`, then the account's limits and when the turn started, dim (`usage-dev figures tests/fixtures/figures/status/18-agents.json --part start --plain`):

```
🔻🔖 p-fork  💳 🔋  15٪  🪫  87٪  📅 2026-08-16  🕐 01:23:20
```

`8f37748e` is the first group of the turn's `promptId`, the UUID on the prompt that opened it and on the turn's user records, so it can be grepped in the transcript; a prompt handed over mid-turn and the records after it carry a `promptId` of their own, and the tag stays the opening prompt's.
`#12` is Claude Code's own turn index.
Each half is drawn only when the transcript records it.
🔻 points down at the turn the prompt opens, 🔺 up at the turn that ended; both lines are at no indent, so they stack, and every turn carries its tag at both ends, even one that is interrupted or still running.

After the tag, 💳 and the account's 🔋 5-hour and 🪫 weekly windows, drawn as the 💳 row draws them, without the 🔜 resets: on `🔻🔖` as the status document read them as the turn started (`limits`), on `🔺🔖` as the cost document read them as the receipt was stamped (`usage.plan`).
Read side by side, the two lines show what the turn took from each window.
A window with no figure is left out, and with neither, so is 💳.

Their hide paths are under the scope `tag`: `tag.plan.five_hour` hides 🔋 on both lines and `tag.plan.week` 🪫, and `*.plan.five_hour` hides 🔋 here as on every row.
The start line takes the paths as they stand when the turn starts, the receipt's when it is stamped.
The start line again, with `--hide '*.plan.five_hour'` added:

```
🔻🔖 p-fork  💳 🪫  87٪  📅 2026-08-16  🕐 01:23:20
```

`--hide name.tag` hides both lines, with the blank rows around the receipt's.

## The subagent rows

One row per task the session runs: an Agent tool call, a fork, a background shell, a workflow agent, a teammate.
At 160 columns with a right edge of 5, a running agent in each state, finished ones, one not yet started, a shell and a teammate (the `corpus/01-mixed` case of `tests/fixtures/panel/inputs.json`):

```
🔍🟢 Marigold  Runnin…  🧬O⁵🐇  🔧  11m  💰0.1   🧠 32k  16٪  🧩▴ 14k ▾800   🎯93٪  ⌛ 12m ⛳ +50s 🤖⠄⠀ 🔧⠶⠦ 🚦⠀⠀  🔋  .02٪  🪫  .022٪  💾 +  9  -  4
🔩🟢 Bluebell           🧬So🐌  🤖 333   💰0.1   🧠 60k  30٪  🧩▴ 13k ▾1.3k  🎯97٪  ⌛6.7m         🤖⠶⠦ 🔧⠄⠀ 🚦⠀⠀  🔋  .01٪  🪫  .016٪
📐🟢 Thistle            🧬O⁵🐇  🚦 4.7m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛  5m         🤖⠄⠀ 🔧⠀⠀ 🚦⠶⠦  🔋  .01٪  🪫  .011٪
🎩🟢 Clover             🧬O⁵🐇  🤖  13m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛ 15m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🔍⚫ Daisy               🧬O⁵🐇  ✅  42m  💰0.1   🧠 32k  16٪  🧩▴ 14k ▾800   🎯93٪  ⌛8.3m         🤖⠶⠄ 🔧⠦⠀ 🚦⠀⠀  🔋  .02٪  🪫  .022٪
🔩⚫ Fern                🧬O⁵🐇  ❌  32m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛1.7m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🔩⚫ Kale                🧬O⁵🐇  🛑  23m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛1.7m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🔍⚫ Elm                 🧬O⁵🐇  💥  18m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛ 50s         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🤖🟡 Quince              🧬O⁵🐇  🥚  30s
🐚🟢 sleep 300 && make test                                                          ⌛  2m
🤖🟢 Willow             🧬H⁴    🤖 8.3m  💰0.0   🧠 10    0٪  🧩▴ 10  ▾ 10   🎯 0٪  ⌛ 10m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .00٪  🪫  .000٪
```

Each row is laid out for the terminal's width and keeps room at its left for a tree's chrome, `  ◯ ` at the top level, four columns, and two more for each level an agent started by another agent sits below it; the row counts the chrome toward its width and does not print it.
It ends as many columns short of the edge as `right-edge` says, which unset follows `rows.*.place` from the configuration files, as the mod's rows do: 5 when any row the mod draws live is above the prompt, as under the defaults, else 2.
The columns follow from the width and `hide` alone; on a narrow terminal whole columns drop from every row at once, 🛫 first and 💰 last, and at an unknown width every column is drawn and the label keeps 12 columns.

### Subagent cells

The label, left to right:

| Cell | Meaning |
|---|---|
| kind | the agent type, as a glyph (the [README legend](../README.md#agent-kind)) |
| state | the phase: 🟢 running, 🟡 paused or ⚫ not running. See [State](#state) |
| 👶🏻 | how many rows hang directly under it, finished or not |
| 🤏 | how often its window has been compacted |
| 💻 | how many background shells it started and has not heard the end of, while it runs or is paused; not once it has failed or been killed. In the tree, only on a folded row: an opened one draws each shell as a row under it |
| 📡 | the same for its Monitors; one that ran out its timeout has ended, as its last notification says it expired |
| 📨 | messages sent to it with SendMessage and not yet delivered: Claude Code's own "N queued". See [Inbox](#inbox) |
| name | the task's name, or its description; then 🌿 and the branch of a worktree it works in apart from the session's, in full where the label has room; then what it is doing now. A label that only repeats the description is not drawn |

👶🏻, 🤏, 💻, 📡 and 📨 are drawn only while some subagent row needs one, and then on every row, padded to the widest, so the names after them hold their column.
The ones that stay once they come, 👶🏻 and 🤏, sit furthest left, then 💻 and 📡, which last as long as a shell or a Monitor runs, so 📨 coming and going moves the fewest.
On a label too short for them, the activity is cut first, then the branch.
Where some row's name still does not fit beside the counts, a count leaves every row at once, 📨 first and 👶🏻 last, so the names keep one column and the narrowest row keeps its name; only once the counts are gone is a name cut.

The figures are [the grid's columns](#column-by-column), for that one agent, from its own transcript:

| Cell | Meaning |
|---|---|
| model | model and effort |
| 🛫 | what the agent is doing in its phase, and for how long: its state's mark, then the time it has been in that state. 🤖 shows the token rate from the task's own token samples while records keep landing (`🤖 333`), and how long the agent has written nothing once that is a minute, amber from ten. A shell keeps 🛫 and its rate |
| 💰 | cost, each request priced at its own model |
| 🧠 | the agent's context size (its last request's input), and its share of the window the task list gives for its model |
| 🧩 🎯 | tokens in and out, and the cache hit rate |
| ⌛ | the agent's age: from its first record, or its `startTime` if that is earlier, to now, or to its last record once it has finished. A completed agent still parked on its children keeps counting. Not the `startTime` alone, which Claude Code restarts when it resumes an agent |
| ⛳ | the time the agent says it has left. Blank until it reports. See [ETA](#eta) |
| 🤖 🔧 🚦 | each one's share of ⌛: thinking, the agent's working spans off its transcript less its own tool calls; inside its own tools, its children's being on their rows; and waiting, on a question put to you, on an agent it started, or parked until something woke it |
| 🔋 🪫 | the agent's share of each plan window |
| 💾 | lines added and removed by the agent's own edits and writes, over its whole life |

The task list carries each task's name, type, status, start time, model, effort and a running token count; everything else comes from the agent's transcript, `<session>/subagents/agent-<id>.jsonl`, with workflow agents one directory further down.
A task with no transcript (a shell, a remote agent) shows only what the task list gives.

### State

Claude Code's task list gives a task one of five statuses, and `completed` covers two different things: an agent that has finished, and one that ended its turn to wait on work it started, which Claude Code keeps alive until that work ends.
The mod's agent list, `$.agent.list()`, says `waiting` for the second, as Claude Code's own panel draws it ◯ waiting, and the mod passes it on: a waiting agent is paused, never running, whatever its transcript holds.
The mod reads `idle`, a teammate between turns, as `completed`.
The row reads the phase off everything it knows, and puts the circle in the state cell.
What the agent is doing in that phase goes in the 🛫 column, with how long it has been doing it:

- 🤖: since its last record, once it has written nothing for a minute; the token rate before that.
- 🔧 and 🚦: since the oldest call of that kind still waiting on its result.
- 🟡 paused: since its last record, the end of the turn it ended to wait.
- 🥚: since the task's `startTime`.
- ⚫ not running, on an agent: since its last record, how long ago it finished.

| Phase | Mark | When |
|---|---|---|
| 🟢 running | 🤖 | the model has the floor: no tool call is waiting on its result |
| | 🔧 | a tool call is waiting on its result |
| | 🚦 | the call it waits on is a question to you or an agent it started |
| | (none) | a task with no transcript to say, such as a shell |
| 🟡 paused | 💤 | completed or `waiting`, with an agent under it still running or not started |
| | 💻 | completed or `waiting`, with a background shell it has not heard the end of |
| | 📡 | completed or `waiting`, with a Monitor it has not heard the end of |
| | 📋 | `waiting`, on nothing it can name: its plan's approval, or an Agent call whose agent the list does not have |
| | ⛳ | completed, with nothing it can name but a live ETA in its last message |
| | 🥚 | Claude Code's `pending`: not started |
| ⚫ not running | ✅ ❌ 🛑 | completed and waiting on nothing, failed, killed |
| 🟡 or ⚫ | 💥 | completed or failed, and its last answer died on an API error: Claude Code writes one only once its retries are spent, and still calls the agent completed |

A paused agent shows the first of its reasons in that order.
A background task opens on the tool result that hands back its id: `backgroundTaskId` for a Bash, whether run in the background or moved there by its timeout, and `taskId` with `timeoutMs` for a Monitor.
It closes on a `<task-notification>` for that id that carries a `<status>` (a Monitor's events carry none), on TaskStop's result, or on a TaskOutput that reads it finished.
A status never seen is two amber letters and no mark.

### Inbox

A message SendMessage cannot hand over at once waits in the agent's inbox until its next tool round, and Claude Code's own row says `1 queued`.
The task list carries no such count, so 📨 rebuilds it from the two ends.
The sender's transcript — the main thread's or another agent's — gets a result reading `Message queued for delivery to <id> at its next tool round.`
The agent's own file gets the delivery, as a `queued_command` attachment or a `type: user` record, with an `origin` of `coordinator` for the main thread or `peer` for an agent.
The two are matched by time: a send adds one, a delivery takes one away, and the count never drops below zero.
A peer `handback` is a report home and is not counted, and nor is a message typed into the agent's pane, which leaves nothing on the sending side, so 📨 can read lower than Claude Code's count.
A killed or failed agent's inbox is dropped.
Files last written before the earliest agent in the task list started are not read.
Each file's sends and deliveries are saved per session in `claude-inbox-fold-<digest>/` in private state, as `mod/src/state_spec.ts`'s `inbox-fold` row names it, so a tick reads only what each file had appended since the last; a file rewritten in place is read afresh.

### Nesting

At 170 columns, wide enough for every count to keep its place, a parent with two children, one of them with a child of its own, a worktree agent and finished ones, with a right edge of 5:

```
🎩🟢 👶🏻2 🤏2     Trunk          🧬O⁵🐇  🚦  23m  💰0.2   🧠 32k  16٪  🧩▴ 33k ▾2.4k  🎯91٪  ⌛ 33m         🤖⠆⠀ 🔧⠀⠀ 🚦⠶⠆  🔋  .04٪  🪫  .054٪
🔍🟢           📨1 Twig         🧬O⁵🐇  🔧  50s  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛ 23m         🤖⠶⠦ 🔧⠄⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🔩🟢 👶🏻1     📨2 Thorn        🧬O⁵🐇  🚦  22m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛ 23m         🤖⠄⠀ 🔧⠀⠀ 🚦⠶⠦  🔋  .01٪  🪫  .011٪
🔩🟢 👶🏻1         Tendril …  🧬O⁵🐇  🚦  20m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛ 22m         🤖⠄⠀ 🔧⠀⠀ 🚦⠶⠦  🔋  .01٪  🪫  .011٪
🔍🟢               Tip      🧬O⁵🐇  🤖  10s  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛ 20m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🎩⚫               Gourd           🧬O⁵🐇  ✅ 1.1h  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛1.7m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🔍⚫               Garlic          🧬O⁵🐇  ✅ 1.1h  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛2.5m         🤖⠶⠶ 🔧⠀⠀ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
🔍🟢               Moss           🧬O⁵🐇  🔧 6.7m  💰0.0   🧠 32k  16٪  🧩▴7.1k ▾400   🎯93٪  ⌛8.3m         🤖⠆⠀ 🔧⠶⠆ 🚦⠀⠀  🔋  .01٪  🪫  .011٪
```

An agent spawned by another agent is drawn under its parent, its chrome two columns further in for each level.
The row's figures stay on the columns a top-level row's are on: the grid takes the chrome's columns from the label, so a nested row's label is that much shorter.
The columns are kept for two levels of nesting whether any agent runs or not (`CHROME_DEPTH`), so no column moves when a nested agent starts, and a deeper row cuts its own label instead.

The program reads each agent's depth from `spawnDepth` in its `.meta.json` sidecar, and its parent from `parentAgentId`, resolved the way Claude Code's agent panel resolves it:

- An ancestor that has finished and waits on nothing is stepped over.
  The agent panel drops such an agent and hangs its children from its parent.
  Its own test reads state the task list doesn't carry, so the program takes "completed and not paused" for it (see [State](#state)).
  An agent paused on a child still running keeps its children.
- An ancestor missing from the task list ends the walk, and the row is top level.
  The task list holds every agent the agent panel can show.
- A task with no sidecar — a shell, a remote agent — is top level.

A parent's figures are its own transcript only: its children's tool time, cost, tokens and diff are on their rows.
Time it spends waiting on a child is its 🚦.

### ETA

An agent reports how long it has left by writing a line of its own:

```
⛳ skills/coding-agent-usage-line-report-eta: ETA 4m
```

The `coding-agent-usage-line-report-eta` skill, in `skills/` in this repository, tells it when: once it has a plan, after each milestone, and whenever the estimate moves by a quarter or more.
The row reads the last such line from the text of the agent's own messages, so a tool result that quotes one isn't counted.
The skill's path is the part matched; the ⛳ is there so a person scrolling the transcript notices the line, and may be left off.
No other flag opens a report.
The readout draws the time left under the same ⛳.

A report is an estimate of the whole run: the time already gone when it was written, plus the time it said was left.
The row counts it down between reports.
⛳'s figure is what is left of that total.
Past the estimate it turns amber, with a `+` for how late the agent is.
A report of zero is the skill's sign-off, an agent saying it ends now: it reads `0s`, and if the agent keeps going it counts up how late it is at once, in bright red rather than amber: the agent said it was done and is running over, which is louder than an estimate that ran short.
A child whose later finish the row inherits takes that back to amber, since the overrun is then the child's.
The cell is blank only when there is no live estimate: no report yet, or an answer that ended its turn after its last report.
The exception is a report in the message that ends the turn, which stays live, unless it is the `0s` sign-off, which finishes the answer.
That is an agent parking on background work, and Claude Code marks it completed while it waits; the row shows it 🟡 paused.
An agent that has ended (completed with nothing left to wait on, killed or failed) is read at its last record and stops there, as its ⌛ does: an overrun it never signed off stays frozen, in amber, at what it was when the agent ended.
One that ended on its own `0s` sign-off, with no child pushing past it, draws no ⛳ at all, as the main thread's sign-off isn't drawn once the thread is idle.

A report of `ETA ∞` is an agent waiting on something with no time estimate, such as a person.
Its row reads `∞`, neither counted down nor running over, until the next report, and a row waiting on a descendant that reads `∞` reads `∞` too.
A row that has ended (killed, failed, or completed with nothing left to wait on) draws no `∞`: what it waited on no longer holds it.

**Inherited up the tree.** A parent isn't done until the children it is waiting on are, so a row counts to the latest finish among its own estimate and those of its running descendants, recursively.
Its own wins when its own plan runs longer, and a finished child counts for nothing.
Each agent reports its own conceptual ETA for its whole task, including rounds of subagents it plans to start later, which only it knows about.
It doesn't add up its children's reports; the maximum here keeps its row from finishing before any of them.

The 🧵 row in the tree carries the same cell for the main thread, as the root of that tree: its last report in the answer to the current prompt, counted from that prompt, pushed out to the latest finish of any agent still answering.
An agent that has written nothing for half an hour is taken for dead rather than late, unless its last report is `∞` and it has written since the prompt: an agent waiting on a person is silent, and one silent since an earlier prompt may have ended unseen.
A new prompt clears the main thread's own report, and so does the answer ending.
Its late `+` follows the same colour rule as a row's: bright red past the main thread's own `0s` sign-off, amber past an estimate, and amber again when a live agent's later finish is the one it ran past.
The 🎤 row's ⛳ is the turn's own last report alone, and the receipt keeps it after the turn ends.

Saying nothing is not the same as having nothing left, so a row that hasn't reported has no ⛳ at all.
The skill reaches an agent only if it is loaded: `skills: [coding-agent-usage-line-report-eta]` in an agent type's frontmatter preloads it, and a line in `CLAUDE.md` reaches the main session and the general-purpose agents.
The built-in Explore agents don't read `CLAUDE.md`, so they usually report none.

### Blank cells

A task with no transcript — a shell or a remote agent — shows only its name, activity and run time; there is nothing else to measure, and a zero would read as a measurement.
⛳ is blank there too: a task with no transcript has nowhere to write a report.
💾 is blank where no line was added or removed, on every row, so a blank 💾 means none changed or none counted.
🔋 and 🪫 are blank without a plan reading, and `?` without a calibration.

## Messages from agents

Claude Code folds a message another agent sent into one dim row naming its sender, `› Message from @general-purpose (ctrl+o to expand)`: for a subagent with no name of its own that is only its type, so two agents of one type read alike.
The mod draws the row as 📨, the sending agent's task, as its Agent call described it, and the message's first line, cut with `…` to end where the mod's rows end, `right-edge` short of the edge (`messageSpans` in `mod/src/agent_message.ts`, at 100 columns and `right-edge` 5):

```
› 📨 Reclaim the right-edge columns: The right edge is now a setting in both ports, and the …
› 📨 general-purpose: Done.
```

The task is bold at full strength and the rest of the row dim, so the task is what the eye finds; the render above is the text alone.

The sender is known only by name, so its agent is found by that among the session's agents: one whose own name it is, else one whose type it is, the live ones before the rest.
Where that finds several, the message's words pick one: the agent whose last reply, its text or what it sent with a tool, holds the message's first line, whitespace folded on both sides.
Each candidate's conversation is read once per message, and the sender found is kept for the message's later draws, and in the mod's store for its loads after a reload.
An agent that has finished drops out of the session's agents in time, so where they settle nothing the session's `subagents/` folder is read instead: each agent's meta file for its type and task, and the last 256 KiB of its transcript for its last reply.
Where no reply holds it, or more than one does, the row names the sender as Claude Code did, as in the second row: a guess between two agents' tasks would put one agent's words under the other's.
ctrl+o shows the whole message either way, and `agent-message-row` turns the row off.
No figures document holds a message, so the render is drawn from `agent_message.ts` itself, run from `mod/`:

```
node -e 'Promise.all([import("./src/agent_message.ts"), import("./src/formatting.ts"), import("./src/spans.ts")]).then(([m, f, s]) => { for (const [l, t] of [["Reclaim the right-edge columns", "The right edge is now a setting in both ports, and the panel and the band end two columns short.\nMore."], ["general-purpose", "Done."]]) console.log(s.text(m.messageSpans(f.settings({}), l, t, 98))) })'
```

## Colour and brightness

Hue says *what* a figure is; brightness says *whether it is worth looking at*.

**Hue is identity and never changes with the value.**
Each quantity keeps its colour on every row: 🔋 is always green, 🪫 always red and 🦊 always the model's purple, whatever their figures say; on 💳, 🎼 is teal, 🎭 pink, 🍳 mint, 🔌 periwinkle and 🤝 cream.
The one exception is 🎯 (below).

**Brightness is the unit.**
A figure written with a unit takes its shade from that unit, in levels of its own hue, so 841k and 8.4M, or 3h and 3d, do not look alike in the same four columns.
Two tables in `mod/src/spec.ts` and one rule decide it (`grade` in `mod/src/formatting.ts`).

A *scale* lists a kind of figure's units in order of size, smallest first.
Units in one step share a position.
A figure's step is the one that holds its formatted suffix: the letters after its last digit, an empty suffix for a bare count, or the whole figure where it is a word (`now`).
A *falling* scale runs the other way, with its smallest unit the most intense:

| Scale | Units, smallest first | Direction | Where |
|---|---|---|---|
| `duration` | `now` s · m · h · d M | rising | ⌛, ⛳, 🛫's times, and each gauge's own seconds |
| `count` | bare · k · M G | rising | 🧩 ▴ and ▾ each, 🧠's size, 🛫's rate, 💾 each half |
| `countdown` | `now` s m · h · d M | falling | the limit rows' 🔜 time until reset |

The countdown falls because for a time-until it is the small figure that matters.
Its minutes share the seconds' step: inside the hour is the one reading a person acts on.

A *ramp* lists a hue's levels of intensity, faintest first.
Each level names a palette colour and says whether it is drawn faint, so the levels are abstract.
Each colour mode, the true set or the 256 set, resolves the names through its own values.
Adjacent levels that draw the same in a mode collapse into the lower one, so the number of levels a hue has in a mode is worked out, not written down.
Every ramp is the hue faint, the hue, and a lighter shade of the hue:

| Hue | Where | Lighter shade, true | Lighter shade, 256 |
|---|---|---|---|
| green | 🔋's 🔜, 💾's + | `rgb(170, 240, 130)` | `rgb(0, 255, 0)` |
| red | 🪫's 🔜, 💾's − | `rgb(255, 140, 135)` | `rgb(255, 215, 215)` |
| teal | 🧩 ▴ | `rgb(170, 240, 255)` | `rgb(215, 255, 255)` |
| mint | 🛫's rate | `rgb(160, 255, 220)` | `rgb(0, 255, 215)` |
| pink | 🧩 ▾ | `rgb(250, 185, 235)` | `rgb(255, 215, 255)`, ⛳'s own |
| pink | 🧠's size | `rgb(255, 170, 225)` | `rgb(255, 215, 255)`, ⛳'s own |
| periwinkle | ⌛ and the times | `rgb(185, 190, 255)` | `rgb(215, 215, 255)` |
| magenta | ⛳ | `rgb(255, 140, 255)` | the hue's own, so two levels |

In the 256 set a lighter shade is one of the 80 round-trip entries (see [Under tmux](#under-tmux)) of the same hue.
The pinks' one lighter entry is ⛳'s own colour, which ▾ and 🧠 take as their lighter shade, so ▴ and ▾ shade alike at one unit; ⛳ has nothing lighter, so its ramp collapses to two levels there.
`mod/test/spec.test.ts` refuses a ramp that names a colour the palette lacks, or whose levels, once collapsed, do not each draw lighter than the one below in every mode.

**The rule.** The scale's most intense unit takes the ramp's top level.
Each unit below it takes the next level down, and the units below the bottom level share it.
With three levels a duration is faint in s and m, the hue in h and the lighter shade in d.
With two, everything under d is faint.
A figure whose suffix no step holds, such as `?`, is drawn in its hue.
🧠's percentage takes its size's shade.

The scales and ramps are fixed rather than relative to the session, so the same shade means the same thing on every row and in every frame.

**A figure with no unit letter takes a fixed cut**, dim under it and full strength at or over it: 💰 at $1.
Its figures run bare up to a thousand dollars, so a scale would dim every session.

**Shares have cuts of their own.**
An agent row's 🔋 🪫 pair is dim while the agent is under 0.2٪ of the week, the two together, so two figures about one scope never disagree.
The shares on the mod's rows and the receipt are never dimmed by magnitude; 100٪ is their ceiling and the reader knows it.

**🎯 uses tiers**, because a low hit rate is the problem: red at or under 50٪, amber at or under 80٪, and dim green above.
A cache collapse means the prefix was invalidated and the same work now bills at full price.

**The receipt is dim**, its colours kept, so it reads as a record beside the live rows; so are the 🔻🔖 line and a message's folded row.

### Under tmux

Claude Code draws in 256 colours whenever `TMUX` is set, even in a terminal that does true colour, unless `CLAUDE_CODE_TMUX_TRUECOLOR` is set too.
It turns each colour into a palette index by rounding, and the terminal draws that index from the xterm palette, whose steps are not the ones the rounding assumes.
So most colours come back a little off under tmux, and two near colours can come back as one.

So each default colour has two values in `mod/src/spec.ts`, a 256 value under its name and a true value in `TRUE_COLOURS`:

- **The 256 set** is drawn whenever Claude Code draws 256 colours or fewer, and wherever that is in doubt: tmux without `CLAUDE_CODE_TMUX_TRUECOLOR`, a terminal it does not know, no `TERM` at all.
  Every 256 value is one of the 80 palette entries that come back as themselves: a cube colour whose channels are all 0, 175, 215 or 255, black, white, or a grey from 8 to 178 in steps of 10.
  So the 256 set draws in tmux's limited mode exactly as chosen in the mod's rows, which go through Claude Code's renderer.
- **The true set** is softer colours, drawn only where Claude Code itself draws true colour.
  Both ports work its level out with its own rules, from the variables it reads (`COLORTERM`, `TERM`, `TERM_PROGRAM`, `FORCE_COLOR`, `NO_COLOR`, `TMUX`, `CLAUDE_CODE_TMUX_TRUECOLOR`); a wrong guess errs to the 256 set, which draws right in true colour too.

`mod/test/spec.test.ts` refuses a 256 value that is not one of the 80 entries and names the nearest, and holds a figure that is drawn dim, in either set, to a floor of faint contrast.
`tools/palette-review.py` draws both sets side by side, with the rows at each level, for a review by eye.
A test in each port checks that under tmux's limited mode, and with the level in doubt, every colour drawn is one of the 80 entries.

To have Claude Code draw true colour under tmux, set `CLAUDE_CODE_TMUX_TRUECOLOR=1`, and make sure tmux passes RGB colour through to the terminal.
tmux does when the outer terminal has the `RGB` feature (`set -as terminal-features ',xterm-256color:RGB'`, or the older `set -as terminal-overrides ',xterm-256color:Tc'`, with your terminal's `TERM` in place of `xterm-256color`).
To check, run

```sh
tmux info | grep -E 'Tc|RGB'
```

and look for `true` beside `Tc` or `RGB`.
Without it, tmux rounds RGB colour to 256 itself, and setting the variable gains nothing.

A custom Claude Code theme's `userMessageBackground` should be a palette entry too, for the same reason: the purple row of a message from another agent (`B_MSG`) is told apart from your own prompts by that background, and off the palette a dark blue and a dark green have drawn as one teal under tmux.
A dark blue `#00005f` draws as `#000087` under tmux; `#0000af` is the nearest dark blue that draws the same either way.

## Other placements

### Every row in one place

Each row's `place` in `rows` is `"above"` or `"footer"`, and a file may set one row's alone, since tables merge per field.
Giving every row the same place draws them all there.
Above the prompt they are the tree; under the footer line they stand in the one order, 💳, 🎤, 🧵, 🎮, flat, with no tree lines and each with the tree's label, and 💳 keeps 📦 🌿 🔀.
The subagents are drawn in the tree alone.
The 🔖 tag lines have no live row, and their place stays `"footer"`.

Every row under the footer line, with `"rows": {"turn": {"place": "footer"}, "agent": {"place": "footer"}, "session": {"place": "footer"}, "subagents": {"live": "never"}}`: no row drawn live is above the prompt, so `right-edge` follows to 2, the edge of Claude Code's footer container (`--part footer --rows` set so, `--right-edge 2`):

```
  -- INSERT -- ⏵⏵ auto mode on (shift+tab to cycle)
  📦repo 🌿golden-clean  📁~/src/statusline-fixture/deep/tree                                💳 🔜 6.7m 🔋  15٪  🔜 1.9d 🪫  87٪    📅 2026-08-16  🕐 02:23:20
  🎤 🟢 turn  Why …  🧬O⁵🐇  🛫 200   💰 6.4           🧠 -42k  -4٪  🧩 ▴525k ▾151k  🎯98٪  ⌛  8m         🤖⠶⠆ 🔧⠆⠀ 🚦⠀⠀  🔋 1.2٪   🪫 1.56٪
  🧵 🟢 main         🧬O⁵🐇  🤖   3m  💰  35           🧠 115k  11٪  🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋 3.8٪   🪫 8.45٪
  🎮                                  💰  35                         🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠶⠄ 🔧⠆⠀ 🚦⠄⠀  🔋 3.8٪   🪫 8.45٪
```

Every row above the prompt, with `"rows": {"account": {"place": "above"}}`, `right-edge` 5, and under the footer line only Claude Code's own line (`--part above --rows` set so, `--right-edge 5`):

```
  📁~/src/statusline-fixture/deep/tree                                                    💳 🔜 6.7m 🔋  15٪  🔜 1.9d 🪫  87٪    📅 2026-08-16  🕐 02:23:20
  ⊟ 🎮        📦repo 🌿golden-clean        💰  35                 🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠶⠄ 🔧⠆⠀ 🚦⠄⠀  🔋 3.8٪   🪫 8.45٪
  ╰⊟ 🧵    🟢 main        🧬O⁵🐇  🤖   3m  💰  35   🧠 115k  11٪  🧩 ▴2.7M ▾841k  🎯98٪  ⌛9.3h         🤖⠆⠀ 🔧⠄⠀ 🚦⠶⠄  🔋 3.8٪   🪫 8.45٪
     ╰─ 🎤 🟢 turn  Why…  🧬O⁵🐇  🛫 200   💰 6.4   🧠 -42k  -4٪  🧩 ▴525k ▾151k  🎯98٪  ⌛  8m         🤖⠶⠆ 🔧⠆⠀ 🚦⠀⠀  🔋 1.2٪   🪫 1.56٪
```

### The footer's tail

With `account-place` `"tail"` (the default is `"row"`), the 💳 row is not a row of its own: its text goes at the right end of Claude Code's footer line, plain and dim, after Claude Code's ` · `, whatever `rows.account.place` says (`--part tail`):

```
  -- INSERT -- ⏵⏵ auto mode on (shift+tab to cycle) · ⠀📁~/src/statusline-fixture/deep/tree 💳 🔜 6.7m 🔋 ⠀15٪ ⠀🔜 1.9d 🪫 ⠀87٪ 📅 2026-08-16 ⠀🕐 02:23:20
```

Claude Code trims the tail's leading spaces and draws a run of spaces as one, so the padding that ends it where the rows end is U+2800, a blank cell that is not whitespace.
The footer line hands the mod its words without the permission mode's pill, so the pill's width is counted apart, and the padding is a guess at the drawn width; `footer-ruler` draws a ruler of column digits in its place to check it.

### The status line and the Stop hook

Leave any `statusLine` command or `Stop` hook that drew the session's figures out of `settings.json`: the mod's rows replace the status line, and its receipt the Stop hook's, which would otherwise print a second one each turn.

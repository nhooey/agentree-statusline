// Every option the mod takes: the settings a configuration file may give
// it (agents/plans/open/config-merge.md).  mod/tools/gen-option-docs.ts writes
// the option table of docs/options.md from these records, between its
// `<!-- options:begin NAME -->` and `<!-- options:end NAME -->` markers,
// and mod/test/options_spec.test.ts holds the records to the form below
// and the defaults file to them.
//
// An option's name is the key a file sets it by.  Each record has, in this
// order:
//
//   type        "bool", "int", "string", "enum", "list", "table" or
//               "record"
//   items       an enum's values
//   fields      a table's or a record's fields; a table's each {type,
//               items, fixed}, `fixed` naming the rows a file cannot move
//               from the default's value
//   rows        a table's rows, by name
//   derived     {from, field, any, map}: the value worked out from a
//               table's field when no layer sets this one, the map keyed
//               by that field's values and naming every value it can
//               take; its default in mod/defaults/config.jsonc is null
//   minimum     an int's least value
//   doc-table   the table of docs/options.md it is a row of, or null
//   doc-default the Default cell, where the default alone does not say it
//   doc         the Effect cell, in Markdown
//
// The defaults are not here: every option's is in
// mod/defaults/config.jsonc and nowhere else, which the mod reads at every
// run (config-merge.md, Decided 18).  The mod's timings (tick, clock,
// receipt, fold-save and slow-read times) and its caches' version stay
// constants in mod/hooks/config.ts, out of this table (config-merge.md,
// Decided 5).

export const OPTIONS = {
  // ── The usage source ─────────────────────────────────────────────────
  "usage-source": {
    "type": "string",
    "doc-table": "settings",
    "doc": "Where plan/quota figures come from. See [Usage sources](usage-sources.md).",
  },
  "account": {
    "type": "string",
    "doc-table": "settings",
    "doc": "A non-secret label that keeps cached readings for different accounts apart. Never put a token here.",
  },
  "account-period": {
    "type": "enum",
    "items": ["day", "week", "month"],
    "doc-table": "settings",
    "doc": "The UTC calendar period for organization reports (`anthropic-admin`). Weeks start on Monday.",
  },

  // ── The grid ─────────────────────────────────────────────────────────
  // The grid's rows end where the band's do: 2 short of the edge with
  // the mod's rows all under the footer line, 5 with any above the
  // prompt, where the band's [-] stands.  Unset in every layer, it
  // follows rows.*.place: "above" when any row the mod
  // draws live (its `live` not "never") has place "above", else the
  // field's other item, "footer".
  "right-edge": {
    "type": "int",
    "derived": {
      "from": "rows",
      "field": "place",
      "any": "above",
      "map": {"footer": 2, "above": 5},
    },
    "minimum": 0,
    "doc-table": "settings",
    "doc-default": "`5` with any of the mod's rows above the prompt (`rows.*.place`), else `2`",
    "doc": "The columns every grid row leaves blank at the terminal's right edge. `2` matches the mod with its rows under the footer line, whose container stops two columns short of the edge; `5` is the room Claude Code keeps for the mod's band `[-]` above the prompt. Unset, it follows the mod's `rows.*.place` from the files: `5` when any row the mod draws live is placed `above`, else `2`, so every row ends in one column.",
  },
  // One list for the band and the receipt.  The rows table, not hide,
  // drops a whole row (config-merge.md, Decided 9).
  "hide": {
    "type": "list",
    "doc-table": "settings",
    "doc": "Columns and parts of a row's label left out of the grid, or 🔋 and 🪫 off the turn tag lines (`tag.plan.five_hour`, `tag.plan.week`), each `scope[.group[.metric]]` with `*` for any one part; see [Hiding](#hiding).",
  },
  "mark-spacing": {
    "type": "bool",
    "doc-table": "settings",
    "doc": "A blank between a mark and its value; `false` closes it.",
  },
  "subscript-decimals": {
    "type": "bool",
    "doc-table": "settings",
    "doc": "Write fractions as subscript digits: `1.2٪` becomes `1₂٪`.",
  },

  // ── The rows ─────────────────────────────────────────────────────────
  // Each row the mod can draw, by where it is drawn, when the mod draws
  // it and whether a turn's end stamps it into the transcript
  // (config-merge.md, "The rows table"; row-placement.md, "The shape").
  // Tables merge per field across layers.
  "rows": {
    "type": "table",
    "fields": {
      //   "above"  — in the band above the prompt, which Claude Code
      //              can collapse with its [-]
      //   "footer" — under Claude Code's footer line
      //              (`-- INSERT -- ⏵⏵ auto mode on …`)
      // The tag lines have no live row: theirs is always "footer"; the
      // subagents hang in the band's tree: theirs is always "above".
      "place": {
        "type": "enum",
        "items": ["above", "footer"],
        "fixed": ["tag", "subagents"],
      },
      //   "never"   — the mod never draws it
      //   "running" — drawn while a turn runs, gone at its end
      //   "always"  — drawn while a turn runs, and kept after
      "live": {"type": "enum", "items": ["never", "running", "always"]},
      // Stamped into the transcript when the turn ends.
      // `fixed`: the rows whose value is the default's, whatever a
      // file says; a file that sets another is warned about (Decided 16).
      "transcript": {"type": "bool", "fixed": ["account", "subagents"]},
    },
    // 🎤 turn, 🧵 agent, 🎮 session, the 🔻🔖 line under the prompt and
    // the receipt's 🔺🔖 line, the 💳 account row and the subagents'
    // rows in the band's tree.
    "rows": ["turn", "agent", "session", "tag", "account", "subagents"],
    "doc-table": null,
    "doc": "Each row the mod draws, 🎤 `turn`, 🧵 `agent`, 🎮 `session`, the 🔖 `tag` lines, the 💳 `account` row and the `subagents`' rows: `place`, whether it is drawn `above` the prompt or under Claude Code's `footer` line; `live`, whether it is drawn `never`, while a turn is `running` or `always`; and `transcript`, whether a turn's end stamps it into the transcript. Above the prompt the rows are a tree, 🎮 the root, then 🧵 with 🎤 and the subagents under it; under the footer line they go in one order: 💳, 🎤, 🧵, 🎮. The subagents are always above the prompt and always stamped, the receipt of a turn that ran any drawing them under 🧵, and `always` as shipped: between turns the running and paused ones stay in the tree, and the ended ones are left to the turn's receipt.",
  },
  "subagent-rows": {
    "type": "int",
    "minimum": 0,
    "doc-table": null,
    "doc": "How many subagent rows the band's tree draws at most. Past it, the later siblings under one parent are summed on that parent's `… N more` row; every shown row's parents stay.",
  },
  "finished-linger": {
    "type": "int",
    "minimum": 0,
    "doc-table": null,
    "doc": "How many seconds a row of the band's tree that finished stays drawn where it stood, ended: a subagent that ended, before it goes into `✅ N done`, and a background shell or Monitor that closed, before it goes. Counted from when it finished, its last record or the record that closed it; 0 moves it at once. A lingering subagent row counts toward `subagent-rows` as a live one does.",
  },
  "account-place": {
    "type": "enum",
    "items": ["row", "tail"],
    "doc-table": null,
    "doc": "Where the 💳 account is drawn when `rows.account.live` draws it: `row`, a row of its own where `rows.account.place` puts it, in its colours, or `tail`, in plain text at the right end of Claude Code's footer line, whatever `rows.account.place` says.",
  },
  "plan-usage": {
    "type": "bool",
    "doc-table": null,
    "doc": "Ask the account's usage endpoint for the plan's windows, the weekly Fable one and the per-model weeks among them, once a minute, as Claude Usage.app does, and draw them under `usage-source` `auto` in place of Claude Code's own reading, which names only the plan's week. One request a minute to api.anthropic.com, sent by Claude Code with the session's own credential (the mod never sees it), and only for a signed-in subscription; see [Usage sources](usage-sources.md).",
  },
  // A record merges per field across layers, so a file that turns one
  // window on leaves the others off.  Not entries in the defaults'
  // `hide`: a file's `hide` replaces that list whole, and would turn
  // every window on with it.
  "weekly-windows": {
    "type": "record",
    "fields": {
      "opus": {"type": "bool"},         // 🎼 seven_day_opus
      "sonnet": {"type": "bool"},       // 🎭 seven_day_sonnet
      "omelette": {"type": "bool"},     // 🍳 seven_day_omelette
      "oauth_apps": {"type": "bool"},   // 🔌 seven_day_oauth_apps
      "cowork": {"type": "bool"},       // 🤝 seven_day_cowork
    },
    "doc-table": null,
    "doc": "The weekly windows the usage source gives beside the plan's week and the Fable one, each drawn on the 💳 row after 🦊 while its field is true: 🎼 `opus`, 🎭 `sonnet`, 🍳 `omelette`, 🔌 `oauth_apps` and 🤝 `cowork`. All are false by default; `hide`'s `account.plan.opus` and the like still hide one that is on.",
  },
  // A record merges per field across layers; `show` merges per credit,
  // and each list of conditions is replaced whole, as a list is.
  "credits": {
    "type": "record",
    "fields": {
      //   "account" — on the 💳 row, after 🪫
      //   "none"    — not drawn
      "place": {"type": "enum", "items": ["account", "none"]},
      // Each credit is drawn when any one condition in its list holds;
      // an empty list never draws it.
      "show": {
        "type": "conditions-by",
        "keys": ["cloud", "promo", "prepaid", "extra", "passes"],
      },
      // A credit's figure is amber when any one of these holds, and red
      // when any one of `red`'s does; red wins.
      "amber": {"type": "conditions"},
      "red": {"type": "conditions"},
      // Each credit's original amount after its figure: $4.4/250.
      "original": {"type": "bool"},
      // A program that prints the credits[] JSON, for the Console's
      // credits, run every 5 minutes; null for none.
      "command": {"type": "string", "nullable": true},
    },
    "doc-table": null,
    "doc": "The account's dollar credits on the 💳 row: `place`, which credits `show` draws and when, the `amber` and `red` conditions, the `original` amount, and a `command` that prints the Console's credits. A condition is `{field, op, value, unit}`; see [The credits](#the-credits).",
  },
  "hint-tuck": {
    "type": "bool",
    "doc-table": null,
    "doc": "Draw the rows under the footer line with a bottom margin of -1, taking up the blank row Claude Code leaves between the footer and the agent panel's `* main`.",
  },
  "hint-inset": {
    "type": "int",
    "minimum": 0,
    "doc-table": null,
    "doc": "How many columns in from the terminal's left edge Claude Code draws the footer line's container, which the rows under it are drawn that much narrower to stack on the agent panel's.",
  },
  // A debugging aid.
  "footer-ruler": {
    "type": "bool",
    "doc-table": null,
    "doc": "A debugging aid: draw the footer's tail as a ruler of column digits, each the last digit of the column the mod reckons it lands in.",
  },
  "agent-message-row": {
    "type": "bool",
    "doc-table": null,
    "doc": "Draw the folded row of a message another agent sent as the sending agent's task and the message's first line, `› 📨 <task>: <line>…`, instead of Claude Code's own row.",
  },
  "slow-toast": {
    "type": "bool",
    "doc-table": null,
    "doc": "Show a slow read as a toast as well as in the mod's log.",
  },
  // A store size, not a timing.
  "starts-kept": {
    "type": "int",
    "minimum": 1,
    "doc-table": null,
    "doc": "How many start lines the mod's store keeps, and as many keys of receipts stamped, newest first.",
  },
} as const;

// The merged value of each option, by the camel case of its
// name.
export type Options = {
  readonly usageSource: string;
  readonly account: string;
  readonly accountPeriod: "day" | "week" | "month";
  readonly rightEdge: number;
  readonly hide: readonly string[];
  readonly markSpacing: boolean;
  readonly subscriptDecimals: boolean;
  readonly rows: {
    readonly turn: {
      readonly place: "above" | "footer";
      readonly live: "never" | "running" | "always";
      readonly transcript: boolean;
    };
    readonly agent: {
      readonly place: "above" | "footer";
      readonly live: "never" | "running" | "always";
      readonly transcript: boolean;
    };
    readonly session: {
      readonly place: "above" | "footer";
      readonly live: "never" | "running" | "always";
      readonly transcript: boolean;
    };
    readonly tag: {
      readonly place: "above" | "footer";
      readonly live: "never" | "running" | "always";
      readonly transcript: boolean;
    };
    readonly account: {
      readonly place: "above" | "footer";
      readonly live: "never" | "running" | "always";
      readonly transcript: boolean;
    };
    readonly subagents: {
      readonly place: "above" | "footer";
      readonly live: "never" | "running" | "always";
      readonly transcript: boolean;
    };
  };
  readonly subagentRows: number;
  readonly finishedLinger: number;
  readonly accountPlace: "row" | "tail";
  readonly planUsage: boolean;
  readonly weeklyWindows: {
    readonly opus: boolean;
    readonly sonnet: boolean;
    readonly omelette: boolean;
    readonly oauth_apps: boolean;
    readonly cowork: boolean;
  };
  readonly credits: {
    readonly place: "account" | "none";
    readonly show: { readonly cloud: readonly { readonly field: string; readonly op: string; readonly value: number; readonly unit: string }[]; readonly promo: readonly { readonly field: string; readonly op: string; readonly value: number; readonly unit: string }[]; readonly prepaid: readonly { readonly field: string; readonly op: string; readonly value: number; readonly unit: string }[]; readonly extra: readonly { readonly field: string; readonly op: string; readonly value: number; readonly unit: string }[]; readonly passes: readonly { readonly field: string; readonly op: string; readonly value: number; readonly unit: string }[]; };
    readonly amber: readonly { readonly field: string; readonly op: string; readonly value: number; readonly unit: string }[];
    readonly red: readonly { readonly field: string; readonly op: string; readonly value: number; readonly unit: string }[];
    readonly original: boolean;
    readonly command: string | null;
  };
  readonly hintTuck: boolean;
  readonly hintInset: number;
  readonly footerRuler: boolean;
  readonly agentMessageRow: boolean;
  readonly slowToast: boolean;
  readonly startsKept: number;
};

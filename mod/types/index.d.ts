// The usage band's values in `$.state`: what its drawings read, so a write
// redraws them.  Each is JSON, as the host keeps it.

/** A figures document, as claude.ts builds it. */
export type FiguresDoc = { readonly [key: string]: unknown };

/** The `spending` value: `spell` is `{session, kind, since}`, `kind` one
 * of "cloud", "promo", "prepaid", "extra" or null for the plan and `since`
 * epoch seconds or null for the whole session; `bracket` is `{session,
 * id, remaining, as_of}`.  Either may be null, or absent as an older load
 * left it. */
export type SpendingKept = {
  readonly spell?: {
    readonly session: string;
    readonly kind: "cloud" | "promo" | "prepaid" | "extra" | null;
    readonly since: number | null;
  } | null;
  readonly bracket?: {
    readonly session: string;
    readonly id: string;
    readonly remaining: number;
    readonly as_of: number;
  } | null;
};

declare module 'claude-code' {
  interface PluginState {
    'agentree': {
      /** Bumped by each load, so the timer an earlier load started stops. */
      generation: number;
      /** The band's last status document, or null before the first. */
      status: FiguresDoc | null;
      /** The main thread's 🛫, tokens a second, or null with no slope. */
      rate: number | null;
      /** Bumped when a receipt or a start line is filed in the store, so
       * the rows that look for one draw again. */
      filed: number;
      /** Bumped when a receipt is filed under its turn's answer, for a turn
       * Claude Code closes with no line, so the answers draw again. */
      answered: number;
      /** Seconds since the epoch the band and the footer draw their clocks
       * at, moved each second between reads; 0 before the first. */
      now: number;
      /** Whether the band still draws a done turn's 🎤 and 🎮 rows, until
       * just after its receipt is stamped. */
      held: boolean;
      /** Bumped by each read of the configuration files that changes the
       * options, so every drawing draws again with them. */
      configured: number;
      /** The folds of the band's tree the person left, by key: an agent's
       * id, "session" for 🎮, "main" for 🧵; true folded, false opened.
       * A key absent is its row's default.  An agent's goes once it
       * ends. */
      folds: { [key: string]: boolean };
      /** Which credit pays for the session other than the plan and since
       * when, and the first reading of its balance for the 🎮 row's
       * measured fall (src/spending.ts), as the last document found them,
       * so a reload counts on from them; `$.store` keeps a copy under
       * `spending:<session id>` for a restart.  Read back through keptSpending,
       * which takes either part of another shape, or a value absent, as
       * nothing kept. */
      spending: SpendingKept | null;
    }
  }
}

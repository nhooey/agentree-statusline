// Where the ETA instruction still has to reach the model: the main
// conversation, read from its transcript's records, and a subagent, from
// its spawn.  No `$`, no I/O: hooks/eta_instruction.ts reads the
// transcript and hands its records here.
//
// The main conversation gets the instruction as a prompt's context, from a
// `prompt.submit` hook, which the transcript keeps as a
// `hook_additional_context` attachment holding the text as it is, as it
// keeps a settings hook's context.  A conversation starts again at a
// compaction, a `compact_boundary` record, and at `/clear`, whose command
// record opens the conversation after it: what came before is gone from
// the model's context, the instruction with it.
//
// A subagent gets it at the end of the prompt it starts with.  A fork
// starts from its parent's conversation, which carries it already, and a
// resumed agent from its own.
import type { Rec } from './claude_records.ts'
import { isDict } from './py.ts'

/** What the records read so far say: how many conversations ended in
 * them, and whether the one they end in carries the instruction. */
export type Scan = { readonly boundaries: number; readonly isCarried: boolean }

/** The scan of no records. */
export const UNREAD: Scan = { boundaries: 0, isCarried: false }

// What the command record `/clear` leaves starts with.
const CLEAR = '<command-name>/clear</command-name>'

/** Whether a record is the `/clear` command's own. */
function isClear(r: Rec): boolean {
  const content = isDict(r.message) ? r.message.content : undefined
  return r.type === 'user' && typeof content === 'string' &&
    content.trimStart().startsWith(CLEAR)
}

/** Whether a record of the main conversation opens a new one: a
 * compaction's boundary, or `/clear`. */
export function isBoundary(r: Rec): boolean {
  return r.isSidechain !== true &&
    ((r.type === 'system' && r.subtype === 'compact_boundary') || isClear(r))
}

/** Whether a record of the main conversation brought the model `text`, as
 * a hook's context. */
export function carries(r: Rec, text: string): boolean {
  const a = r.attachment
  const wanted = text.trim()
  return r.type === 'attachment' && r.isSidechain !== true && isDict(a) &&
    a.type === 'hook_additional_context' && Array.isArray(a.content) &&
    a.content.some((c) => typeof c === 'string' && c.includes(wanted))
}

/** `scan` read on through `records`, the transcript's next ones. */
export function scanned(scan: Scan, records: readonly Rec[], text: string):
  Scan {
  return records.reduce<Scan>((s, r) =>
    isBoundary(r) ? { boundaries: s.boundaries + 1, isCarried: false }
      : !s.isCarried && carries(r, text) ? { ...s, isCarried: true }
        : s, scan)
}

/** The conversation's key: the session's id and how many conversations
 * its transcript ended before this one.  The hook that adds the
 * instruction keeps it, so a prompt submitted before the transcript shows
 * the instruction adds none. */
export function conversationKey(session: string, scan: Scan): string {
  return `${session}#${scan.boundaries}`
}

/** Whether the instruction is owed to the conversation `scan` reads, keyed
 * `key`, where `sent` is the key it was last added under. */
export function isOwed(scan: Scan, key: string, sent: string): boolean {
  return !scan.isCarried && key !== sent
}

/** What a spawned agent's prompt says with the instruction: null where it
 * is to be left as it is, for a fork, a resumed agent or a prompt that
 * holds the instruction already. */
export function spawnPrompt(
  spawn: { readonly prompt: string; readonly subagentType: string;
    readonly fork: boolean; readonly resume?: unknown },
  text: string,
): string | null {
  const isFork = spawn.fork || spawn.subagentType === 'fork'
  if (isFork || spawn.resume !== undefined) return null
  if (spawn.prompt.includes(text.trim())) return null
  return spawn.prompt + '\n\n' + text.trim()
}

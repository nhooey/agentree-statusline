// The ETA instruction: the short form of how to write the line the band's
// ⛳ reads, handed to every session and subagent.
//
// The text is eta-instruction.md, beside this module, so the format it
// states ships with the parser that reads it (src/claude_records.ts,
// ETA_LINE).
//
// It goes by the two events a plugin seated above sends on to this one.
// On a machine with managed settings, Claude Code's built-in
// cc-plugin-sec-default sits above every plugin a person installs and
// sends some events on past them, `classic.SessionStart` and
// `classic.SubagentStart` among them, so the instruction rides neither:
//
// - The main conversation gets it as the context of its first prompt, and
//   of the first after each compaction or `/clear`, where its transcript
//   (src/eta_instructed.ts) shows the conversation has none.  A slash
//   command's prompt may never reach the model, so it waits for one that
//   does.
// - A subagent gets it at the end of the prompt it is spawned with.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { _recordsOf } from '../src/claude_records.ts'
import {
  UNREAD, conversationKey, isOwed, scanned, spawnPrompt,
} from '../src/eta_instructed.ts'
import type { Scan } from '../src/eta_instructed.ts'
import { fileSize, placesFor, readRange } from './engine.ts'
import { transcriptPath } from './edges.ts'
import { log } from './log.ts'

type $ = EngineInterface

/** The instruction's file, under the plugin's folder. */
export const ETA_INSTRUCTION_REL = 'hooks/eta-instruction.md'

// The key of the conversation the instruction was last added to, kept
// for the moment before the transcript shows it.
const instructed = atom(
  { plugin: 'agentree-statusline', key: 'etaInstructed' } as const, '')

/** The instruction's text, or null where it cannot be read (logged). */
async function instruction($: $): Promise<string | null> {
  try {
    return await $.fs.read($.plugin.root + '/' + ETA_INSTRUCTION_REL)
  } catch (err) {
    await log($, 'eta-instruction', err)
    return null
  }
}

// The main transcript as far as it was read: a transcript is only ever
// appended to, so each prompt reads only the lines past `offset`.
let kept: { path: string; offset: number; scan: Scan } =
  { path: '', offset: 0, scan: UNREAD }

/** The main transcript's scan, read on to its last complete line. */
async function scanNow($: $, text: string): Promise<Scan> {
  const path = await transcriptPath($, await placesFor($))
  const size = path ? await fileSize($, path) : null
  if (path !== kept.path || size === null || size < kept.offset) {
    kept = { path, offset: 0, scan: UNREAD }
  }
  if (size !== null && size > kept.offset) {
    const bytes = await readRange($, path, kept.offset, size, size)
    const end = bytes.lastIndexOf(10) + 1
    kept = { path, offset: kept.offset + end,
      scan: scanned(kept.scan, _recordsOf(bytes.subarray(0, end)), text) }
  }
  return kept.scan
}

/** Hooks a prompt's submission and a subagent's spawn to hand out the
 * instruction.  A failure in either passes the event on as it came. */
export function instructEta(on: On): void {
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const text = await instruction($)
    if (text === null) return next(e)
    const scan = await scanNow($, text)
    const key = conversationKey(await $.session.id(), scan)
    if (!isOwed(scan, key, await read($, instructed))) return next(e)
    await update($, instructed, () => key)
    const entered = await next({ ...e, context: [...(e.context ?? []), text] })
    if (entered.drop !== undefined) await update($, instructed, () => '')
    return entered
  }).catch(($, e, next) => next(e))
  on('agent.spawn', async ($, e, next) => {
    const text = await instruction($)
    const prompt = text === null ? null : spawnPrompt(e, text)
    return next(prompt === null ? e : { ...e, prompt })
  }).catch(($, e, next) => next(e))
}

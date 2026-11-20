// The ETA instruction: the short form of how to write the line the band's
// ⛳ reads, handed to every session and subagent as context.
//
// The text is eta-instruction.md, beside this module, so the format it
// states ships with the parser that reads it (src/claude_records.ts,
// ETA_LINE). A session gets it at each start, a compaction's included,
// so the instruction outlives one; a subagent at its own start.
import type { EngineInterface, On } from 'claude-code'

import { log } from './log.ts'

type $ = EngineInterface

/** The instruction's file, under the plugin's folder. */
export const ETA_INSTRUCTION_REL = 'hooks/eta-instruction.md'

/** The sources of `SessionStart` that get the instruction. */
export const ETA_SOURCES = ['startup', 'resume', 'clear', 'compact'] as const

/** The instruction's text, or null where it cannot be read (logged). */
async function instruction($: $): Promise<string | null> {
  try {
    return await $.fs.read($.plugin.root + '/' + ETA_INSTRUCTION_REL)
  } catch (err) {
    await log($, 'eta-instruction', err)
    return null
  }
}

/** Adds the instruction to what the hooks beneath give as context. */
function withInstruction<R extends { additionalContext?: string[] }>(
  r: R, text: string | null,
): R {
  if (text === null) return r
  return { ...r, additionalContext: [...(r.additionalContext ?? []), text] }
}

/** Hooks SessionStart and SubagentStart to hand out the instruction. */
export function instructEta(on: On): void {
  on('classic.SessionStart', { source: [...ETA_SOURCES] },
    async ($, e, next) => withInstruction(await next(e), await instruction($)))
  on('classic.SubagentStart',
    async ($, e, next) => withInstruction(await next(e), await instruction($)))
}

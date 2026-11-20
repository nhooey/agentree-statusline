// The plugin in the engine's test harness: the ETA instruction handed to a
// session at each start its hook matches, and to every subagent, after
// whatever the hooks beneath give.
//
//   bash plugin/tools/plugin-test.sh
//
// The harness has no file system: `$.fs.read` is answered with TEXT where
// the plugin looks for the instruction, under `$.plugin.root`.
import { expect } from 'claude-code/testing'
import { test } from './budget.ts'
import type { On } from 'claude-code'

import { ETA_INSTRUCTION_REL, ETA_SOURCES } from '../hooks/eta_instruction.ts'

const TEXT = 'For a task over about a minute, the fixture instruction.'
const BENEATH = 'context from a hook beneath'

/** The engine beneath the plugin: the instruction file, and a hook beneath
 * that gives context of its own on both events. */
function world(on: On): void {
  on('fs.read', ($, e) => e.path.endsWith('/' + ETA_INSTRUCTION_REL)
    ? { value: TEXT }
    : { deny: 'no such file: ' + e.path })
  on('classic.SessionStart', () => ({ additionalContext: [BENEATH] }))
  on('classic.SubagentStart', () => ({ additionalContext: [BENEATH] }))
}

for (const source of ETA_SOURCES) {
  test(`a session's ${source} gets the instruction`, async ($, on) => {
    world(on)
    const r = await $.classic.SessionStart({ source })
    expect(r.additionalContext).toEqual([BENEATH, TEXT])
  })
}

test('a forked session is not given it again', async ($, on) => {
  world(on)
  const r = await $.classic.SessionStart({ source: 'fork' })
  expect(r.additionalContext).toEqual([BENEATH])
})

test('a subagent gets the instruction', async ($, on) => {
  world(on)
  const r = await $.classic.SubagentStart({ agent_id: 'a1',
    agent_type: 'general-purpose' })
  expect(r.additionalContext).toEqual([BENEATH, TEXT])
})

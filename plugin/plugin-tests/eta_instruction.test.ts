// The plugin in the engine's test harness: the ETA instruction handed to
// the main conversation as its first prompt's context, again after a
// compaction or /clear, and to every subagent spawned at the end of its
// prompt, whether or not a plugin above sends the session's and the
// subagent's start events on past it, as cc-plugin-sec-default does on a
// machine with managed settings.
//
//   bash plugin/tools/plugin-test.sh
//
// `$.fs.read` is answered with TEXT where the plugin looks for the
// instruction, under `$.plugin.root`, and the main transcript is a file of
// the world's, written by the test as Claude Code would.
import { expect } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'
import { test } from './budget.ts'
import type { On } from 'claude-code'

import { ETA_INSTRUCTION_REL } from '../hooks/eta_instruction.ts'
import { CWD, world } from './world.ts'
import type { World } from './world.ts'

const TEXT = 'For a task over about a minute, the fixture instruction.\n'
const BENEATH = 'context from a hook beneath'
const PROJECTS = '/claude/projects/' + CWD.replaceAll('/', '-')

/** What reached the bottom of the chains the plugin hooks, and how many
 * prompts the bottom is still to refuse. */
type Seen = { contexts: (readonly string[])[]; prompts: string[];
  drops: number }

/** The engine beneath the plugin: the instruction file, the world's files
 * and session, prompts that enter, spawns that start, and a hook beneath
 * that gives context of its own on both start events. */
function engine(on: On, session: string): { w: World; seen: Seen } {
  const w = world(on)
  w.plugin.set(ETA_INSTRUCTION_REL, new TextEncoder().encode(TEXT))
  w.session.id = session
  const seen: Seen = { contexts: [], prompts: [], drops: 0 }
  on('prompt.submit', ($, e) => {
    if (seen.drops > 0) {
      seen.drops--
      return { drop: 'not now' }
    }
    seen.contexts.push(e.context ?? [])
    return { text: e.text, context: e.context }
  })
  on('agent.spawn', ($, e) => {
    seen.prompts.push(e.prompt)
    return { model: 'claude-haiku-4-5', agentId: 'a' + seen.prompts.length }
  })
  on('classic.SessionStart', () => ({ additionalContext: [BENEATH] }))
  on('classic.SubagentStart', () => ({ additionalContext: [BENEATH] }))
  return { w, seen }
}

/** Appends `records` to the session's transcript, as Claude Code writes
 * them, one JSON object a line. */
function write(w: World, session: string, records: readonly object[]): void {
  const path = `${PROJECTS}/${session}.jsonl`
  const was = w.files.get(path) ?? new Uint8Array(0)
  const add = new TextEncoder().encode(
    records.map((r) => JSON.stringify(r) + '\n').join(''))
  const all = new Uint8Array(was.length + add.length)
  all.set(was)
  all.set(add, was.length)
  w.files.set(path, all)
}

const prompt = (text: string) =>
  ({ type: 'user', isSidechain: false, message: { role: 'user', content: text } })
/** A prompt's context from hooks, as the transcript keeps it. */
const context = (content: readonly string[]) => ({ type: 'attachment',
  isSidechain: false, attachment: { type: 'hook_additional_context', content,
    hookName: 'prompt.submit', hookEvent: 'UserPromptSubmit' } })
const compaction = { type: 'system', subtype: 'compact_boundary',
  isSidechain: false, content: 'Conversation compacted' }

const GO = { text: 'go', wait: false, origin: { kind: 'composer' } } as const

/** cc-plugin-sec-default's stand-in, seated outermost: it sends the start
 * events on past every plugin beneath its tier. */
const SEC_DEFAULT: Plugin = {
  name: 'sec-default-stand-in',
  tier: 'prepend',
  register(on) {
    on('classic.SessionStart', (_, e, next) => next.to(e, 'append'))
    on('classic.SubagentStart', (_, e, next) => next.to(e, 'append'))
  },
}

test('behind a plugin that passes the start events by, the first prompt ' +
  'gets the instruction, once', { plugins: [SEC_DEFAULT] }, async ($, on) => {
  const { seen } = engine(on, 's-behind')
  const start = await $.classic.SessionStart({ source: 'startup' })
  expect(start.additionalContext ?? []).not.toContain(TEXT)
  await $.prompt.submit(GO)
  await $.prompt.submit(GO)
  expect(seen.contexts).toEqual([[TEXT], []])
})

test('where the start events reach the plugin, the instruction still comes ' +
  'once, with the first prompt', async ($, on) => {
  const { seen } = engine(on, 's-reached')
  const start = await $.classic.SessionStart({ source: 'startup' })
  expect(start.additionalContext).toEqual([BENEATH])
  await $.prompt.submit(GO)
  await $.prompt.submit(GO)
  expect(seen.contexts).toEqual([[TEXT], []])
})

test('a compaction leaves the instruction owed again, and the transcript ' +
  'showing it keeps it from coming twice', async ($, on) => {
  const { w, seen } = engine(on, 's-compact')
  await $.prompt.submit(GO)
  write(w, 's-compact', [prompt('go'), context([TEXT])])
  await $.prompt.submit(GO)
  write(w, 's-compact', [prompt('go'), compaction])
  await $.prompt.submit(GO)
  write(w, 's-compact', [prompt('go'), context([TEXT])])
  await $.prompt.submit(GO)
  expect(seen.contexts).toEqual([[TEXT], [], [TEXT], []])
})

test('a resumed conversation that carries the instruction is not given it ' +
  'again; /clear starts one that is', async ($, on) => {
  const { w, seen } = engine(on, 's-resumed')
  write(w, 's-resumed', [prompt('earlier'), context([BENEATH, TEXT])])
  await $.prompt.submit(GO)
  w.session.id = 's-cleared'
  write(w, 's-cleared', [prompt('<command-name>/clear</command-name>')])
  await $.prompt.submit(GO)
  expect(seen.contexts).toEqual([[], [TEXT]])
})

test('a prompt that does not enter leaves the instruction owed',
  async ($, on) => {
    const { seen } = engine(on, 's-dropped')
    seen.drops = 1
    await $.prompt.submit(GO)
    await $.prompt.submit(GO)
    expect(seen.contexts).toEqual([[TEXT]])
  })

test('behind a plugin that passes SubagentStart by, a spawned subagent ' +
  'gets the instruction at the end of its prompt', { plugins: [SEC_DEFAULT] },
async ($, on) => {
  const { seen } = engine(on, 's-spawn')
  await $.agent.spawn({ prompt: 'Read README.md.' })
  expect(seen.prompts).toEqual(['Read README.md.\n\n' + TEXT.trim()])
})

test('where SubagentStart reaches the plugin, the subagent gets the ' +
  'instruction once, in its prompt', async ($, on) => {
  const { seen } = engine(on, 's-spawn-reached')
  await $.agent.spawn({ prompt: 'Read README.md.' })
  const start = await $.classic.SubagentStart({ agent_id: 'a1',
    agent_type: 'general-purpose' })
  expect(seen.prompts).toEqual(['Read README.md.\n\n' + TEXT.trim()])
  expect(start.additionalContext).toEqual([BENEATH])
})

test('a fork, which starts from its parent\'s conversation, and a prompt ' +
  'that holds the instruction are left as they are', async ($, on) => {
  const { seen } = engine(on, 's-fork')
  await $.agent.spawn({ prompt: 'Try the other fix.', subagentType: 'fork' })
  await $.agent.spawn({ prompt: 'Brief.\n\n' + TEXT })
  expect(seen.prompts).toEqual(['Try the other fix.', 'Brief.\n\n' + TEXT])
})

// The last line of each background shell's log, which its row in the
// band's tree draws after its name (src/band_tree.ts): the file the log
// band shows it from (src/shell_log.ts's logFile), read at its tail
// alone, LOG_TAIL_BYTES at most, as the log band reads it, and read again
// only once the file has changed.
import type { EngineInterface } from 'claude-code'

import type { BgTask } from '../src/claude_records.ts'
import { lastLine } from '../src/output_lines.ts'
import { LOG_TAIL_BYTES, logFile } from '../src/shell_log.ts'
import type { TreeTask } from '../src/subagent_tasks.ts'
import type { Dict } from '../src/py.ts'
import { fileSize } from './engine.ts'

type $ = EngineInterface

/** Each log's last line as last read, by its path, under the file's size
 * and mtime then; the newest KEPT_MAX of them. */
const kept = new Map<string, { stamp: string; last: string }>()
const KEPT_MAX = 32

/** The last line with text of the log at `path` (lastLine), off its last
 * LOG_TAIL_BYTES; "" where it is empty, not there or will not read. */
async function lastOf($: $, path: string): Promise<string> {
  try {
    const st = await $.fs.stat(path)
    if (st.kind !== 'file' || !st.size) return ''
    const stamp = st.size + ':' + st.mtimeMs
    const was = kept.get(path)
    if (was?.stamp === stamp) return was.last
    const offset = Math.max(0, st.size - LOG_TAIL_BYTES)
    const text = await $.fs.read(path,
      { as: 'text', offset, length: st.size - offset })
    const last = lastLine(text, offset > 0)
    kept.delete(path)
    kept.set(path, { stamp, last })
    while (kept.size > KEPT_MAX) kept.delete(kept.keys().next().value!)
    return last
  } catch {
    return ''
  }
}

/** `b` with its log's last line, for a shell started by a thread working
 * in `cwd`; as it is for a Monitor, whose last line is its event's, and
 * for a shell with no log or none with text. */
async function withLast($: $, b: BgTask, cwd: string, home: string):
  Promise<BgTask> {
  if (b.kind !== 'bash') return b
  const output = b.output ?? ''
  const size = output ? await fileSize($, output) ?? 0 : 0
  const where = logFile(output, size, b.command ?? '', cwd, home)
  if (where.path === null) return b
  const last = await lastOf($, where.path)
  return last ? { ...b, last } : b
}

/** The status document's `agents` with each shell's last line, open or
 * lingering, the main thread's and each agent's: a thread's working
 * directory, for a log its command redirects to, is its agent's last
 * `cwd`, else `cwd`, the session's. */
export async function withShellLines($: $, agents: Dict, cwd: string,
  home: string): Promise<Dict> {
  const each = (bs: readonly BgTask[] | undefined, at: string) =>
    Promise.all((bs ?? []).map((b) => withLast($, b, at, home)))
  const tasks = await Promise.all(
    ((agents.tasks ?? []) as TreeTask[]).map(async (t) => {
      const own = t.usage.cwd
      const at = typeof own === 'string' && own ? own : cwd
      return { ...t,
        ...t.bgTasks ? { bgTasks: await each(t.bgTasks, at) } : {},
        ...t.bgEnded ? { bgEnded: await each(t.bgEnded, at) } : {} }
    }))
  const ended = agents.main_background_ended as BgTask[] | undefined
  return { ...agents, tasks,
    main_background: await each(agents.main_background as BgTask[], cwd),
    ...ended ? { main_background_ended: await each(ended, cwd) } : {} }
}

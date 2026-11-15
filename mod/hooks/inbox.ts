// The agents' inbox counts the band's tree draws as 📨, read through `$`:
// claude_records_node.ts's inboxFoldCounts over the engine's reads.  Each
// file that can send, the main transcript and each agent's, is folded to
// its last whole line (src/inbox_fold.ts), kept between documents, and
// saved under the state directory's "inbox-fold" row, so a document reads
// only what each file had appended since the last, and a reload reads on
// from the save.
import type { EngineInterface } from 'claude-code'

import {
  inboxDeliveriesOf, inboxSendsOf, inboxTally, pyJoin,
} from '../src/claude_records.ts'
import {
  foldInboxEntry, INBOX_CHECK_BYTES, INBOX_SLOTS, inboxFoldDir,
  inboxFoldLoad, inboxFoldText, inboxTailDigest, newInboxEntry,
} from '../src/inbox_fold.ts'
import type { InboxEntry } from '../src/inbox_fold.ts'
import { CONFIG } from './config.ts'
import { log } from './log.ts'
import { placesOf, readRange, readText } from './engine.ts'
import type { Listed } from './engine.ts'

type $ = EngineInterface

/** A file's last line with no newline yet: the sends and deliveries it
 * holds, counted and not folded. */
type Rest = { sends: [number, string][]; got: number[] }

/** A session's inbox fold as this load keeps it: each file's entry, the
 * stamp (size and mtime) each was last read at and its unfolded rest,
 * the paths whose entries came off the save and are yet to be checked
 * against their files, the sequence number of the last save, whether
 * anything moved since it, and when it was. */
type Kept = {
  entries: Map<string, InboxEntry>; stamps: Map<string, string>
  rests: Map<string, Rest>; unchecked: Set<string>
  seq: number; dirty: boolean; savedAt: number
}

const kept = new Map<string, Kept>()

/** The bytes read past an entry at a time: a main transcript read afresh
 * can run to a hundred megabytes and more, and read in one piece crashes
 * the hooks worker. */
const PIECE = 8 * 1024 * 1024

/** How many messages wait in each agent's inbox: {agent id: count}, as
 * inboxFoldCounts counts it.  `transcript` is the session's, which sends
 * and is never a target; `agents` each agent file as listed; `targets`
 * maps each agent counted to its file; `since`, the earliest any target
 * started, skips every file last written before it.  Empty where nothing
 * reads. */
export async function inboxNow($: $, transcript: string,
  agents: readonly Listed[], targets: ReadonlyMap<string, string>,
  since: number | null): Promise<Map<string, number>> {
  if (!targets.size) return new Map()
  try {
    const st = await $.fs.stat(transcript).catch(() => null)
    const files: Listed[] = st?.kind === 'file'
      ? [{ path: transcript, size: st.size, mtimeMs: st.mtimeMs }] : []
    files.push(...agents)
    const { stateDir } = await placesOf($)
    const dir = inboxFoldDir(stateDir, transcript)
    const k = kept.get(transcript) ?? await loadKept($, dir)
    kept.set(transcript, k)
    const listed = new Set(files.map((f) => f.path))
    for (const p of [...k.entries.keys()]) {
      if (!listed.has(p)) k.dirty = forget(k, p) || k.dirty
    }
    const read = new Set<string>()
    const at = async (f: Listed) => {
      if (!read.has(f.path)) {
        read.add(f.path)
        await readOn($, k, f, f.path === transcript)
      }
      return k.entries.has(f.path)
    }
    const sent = new Map<string, number[]>()
    for (const f of files) {
      if (since !== null && f.mtimeMs / 1000 < since) continue
      if (!await at(f)) continue
      const rest = k.rests.get(f.path)?.sends ?? []
      for (const [t, target] of [...k.entries.get(f.path)!.sends, ...rest]) {
        if (!targets.has(target)) continue
        if (!sent.has(target)) sent.set(target, [])
        sent.get(target)!.push(t)
      }
    }
    const byPath = new Map(files.map((f) => [f.path, f]))
    const got = new Map<string, number[]>()
    for (const aid of sent.keys()) {
      const f = byPath.get(targets.get(aid)!)
      got.set(aid, f && f.path !== transcript && await at(f)
        ? [...k.entries.get(f.path)!.got, ...k.rests.get(f.path)?.got ?? []]
        : [])
    }
    await save($, dir, k)
    return inboxTally(sent, (aid) => got.get(aid) ?? [])
  } catch (err) {
    void log($, 'inbox not counted', err)
    return new Map()
  }
}

/** The fold saved in `dir`, from the newer slot that reads back, else the
 * other; else none, after the highest sequence number either holds. */
async function loadKept($: $, dir: string): Promise<Kept> {
  const [entries, seq] = inboxFoldLoad(await Promise.all(
    INBOX_SLOTS.map((n) => readText($, pyJoin(dir, n)))))
  return { entries, stamps: new Map(), rests: new Map(),
    unchecked: new Set(entries.keys()), seq, dirty: false,
    savedAt: -Infinity }
}

/** `path` dropped from `k`: true where it had an entry. */
function forget(k: Kept, path: string): boolean {
  k.stamps.delete(path)
  k.rests.delete(path)
  k.unchecked.delete(path)
  return k.entries.delete(path)
}

/** The check digest of `path`, `size` long, at `pos`. */
async function tailAt($: $, path: string, pos: number, size: number):
  Promise<string> {
  return inboxTailDigest(await readRange($, path,
    Math.max(0, pos - INBOX_CHECK_BYTES), pos, size))
}

/** File `f`'s entry in `k` read on to its end, PIECE at a time, and its
 * last line, with no newline yet, read as its rest: inbox_fold.read_on's
 * port.  An entry from the save is read on from only where its check
 * digest still matches, and one past the file's end not at all: either
 * is folded afresh.  A file that will not read loses its entry. */
async function readOn($: $, k: Kept, f: Listed, main: boolean):
  Promise<void> {
  const stamp = f.size + ':' + f.mtimeMs
  if (k.stamps.get(f.path) === stamp && k.entries.has(f.path)) return
  try {
    let e = k.entries.get(f.path)
    if (e && (e.pos > f.size || (k.unchecked.has(f.path) &&
      await tailAt($, f.path, e.pos, f.size) !== e.tail))) e = undefined
    k.unchecked.delete(f.path)
    const from = e?.pos ?? -1
    e ??= newInboxEntry()
    let rest: Uint8Array = new Uint8Array(0)
    let want = PIECE
    while (e.pos < f.size) {
      const end = Math.min(f.size, e.pos + want)
      const data = await readRange($, f.path, e.pos, end, f.size)
      const whole = data.lastIndexOf(10) + 1
      if (end < f.size && whole === 0) {
        // One line longer than a piece: the piece grows to hold it.
        want *= 2
        continue
      }
      foldInboxEntry(e, data.subarray(0, whole), main)
      want = PIECE
      if (end === f.size) {
        rest = data.subarray(whole)
        break
      }
    }
    if (e.pos !== from) {
      e.tail = await tailAt($, f.path, e.pos, f.size)
      e.mtime = String(Math.round(f.mtimeMs * 1e6))
      k.dirty = true
    }
    k.entries.set(f.path, e)
    k.stamps.set(f.path, stamp)
    k.rests.set(f.path, { sends: inboxSendsOf(rest),
      got: main ? [] : inboxDeliveriesOf(rest) })
  } catch {
    k.dirty = forget(k, f.path) || k.dirty
  }
}

/** `k` saved to the slot after the last one, where anything moved, at
 * most once per CONFIG.foldSaveMs.  `$.fs.write` can be read torn, which
 * is why there are two slots: a reader falls back to the other. */
async function save($: $, dir: string, k: Kept): Promise<void> {
  if (!k.dirty) return
  const now = await $.clock.now()
  if (now - k.savedAt < CONFIG.foldSaveMs) return
  k.savedAt = now
  try {
    await $.fs.write(pyJoin(dir, INBOX_SLOTS[(k.seq + 1) % 2]),
      inboxFoldText(k.entries, k.seq + 1))
    k.seq += 1
    k.dirty = false
  } catch (err) {
    void log($, 'inbox fold not saved', err)
  }
}

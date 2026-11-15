#!/usr/bin/env python3
"""Write tests/fixtures/fold-saves.json: a digest of the saved state of
every fixture transcript's main fold, of every fixture agent's fold, and
of every fixture file's inbox entry, under each fold's format.

    python3 tests/fixtures/gen/state.py              # write the file
    python3 tests/fixtures/gen/state.py --show PATH  # print PATH's saves

    {"main-fold":  {"format": N, "saves": {TRANSCRIPT: SHA256, ...}},
     "agent-fold": {"format": N, "saves": {AGENT FILE: SHA256, ...}},
     "inbox-fold": {"format": N, "saves": {FILE: SHA256, ...}}}

Each path is from the repository root, and each digest is digest()'s of
the texts that fold's save writes:

  main-fold   each committed transcript that is a session's own (not an
              agent's): a first save of its whole fold, to its last
              newline, as main_fold.fold_save writes it, its parts and
              then its head;
  agent-fold  each committed agent transcript: the text agent_fold.
              fold_text writes of its fold at each line end K, as a first
              save writes it, as [K, TEXT];
  inbox-fold  each committed transcript holding an inbox mark
              (claude_records.SEND_QUEUED_MARK or INBOX_MARKS): the text
              inbox_fold.entry_text writes of its entry at each line end
              K, folded from the start with no mtime, as [K, TEXT]; a
              session's own transcript folded as `main`, whose deliveries
              are not folded.

tests/fold.py and mod/test/{main,agent,inbox}_fold.test.ts save each fold
again, digest it, and fail where the digest differs or the format is not
spec/state.jsonc's: a change to a fold, or to what is saved of it, cannot
land without a new format, and the two ports, which must reach one digest,
cannot drift apart.  Bump the format, then run this.  --show prints the
texts a path's digests are of, to read what a change did by running it
before and after.
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(FIXTURES))
sys.path.insert(0, ROOT)

from coding_agent_usage_line import agent_fold as af  # noqa: E402
from coding_agent_usage_line import claude_records as cr  # noqa: E402
from coding_agent_usage_line import inbox_fold as ib  # noqa: E402
from coding_agent_usage_line import main_fold as mf  # noqa: E402

OUT = os.path.join(FIXTURES, "fold-saves.json")


def digest(texts) -> str:
    """The sha256 of a save's texts, in order: each a TEXT, or a [K, TEXT]
    at line end K, written as `TEXT\\n` or `K\\tTEXT\\n` in UTF-8.
    mod/test/fold_saves.ts is the TypeScript's."""
    h = hashlib.sha256()
    for t in texts:
        line = t if isinstance(t, str) else "%d\t%s" % (t[0], t[1])
        h.update((line + "\n").encode("utf-8"))
    return h.hexdigest()


def committed():
    out = subprocess.run(["git", "ls-files", "tests/fixtures"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout
    return [f for f in out.split() if f.endswith(".jsonl")]


def transcripts():
    """Every committed fixture transcript that is a session's own, as a
    path from the repository root."""
    return sorted(f for f in committed()
                  if not os.path.basename(f).startswith("agent-"))


def agents():
    """Every committed fixture agent transcript, as a path from the
    repository root."""
    return sorted(f for f in committed()
                  if os.path.basename(f).startswith("agent-"))


def inbox_files():
    """Every committed fixture transcript holding an inbox mark, as a path
    from the repository root."""
    marks = (cr.SEND_QUEUED_MARK,) + tuple(cr.INBOX_MARKS)
    out = []
    for f in sorted(committed()):
        with open(os.path.join(ROOT, f), "rb") as fh:
            data = fh.read()
        if any(m in data for m in marks):
            out.append(f)
    return out


def main_texts(path: str) -> list:
    """A first save of `path`'s whole fold, to its last newline: its parts,
    then its head."""
    with open(os.path.join(ROOT, path), "rb") as fh:
        data = fh.read()
    end = data.rfind(b"\n") + 1
    f = mf.MainFold()
    for r in mf.records_of(data[:end]):
        mf.fold_main(f, r)
    parts, head, _slot, _mark = mf.fold_save(f, mf.fold_meta(data, end))
    return [t for _, t in parts] + [head]


def agent_texts(path: str) -> list:
    """The text of `path`'s fold at each line end, as a first save writes
    it."""
    with open(os.path.join(ROOT, path), "rb") as fh:
        data = fh.read()
    f, at, texts = cr.AgentFold(), 0, []
    for k in mf.line_ends(data):
        cr.fold_agent_bytes(f, data[at:k])
        at = k
        texts.append([k, af.fold_text(f, 1, af.tail_digest(
            data[max(0, k - af.FOLD_CHECK_BYTES):k]))])
    return texts


def inbox_texts(path: str) -> list:
    """The text of `path`'s inbox entry at each line end, folded from the
    start."""
    with open(os.path.join(ROOT, path), "rb") as fh:
        data = fh.read()
    main = not os.path.basename(path).startswith("agent-")
    e, at, texts = ib.Entry(), 0, []
    for k in mf.line_ends(data):
        ib.fold_entry(e, data[at:k], main)
        at = k
        e.tail = ib.tail_digest(data[max(0, k - ib.FOLD_CHECK_BYTES):k])
        texts.append([k, ib.entry_text(path, e)])
    return texts


def folds():
    """Each fold's name, format, the paths it saves and their texts."""
    return (("main-fold", mf.MAIN_FOLD_FORMAT, transcripts(), main_texts),
            ("agent-fold", af.AGENT_FOLD_FORMAT, agents(), agent_texts),
            ("inbox-fold", ib.INBOX_FOLD_FORMAT, inbox_files(), inbox_texts))


def load() -> dict:
    with open(OUT, encoding="utf-8") as fh:
        return json.load(fh)


def show(path: str) -> None:
    """Each save of `path`, its fold's name and then its texts, one a
    line."""
    path = os.path.relpath(os.path.abspath(path), ROOT)
    found = False
    for name, _fmt, paths, texts in folds():
        if path not in paths:
            continue
        found = True
        print("=== %s" % name)
        for t in texts(path):
            print(t if isinstance(t, str) else "%d\t%s" % (t[0], t[1]))
    if not found:
        sys.exit("%s: no fold saves it" % path)


def main():
    out = {name: {"format": fmt,
                  "saves": {p: digest(texts(p)) for p in paths}}
           for name, fmt, paths, texts in folds()}
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print("fold-saves.json  %s" % ", ".join(
        "%d %s" % (len(v["saves"]), k) for k, v in sorted(out.items())))


if __name__ == "__main__":
    if sys.argv[1:2] == ["--show"] and len(sys.argv) == 3:
        show(sys.argv[2])
    elif len(sys.argv) == 1:
        main()
    else:
        sys.exit(__doc__)

"""The committed figures documents, tests/fixtures/figures/<suite>/<name>.json,
as the Python reads and writes them.  mod/test/figures_doc.ts is the
TypeScript's.

A committed document is sparse: it leaves out `schema`, and every key of a
record (a Payload, Transcript, Git, Limits, CacheShares or Turn written by
encode_record) whose value is null.  So a schema number touches no
document, and a new record field touches only the documents of sessions
that have a value for it.  full() puts back this port's own schema number
and a null for each field of a record the text lacks, so the decoders,
which refuse a document with a field missing, read it as written.  The
other nulls of a document, of its own shape rather than a record's, stay
in the text.

Since the text no longer tells a field that is null from one that is
missing, key_problems() checks that a document a run wrote has exactly its
records' fields.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIGURES = os.path.join(HERE, "fixtures", "figures")
sys.path.insert(0, os.path.dirname(HERE))

from coding_agent_usage_line import claude  # noqa: E402

# Where each mode's document holds a record, and which: a key whose value
# is the record, or null where there is none; or a list of them.
RECORDS = {
    "status": {"payload": "Payload", "transcript": "Transcript",
               "git": "Git", "limits": "Limits",
               "cache_shares": "CacheShares", "turn": "Turn",
               "open_turn": "Turn"},
    "cost": {"turns": "Turn"},
}


def fields(record: str):
    return getattr(claude, record)._fields


def records(doc: dict):
    """Each record object of `doc`, with its record's name."""
    for key, record in RECORDS[doc["mode"]].items():
        v = doc.get(key)
        for r in v if isinstance(v, list) else [v]:
            if isinstance(r, dict):
                yield record, r


def sparse(doc: dict) -> dict:
    """`doc` as it is committed: no schema, and no null field of a
    record."""
    doc = json.loads(json.dumps(doc))
    doc.pop("schema", None)
    for _record, r in records(doc):
        for k in [k for k, v in r.items() if v is None]:
            del r[k]
    return doc


def full(doc: dict) -> dict:
    """A committed document as the program reads one: this port's schema,
    and a null for each field of a record the text lacks."""
    doc = json.loads(json.dumps(doc))
    doc["schema"] = claude.FIGURES_SCHEMA
    for record, r in records(doc):
        for f in fields(record):
            r.setdefault(f, None)
    return doc


def text(doc: dict) -> str:
    """A document's canonical text, as the program writes it."""
    return claude.figures_json(doc)


def path(suite: str, name: str) -> str:
    return os.path.join(FIGURES, suite, name + ".json")


def read_full(suite: str, name: str) -> str:
    """The committed document `name`, as full canonical text, its
    placeholders as committed; None if there is none."""
    p = path(suite, name)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as fh:
        return text(full(json.load(fh)))


def key_problems(doc: dict):
    """Where a document a run wrote has other keys than its records'
    fields: (record, missing, extra) for each such record."""
    out = []
    for record, r in records(doc):
        want = set(fields(record))
        if set(r) != want:
            out.append((record, sorted(want - set(r)),
                        sorted(set(r) - want)))
    return out

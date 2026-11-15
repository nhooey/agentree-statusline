"""Prepared shared usage readings for Claude orchestration.

This module deliberately does not alter the historical Claude source/cache
path.  Callers choose when to use the returned legacy projection.
"""
from datetime import datetime
from typing import NamedTuple

from . import sources
from .claude_records import Limits, NO_LIMITS
from .render import account_summary


class PreparedClaudeReading(NamedTuple):
    reading: dict
    limits: Limits
    account_text: str


def _pct(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    return ("%.6f" % number).rstrip("0").rstrip(".")


def _reset(value):
    if value is None:
        return ""
    try:
        # Legacy Claude STAMP_FMT strings are parsed as local wall time.
        return datetime.fromtimestamp(float(value)).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError, OverflowError, OSError):
        return ""


def legacy_limits(reading):
    """Project only an unassociated default quota bucket into Claude chrome."""
    if not isinstance(reading, dict):
        return NO_LIMITS
    # A stale reading still projects.  "stale" is the collector's word for an
    # as_of older than its refresh cadence — sixty seconds for the tracker app,
    # which polls on its own schedule of about a minute, so roughly half of
    # all renders arrive here stale, and refusing them would draw a status
    # line with column 4 missing and "quota stale" appended beneath it.  The
    # age is reported (--diagnose, the account summary), never enforced: a
    # figure a minute old is the best figure there is.
    buckets = reading.get("buckets")
    if not isinstance(buckets, list) or len(buckets) != 1:
        return NO_LIMITS
    bucket = buckets[0]
    if not isinstance(bucket, dict) or bucket.get("id") != "default":
        return NO_LIMITS
    if bucket.get("model") or bucket.get("feature") or bucket.get("label") not in (None, "", "default"):
        return NO_LIMITS
    # The weekly windows beside the plan's, by id: the Fable one and the
    # others.  Each is a week long too, so each is told by its id.
    side_keys = {sources.FABLE_WINDOW: "fable", **{ident: key for key, ident in sources.WEEKLY_WINDOWS}}
    five = week = None
    side = {}
    for window in bucket.get("windows", []):
        if not isinstance(window, dict) or window.get("used_percent") is None or window.get("expired"):
            continue
        duration = window.get("duration_seconds")
        ident = window.get("id")
        key = side_keys.get(ident)
        if key is not None:
            side.setdefault(key, window)
        # Another seven_day_* window is a week beside the plan's with no
        # mark of its own: drawn nowhere, and never taken for the plan's.
        elif isinstance(ident, str) and ident.startswith("seven_day_"):
            continue
        elif duration == 18000 and five is None: five = window
        elif duration == 604800 and week is None: week = window
    if five is None and week is None and not side:
        return NO_LIMITS
    fields = {}
    for key, window in side.items():
        fields[key + "_pct"] = _pct(window.get("used_percent"))
        fields[key + "_reset"] = _reset(window.get("resets_at"))
    return Limits(_pct(five.get("used_percent")) if five else "",
                  _reset(five.get("resets_at")) if five else "", "",
                  _pct(week.get("used_percent")) if week else "",
                  _reset(week.get("resets_at")) if week else "", "",
                  **fields)


def prepare_claude_reading(spec, account, period, context, now=None):
    """Collect once and return canonical, legacy-safe, and account render forms."""
    safe = context if isinstance(context, dict) else {}
    reading = sources.collect("claude", spec, account, period, safe, now)
    return PreparedClaudeReading(reading, legacy_limits(reading),
                                 account_summary(reading, account, period, now))

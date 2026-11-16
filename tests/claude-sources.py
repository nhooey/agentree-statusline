#!/usr/bin/env python3
"""Claude bridge keeps scoped sources canonical and avoids quota misassignment."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _checks import check, holds, tally  # noqa: E402
from coding_agent_usage_line import claude_sources, sources

seen=[]; old=sources.collect
def fake(agent, spec, account, period, context, now=None):
    seen.append((agent, spec, account, period, context))
    return {"schema_version":1, "source":"cmd", "as_of":1,
            "buckets":[{"id":"default","label":"default","windows":[
                {"id":"five","duration_seconds":18000,"used_percent":12,"resets_at":200},
                {"id":"week","duration_seconds":604800,"used_percent":34,"resets_at":300}]}],
            "account":{"scope":"organization","cost_usd":2}}
sources.collect=fake
try:
    p=claude_sources.prepare_claude_reading("cmd:/fixture", "team", "day",
        {"session":"s", "model":"Claude", "rate_limits":{"secret":"no"}}, now=10)
finally: sources.collect=old
check('seen[0][:4] == ("claude", "cmd:/fixture", "team", "day")', seen[0][:4], ("claude", "cmd:/fixture", "team", "day"))
check('p.limits.session_pct == "12"', p.limits.session_pct, "12")
check('p.limits.weekly_pct == "34"', p.limits.weekly_pct, "34")
old_tz=os.environ.get("TZ")
os.environ["TZ"]="Etc/GMT-7"; time.tzset()
try:
    check('claude_sources.legacy_limits(p.reading).session_reset == "1970-01-0...', claude_sources.legacy_limits(p.reading).session_reset, "1970-01-01 07:03")
finally:
    if old_tz is None: os.environ.pop("TZ", None)
    else: os.environ["TZ"]=old_tz
    time.tzset()
holds('"organization" in p.account_text and "team day" in p.account_text', "organization" in p.account_text and "team day" in p.account_text)
# Named/associated buckets are kept solely in the generic account row.
check('claude_sources.legacy_limits({"buckets":[{"id":"spark","label":"Spa...', claude_sources.legacy_limits({"buckets":[{"id":"spark","label":"Spark","model":"Spark","windows":[{"id":"five","duration_seconds":18000,"used_percent":99}]}]}), claude_sources.NO_LIMITS)
# A stale reading is still the reading: age is reported, never enforced.
check('claude_sources.legacy_limits(dict(p.reading, stale=True)) == p.limits', claude_sources.legacy_limits(dict(p.reading, stale=True)), p.limits)

# The seeded snapshot carries NUMBERS, the form calibration compares against
# CALIB_MIN_PCT.  Seeding the renderer's strings raised a TypeError that
# _with_shares swallowed, and every share cell drew "?" on the live readout.
import hashlib, json, tempfile
from coding_agent_usage_line import claude
snap = claude.seed_limits_snapshot(p.limits, p.reading)
check('snap["session_pct"] == 12.0', snap["session_pct"], 12.0, snap)
check('snap["weekly_pct"] == 34.0', snap["weekly_pct"], 34.0, snap)
# ... and a calibration entry written by the string-carrying version still
# divides, rather than poisoning every render until CALIB_TTL lets it go.
with tempfile.TemporaryDirectory() as tmp:
    cache = os.path.join(tmp, "calib.json")
    ss, ws = claude._window_starts()
    with open(cache, "w") as fh:
        json.dump({"windows": "%s|%s" % (ss, ws), "sess_cost": 6.0, "week_cost": 17.0,
                   "sess_pct": "12", "week_pct": "34"}, fh)
    saved = claude.CALIB_CACHE_OVERRIDE
    claude.CALIB_CACHE_OVERRIDE = cache
    # And the state directory too: calibration() removes the old caches
    # from it, which must never be the user's own.
    saved_dir = os.environ.get("CODING_AGENT_USAGE_LINE_STATE_DIR")
    os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = tmp
    try:
        check('claude.calibration() == {"sess": 0.5, "week": 0.5}', claude.calibration(), {"sess": 0.5, "week": 0.5}, claude.calibration())
    finally:
        claude.CALIB_CACHE_OVERRIDE = saved
        if saved_dir is None:
            os.environ.pop("CODING_AGENT_USAGE_LINE_STATE_DIR", None)
        else:
            os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = saved_dir

# The calibration cache both ports share: its name and its text as the
# shared cases pin them, which mod/test/claude_calib.test.ts checks the
# TypeScript against.
from coding_agent_usage_line import state
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "fixtures", "calib", "values.json")) as fh:
    shared = [c for c in json.load(fh)["cases"]
              if c["fn"] in ("state_name", "calib_cache_text")]
FLOATS = {"nan": float("nan"), "inf": float("inf"), "-inf": float("-inf"),
          "-0": -0.0}
def revive(v):
    return FLOATS[v["$float"]] if isinstance(v, dict) and "$float" in v else v
for c in shared:
    args = [revive(a) for a in c["args"]]
    try:
        got = (state.state_name(*args) if c["fn"] == "state_name"
               else claude.calib_cache_text(*args))
    except TypeError:
        got = {"raises": True}
    check('got == c["out"]', got, c["out"], (c, got))
check('len(shared) == 15', len(shared), 15, len(shared))

# ... and each port reads the other's: the text the mod writes, under the
# name it gives, read by the panel's scan=False at any age.
with tempfile.TemporaryDirectory() as tmp:
    saved = (os.environ.get("CODING_AGENT_USAGE_LINE_STATE_DIR"),
             claude.CALIB_CACHE_OVERRIDE, claude._SNAPSHOT)
    os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = tmp
    claude.CALIB_CACHE_OVERRIDE = ""
    try:
        claude._SNAPSHOT = dict(snap, _scope="cmd\0me\0" + "1786800000")
        ss, ws = claude._window_starts()
        windows = "%s|%s" % (ss, ws)
        name = state.state_name("calibration", "cmd\0me\0" + "1786800000")
        check('name == [c["out"] for c in shared if c["args"] == ["calibration", "...', name, [c["out"] for c in shared
                        if c["args"] == ["calibration",
                                         "cmd\0me\x001786800000"]][0])
        path = os.path.join(tmp, name)
        check('claude.calibration_cache_path() == path', claude.calibration_cache_path(), path)
        with open(path, "w") as fh:
            fh.write(claude.calib_cache_text(windows, 6.0, 17.0, 12.0, 34.0))
        os.utime(path, (1, 1))
        claude._calib_swept = True  # which would take a file this old
        check('claude.calibration(scan=False) == {"sess": 0.5, "week": 0.5}', claude.calibration(scan=False), {"sess": 0.5, "week": 0.5})
        # The Python writes the same bytes the mod's pyJsonDumps does.
        claude._write_calib_cache(windows, 6, 17.0, 12.0, 34)
        with open(path) as fh:
            check('fh.read() == (\'{"windows":"%s","sess_cost":6.0,\' \'"week_cost":17.0,...', fh.read(), '{"windows":"%s","sess_cost":6.0,'
                                 '"week_cost":17.0,"sess_pct":12.0,'
                                 '"week_pct":34.0}' % windows)
    finally:
        if saved[0] is None:
            os.environ.pop("CODING_AGENT_USAGE_LINE_STATE_DIR", None)
        else:
            os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = saved[0]
        claude.CALIB_CACHE_OVERRIDE, claude._SNAPSHOT = saved[1:]

# The old calibration caches go once, by name alone, and nothing else does;
# find_compatible opens only a usage cache's name.
with tempfile.TemporaryDirectory() as tmp:
    saved = os.environ.get("CODING_AGENT_USAGE_LINE_STATE_DIR")
    os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = tmp
    h = "0123456789abcdef" * 4
    usage = {"agent": "claude", "account_name": "a", "period_start": "0",
             "as_of": 5, "source": "cmd"}
    c = "claude-calibration-"
    old = [c + h + ".json", c + "ts-" + h + ".cache",
           c + h.replace("0", "f") + ".json"]
    kept = [c + h + ".json.123", c + h + ".cache", c + h[:-1] + ".json",
            c + "ts-x.cache", "claude-agent-offsets-%s.json" % h, h + ".json"]
    try:
        for n in old + kept:
            with open(os.path.join(tmp, n), "w") as fh:
                json.dump(usage if n == h + ".json" else dict(usage, as_of=9),
                          fh)
        check('state.find_compatible("claude", "a", "0")["as_of"] == 5', state.find_compatible("claude", "a", "0")["as_of"], 5)
        claude._old_calib_checked = False
        check('claude._remove_old_calibrations() == 3', claude._remove_old_calibrations(), 3)
        check('sorted(os.listdir(tmp)) == sorted(kept + [claude.OLD_CALIB_DONE])', sorted(os.listdir(tmp)), sorted(kept + [claude.OLD_CALIB_DONE]))
        # Once: the marker stops the listing, in this process and the next.
        with open(os.path.join(tmp, old[0]), "w"):
            pass
        check('claude._remove_old_calibrations() == 0', claude._remove_old_calibrations(), 0)
        claude._old_calib_checked = False
        check('claude._remove_old_calibrations() == 0', claude._remove_old_calibrations(), 0)
        holds('os.path.exists(os.path.join(tmp, old[0]))', os.path.exists(os.path.join(tmp, old[0])))
        # A run out of time leaves the rest, and no marker, for the next.
        os.remove(os.path.join(tmp, claude.OLD_CALIB_DONE))
        budget, claude.OLD_CALIB_BUDGET_S = claude.OLD_CALIB_BUDGET_S, -1
        claude._old_calib_checked = False
        try:
            check('claude._remove_old_calibrations() == 0', claude._remove_old_calibrations(), 0)
        finally:
            claude.OLD_CALIB_BUDGET_S = budget
        holds('not os.path.exists(os.path.join(tmp, claude.OLD_CALIB_DONE))', not os.path.exists(os.path.join(tmp, claude.OLD_CALIB_DONE)))
        claude._old_calib_checked = False
        check('claude._remove_old_calibrations() == 1', claude._remove_old_calibrations(), 1)
        # The old window-cost caches go the same way: the Python's, its
        # killed saves' temporary files, the Node port's and the mod's.
        # Today's name, and anything else, stays.
        w = "claude-window-costs"
        old_w = [w + ".cache", w + ".cache.12242", w + "-ts.cache",
                 w + "-mod.cache"]
        kept_w = [w + "-" + h + ".cache", w + ".cache.tmp",
                  w + "-x.cache", w + ".json"]
        for n in old_w + kept_w:
            open(os.path.join(tmp, n), "w").close()
        before = set(os.listdir(tmp))
        claude._old_costs_checked = False
        check('claude._remove_old_window_costs() == 4', claude._remove_old_window_costs(), 4)
        check('set(os.listdir(tmp)) == before - set(old_w) | {claude.OLD_COSTS_DONE}', set(os.listdir(tmp)), before - set(old_w) | {claude.OLD_COSTS_DONE})
        open(os.path.join(tmp, old_w[0]), "w").close()
        check('claude._remove_old_window_costs() == 0', claude._remove_old_window_costs(), 0)    # once a process
        claude._old_costs_checked = False
        check('claude._remove_old_window_costs() == 0', claude._remove_old_window_costs(), 0)    # and once at all
        holds('os.path.exists(os.path.join(tmp, old_w[0]))', os.path.exists(os.path.join(tmp, old_w[0])))
    finally:
        if saved is None:
            os.environ.pop("CODING_AGENT_USAGE_LINE_STATE_DIR", None)
        else:
            os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = saved

# One account and window name one calibration cache, whether the render
# fetched the reading or took the cache an earlier render left, and whichever
# session it is: the shared scenarios mod/test/sources.test.ts replays too.
# A cached reading lost its account and window, so the panel and the mod
# wrote and read two files; and the scope was the session's, so every
# session of one account scanned for a file of its own.
with open(os.path.join(HERE, "fixtures", "sources", "collect.json")) as fh:
    scenarios = {c["name"]: c["steps"] for c in json.load(fh)}
PROFILE = "profile:" + hashlib.sha256(b"golden").hexdigest()[:24]
SCOPE = "claude-usage-tracker\0" + PROFILE + "\0" "1786838400"
ACCOUNT = "account:" + hashlib.sha256(
    b"11111111-2222-3333-4444-555555555555").hexdigest()[:24]
EXPECT = {
    "tracker: fresh, then cached, one scope": [SCOPE] * 3,
    "tracker: two sessions, one profile, one scope": [SCOPE] * 3,
    "tracker: another profile, another scope": [
        SCOPE, SCOPE.replace(PROFILE, "profile:" + hashlib.sha256(
            b"other").hexdigest()[:24])],
    "tracker: a profile with no id, the session": [
        "claude-usage-tracker\0session:s1\0" "1786838400",
        "claude-usage-tracker\0session:s2\0" "1786838400"],
    "native: two sessions, one signed-in account": [
        "native\0" + ACCOUNT + "\0" "1786838400"] * 3,
}
ENV = ("CODING_AGENT_USAGE_LINE_STATE_DIR",
       "CODING_AGENT_USAGE_LINE_CLAUDE_TRACKER_PLIST", "CLAUDE_CONFIG_DIR")
for name, scopes in EXPECT.items():
    steps = scenarios[name]
    check('[s["scope"] for s in steps] == scopes', [s["scope"] for s in steps], scopes, name)
    sessions = {s["built_context"]["session"] for s in steps}
    with tempfile.TemporaryDirectory() as tmp:
        saved = {k: os.environ.get(k) for k in ENV}
        os.environ[ENV[0]] = os.path.join(tmp, "s")
        tracker = os.environ[ENV[1]] = os.path.join(tmp, "tracker.plist")
        config = os.environ[ENV[2]] = os.path.join(tmp, "config")
        os.makedirs(config)
        try:
            for s in steps:
                with open(tracker, "w") as fh:
                    fh.write(s["tracker"])
                if s["claude_json"] is not None:
                    with open(os.path.join(config, ".claude.json"),
                              "w") as fh:
                        fh.write(s["claude_json"])
                p = claude_sources.prepare_claude_reading(
                    s["spec"], s["account"], s["period"],
                    s["built_context"], s["now"])
                got = claude.seed_limits_snapshot(p.limits,
                                                  p.reading)["_scope"]
                check('got == s["scope"]', got, s["scope"], (name, s["now"], got))
                # The reading caches stay the session's.
                check('p.reading["account_name"] == ( "session:" + s["built_context"]["ses...', p.reading["account_name"], "session:" + s["built_context"]["session"], p.reading)
            files = os.listdir(os.path.join(tmp, "s"))
            holds('all("canary" not in open(os.path.join(tmp, "s", f)).read() for f in...', all("canary" not in open(os.path.join(tmp, "s", f)).read()
                       for f in files if f.endswith(".json")))
        finally:
            for k, v in saved.items():
                if v is None: os.environ.pop(k, None)
                else: os.environ[k] = v
    check('len(sessions) == (1 if "fresh" in name or "another" in name else 2)', len(sessions), 1 if "fresh" in name or "another" in name
                             else 2, (name, sessions))

# The tracker's id and the config's uuid are read hashed, and only them.
store = {"activeProfileId": "P1", "profiles_v3": json.dumps([
    {"id": "P1", "claudeUsage": {"sessionPercentage": 1},
     "oauthAccountJSON": "oauth-canary"}]).encode()}
reading = claude.tracker_reading(store)
check('reading["account_id"] == "profile:" + hashlib.sha256( b"P1").hexdig...', reading["account_id"], "profile:" + hashlib.sha256(
    b"P1").hexdigest()[:24], reading)
holds('"canary" not in json.dumps(reading)', "canary" not in json.dumps(reading))
holds('"account_id" not in claude.tracker_reading( {"profiles_v3": json.du...', "account_id" not in claude.tracker_reading(
    {"profiles_v3": json.dumps([{"claudeUsage": {}}])}))
# A command cannot name the account: normalise has no such field, and the
# cache takes only the hashed form.
holds('"account_id" not in sources.normalise( {"schema_version": 1, "accou...', "account_id" not in sources.normalise(
    {"schema_version": 1, "account_id": "profile:" + "0" * 24,
     "windows": [{"id": "w", "used_percent": 1}]}, "cmd"))
holds('"account_id" not in sources._cached_reading( {"schema_version": 1, ...', "account_id" not in sources._cached_reading(
    {"schema_version": 1, "account_id": "me", "as_of": 1,
     "windows": [{"id": "w", "used_percent": 1}]}, "cmd", 1, 60))

# The sweep: calibration caches untouched for CALIB_MAX_AGE_S, by name, at
# most once a day across processes, and never with an override in force.
with tempfile.TemporaryDirectory() as tmp:
    saved = (os.environ.get("CODING_AGENT_USAGE_LINE_STATE_DIR"),
             claude.CALIB_CACHE_OVERRIDE)
    os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = tmp
    claude.CALIB_CACHE_OVERRIDE = ""
    now = 2000000000.0
    old_t = now - claude.CALIB_MAX_AGE_S - 60
    def plant(name, t):
        path = os.path.join(tmp, name)
        open(path, "w").close()
        os.utime(path, (t, t))
    c = "claude-calibration-"
    h = "0123456789abcdef" * 4
    try:
        plant(c + h + ".cache", old_t)
        plant(c + h.replace("0", "a") + ".cache", now - 3600)
        plant(c + h + ".cache.tmp", old_t)
        plant(h + ".json", old_t)
        # The window-cost cache and its killed saves' temporary files go the
        # same way; a live one, or a name it does not write, stays.
        w = "claude-window-costs-"
        plant(w + h + ".cache", old_t)
        plant(w + h.replace("0", "b") + ".cache.4242", old_t)
        plant(w + h.replace("0", "a") + ".cache", now - 3600)
        plant(w + h + ".cache.tmp", old_t)
        # A fold directory goes once none of its files has been written for
        # as long, by the names a fold writes; one still in use stays, and
        # so does one holding anything else.
        def plant_dir(name, files, t):
            os.mkdir(os.path.join(tmp, name))
            for f in files:
                plant(os.path.join(name, f), t)
        af, mf = "claude-agent-fold-", "claude-main-fold-"
        plant_dir(af + h, [h + "-a.cache", h + "-b.cache",
                           h + "-a.cache.77.tmp"], old_t)
        plant_dir(mf + h, ["head-a.cache", "head-b.cache", "part-0.cache",
                           "part-11.cache"], old_t)
        plant_dir("claude-inbox-fold-" + h,
                  ["inbox-a.cache", "inbox-b.cache.12.tmp"], old_t)
        plant_dir(af + h.replace("0", "a"), [h + "-a.cache"], old_t)
        plant(os.path.join(af + h.replace("0", "a"), h + "-b.cache"),
              now - 3600)
        plant_dir(mf + h.replace("0", "a"), ["head-a.cache", "notes"], old_t)
        claude._calib_swept = False
        check('claude._sweep_calibrations(now) == 3 + 3 + 4 + 2 + 1', claude._sweep_calibrations(now), 3 + 3 + 4 + 2 + 1)
        left = sorted(os.listdir(tmp))
        check('left == sorted([c + h.replace("0", "a") + ".cache", c + h + ".cache...', left, sorted([c + h.replace("0", "a") + ".cache",
                               c + h + ".cache.tmp", h + ".json",
                               w + h.replace("0", "a") + ".cache",
                               w + h + ".cache.tmp",
                               af + h.replace("0", "a"),
                               mf + h.replace("0", "a"),
                               claude.CALIB_SWEPT]), left)
        check('os.listdir(os.path.join(tmp, mf + h.replace("0", "a"))) == ["notes"]', os.listdir(os.path.join(tmp, mf + h.replace("0", "a"))), ["notes"])
        check('len(os.listdir(os.path.join(tmp, af + h.replace("0", "a")))) == 2', len(os.listdir(os.path.join(tmp, af + h.replace("0", "a")))), 2)
        plant(c + h + ".cache", old_t)
        check('claude._sweep_calibrations(now) == 0', claude._sweep_calibrations(now), 0)      # once a process
        claude._calib_swept = False
        check('claude._sweep_calibrations(now) == 0', claude._sweep_calibrations(now), 0)      # once a day
        claude._calib_swept = False
        check('claude._sweep_calibrations( now + claude.CALIB_SWEEP_EVERY_S + 1) == 1', claude._sweep_calibrations(
            now + claude.CALIB_SWEEP_EVERY_S + 1), 1)
        plant(c + h + ".cache", old_t)
        claude._calib_swept = False
        claude.CALIB_CACHE_OVERRIDE = os.path.join(tmp, "calib.json")
        check('claude._sweep_calibrations(now + 9e6) == 0', claude._sweep_calibrations(now + 9e6), 0)
    finally:
        if saved[0] is None:
            os.environ.pop("CODING_AGENT_USAGE_LINE_STATE_DIR", None)
        else:
            os.environ["CODING_AGENT_USAGE_LINE_STATE_DIR"] = saved[0]
        claude.CALIB_CACHE_OVERRIDE = saved[1]
line, status = tally()
print(line)
sys.exit(status)

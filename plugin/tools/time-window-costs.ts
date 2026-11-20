// What the window-cost scan costs here, cold and off its cache.
//
//   node plugin/tools/time-window-costs.ts [--runs N]
//
// Not in CI: it reads ~/.claude/projects, which is private.  It scans the
// real transcripts with the windows a plan has now (the 5-hour one from
// five hours ago, the week from seven days ago), against a scratch state
// directory, never the real one: first with nothing cached, then N times
// more off the cache the first left.  `time-window-costs` in the dev shell
// runs it.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cc from "../src/claude_calib_node.ts";
import type { CalibEnv } from "../src/claude_calib_node.ts";

const at = process.argv.indexOf("--runs");
const runs = at >= 0 ? Number(process.argv[at + 1]) : 3;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "window-costs-"));
const projectsDir = process.env.AGENTREE_STATUSLINE_CLAUDE_PROJECTS_DIR ||
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "projects");
const now = Date.now() / 1000;
// Naive local datetimes: the local clock less the windows.
const local = now - new Date().getTimezoneOffset() * 60;
const ss = local - 5 * 3600, ws = local - 7 * 86400;
const env: CalibEnv = { projectsDir, stateDir: scratch, now };
try {
  let t = performance.now();
  const [sess, week] = cc._windowCosts(ss, ws, env);
  const cold = performance.now() - t;
  const hits: number[] = [];
  for (let i = 0; i < runs; i++) {
    t = performance.now();
    cc._windowCosts(ss, ws, env);
    hits.push(performance.now() - t);
  }
  const size = fs.readdirSync(scratch)
    .reduce((n, f) => n + fs.statSync(path.join(scratch, f)).size, 0);
  console.log(`node: cold ${cold.toFixed(0)} ms, cached ${
    hits.map((h) => h.toFixed(0)).join(" ")} ms, cache ${
    (size / 1e6).toFixed(2)} MB, sess $${sess.toFixed(2)}, week $${
    week.toFixed(2)}`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

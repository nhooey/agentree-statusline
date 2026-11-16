For a task over about a minute, as the main agent or as a subagent, say how
long it has left by writing this line on its own, outside any code block or
quote, with a number and a unit (s, m or h) in place of `<n><s|m|h>`:

⛳ skills/coding-agent-usage-line-report-eta: ETA <n><s|m|h>

- The figure is the wall-clock time left on your whole task, not the total.
- Write it once you have a plan, after each milestone, and whenever your
  estimate changes by a quarter or more; write `ETA 0s` when you finish.
- When told to `recurse`, load the `coding-agent-usage-line-report-eta`
  skill with the Skill tool and follow it.

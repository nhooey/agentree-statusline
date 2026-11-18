---
title: agentree-statusline sees every session and subagent start behind cc-plugin-sec-default
state: approved
kind: end-state
---

# agentree-statusline sees every session and subagent start behind cc-plugin-sec-default

agentree-statusline's `SessionStart` and `SubagentStart` hooks run on every start,
whichever plugins load before it.

## Why

`cc-plugin-sec-default` runs before agentree-statusline and answers some start
events without passing them on, so agentree-statusline's hook for that event never
runs. Claude Code reports it as a notice naming the skipped hook, for
example: `usage-band: its classic.SessionStart hook was skipped.
"cc-plugin-sec-default" runs first and sent the event on past it.` It has
been seen on `SubagentStart`, and on `SessionStart` after
`/reload-plugins`. A skipped start leaves the tree without the session's
or the subagent's row until a later event draws it.

## Done when

- Which of `cc-plugin-sec-default`'s hooks returns without calling
  `next`, and on which events, is known from its source.
- Either that plugin passes start events on, or agentree-statusline gets the same
  facts from an event no earlier plugin consumes, and the choice is
  recorded here.
- A `/reload-plugins` and a subagent start each draw their rows with no
  skipped-hook notice.

## Upstream

[anthropics/claude-code#104236](https://github.com/anthropics/claude-code/issues/104236)
reports `cc-plugin-sec-default` passing over user-tier `classic.SessionStart`,
and a comment there adds `SubagentStart`. A fix upstream meets the first
way out above.

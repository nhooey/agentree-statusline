---
title: A press on a background shell's row shows its log in a band above the prompt
state: implemented
kind: end-state
touches: [mod/src/band_tree.ts, mod/src/spans.ts, mod/src/shell_log.ts, mod/src/claude_records.ts, mod/hooks/register.tsx, mod-tests/band.test.ts]
implemented-by: shell-log-band
---

# A press on a background shell's row shows its log in a band above the prompt

A background shell's row in the tree (`bgNode` in `mod/src/band_tree.ts`)
opens a log band when pressed, and a second press on the same row closes
it.

## Done when

- **The band:** while open, a full-width band above the prompt (the
  `AbovePrompt` render, above the tree's rows) holds the shell's log: its
  last lines, as many as fit in half the terminal's height
  (`e.viewport.rows`), each cut to the band's width. In fullscreen, where
  the bottom slot holds at most half the rows, the prompt's included, the
  band takes what that half leaves after the prompt and the tree.
- **One at a time:** pressing another shell's row moves the band to that
  shell. A shell that ends keeps its band until it's closed or its row
  stops being drawn.
- **Live:** the band redraws on a `$.clock` timer while open, and on no
  timer while closed.
- **Reading the log:** only the file's tail is read, with
  `$.fs.read(path, { offset, length })`, never the whole file.
- **Which file:**
  1. the task's output file (`BgTask.output`), when it holds anything;
  2. otherwise the file named by the command's last stdout redirect,
     `> file`, `>> file`, `&> file` or `1> file`, resolved against the
     shell's working directory;
  3. otherwise the band says it found no log: the output file is empty and
     the command writes nowhere visible, as when the redirect is inside a
     script it runs.

  The band's first line names the file it shows.
- **Monitors:** a Monitor's row keeps today's press, the toast of
  `bgText`.
- **Tests:** `mod-tests/band.test.ts` presses a shell's row and finds the
  band with the log's last lines; a second press removes it; a command
  ending `> some.log 2>&1` shows `some.log`; a command with no redirect
  and an empty output file shows the no-log line; the tail stays within
  half the rows.

## Why not the alternatives

- `$.ui.view` shows transcripts only: its `SiteView` takes just
  `agentId`, so it can't show a shell.
- A docked `Pane` is at most 45% of the terminal's width, too narrow for
  build logs.

## When

The build waits until the `github-config` session reports that its stack
run has ended. It ships as one pull request in its own stack.

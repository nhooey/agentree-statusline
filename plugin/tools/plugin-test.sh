#!/usr/bin/env bash
# Validate the plugin and run its harness tests (plugin-tests/) in Claude Code's
# own test runner.
#
#   bash plugin/tools/plugin-test.sh
#
# `claude plugin test <folder>` runs every *.test.ts under the folder, and
# plugin/ is both the plugin and the Node port, whose test/*.test.ts import
# node:test and will not load in the plugin's runtime.  So the plugin's own
# files are copied to a scratch folder and the runner pointed at that:
# the manifest, the hooks, the src/ modules they import, the state
# contract and the harness tests.  Nothing is installed and no settings
# are touched.
set -euo pipefail

plugin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/agentree-statusline-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/.claude-plugin"
cp "$plugin/.claude-plugin/plugin.json" "$work/.claude-plugin/"
cp -R "$plugin/hooks" "$plugin/src" "$plugin/types" "$plugin/defaults" "$plugin/plugin-tests" \
  "$work/"

claude plugin validate "$work"
claude plugin test "$work"

#!/usr/bin/env bash
# Every deterministic suite, side by side, and one line each on how it went.
#
#   bash tests/all.sh                  # every suite
#   bash tests/all.sh node typecheck   # the ones named
#   bash tests/all.sh --repeat 20 node # until one fails, 20 at most
#   bash tests/all.sh --skip generated # every suite but those
#
# The suites share no state, so they run at once; the longest, the node
# suite, is about the wall time of the whole.  Each line
# is the suite's name, its seconds, ok or FAIL, and the result line it
# printed.  A failing suite's output follows the table, and the exit status
# is the number of suites that failed.  The manual checks of docs/tests.md
# are not here.
#
# Last, once the suites are done, `generated` reruns every generator of
# committed files (the plugin's under plugin/tools/) and
# fails if `git status` then shows any changed or untracked file: a
# generator's output left uncommitted, which GitHub's run would miss.  It
# runs alone because it rewrites the suites' inputs, and it fails on
# uncommitted work too, so it is the check to run before a push.
#
# --repeat N, first, runs the whole selection again, round after round, and
# stops at the first round with a failure, whose status is the exit status:
# for a flaky suite, the way to catch it failing.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = "--repeat" ]; then
  rounds="${2:-}"
  case "$rounds" in
    '' | *[!0-9]*)
      echo "--repeat takes a number of rounds" >&2
      exit 2
      ;;
  esac
  shift 2
  for ((i = 1; i <= rounds; i++)); do
    echo "=== round $i of $rounds"
    bash "$0" "$@"
    rc=$?
    [ "$rc" -eq 0 ] || exit "$rc"
  done
  exit 0
fi
# --skip A,B[,...] leaves those suites out of the selection, named or not.
skip=","
if [ "${1:-}" = "--skip" ]; then
  skip=",${2:-},"
  shift 2
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/all-suites.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# name | directory under ROOT | command.  In the order the table prints.
SUITES='
usage-dev|.|python3 tests/usage-dev.py
node|plugin|node --test test/*.test.ts
typecheck|plugin|npm run -s typecheck
typecheck-plugin|plugin|npm run -s typecheck:plugin
plugin-test|plugin|npm run -s test:plugin
plugin-validate|plugin|claude plugin validate .
'

now() {
  if [ -n "${EPOCHREALTIME:-}" ]; then echo "$EPOCHREALTIME"
  else date +%s; fi
}

# secs START END: the seconds between, to a tenth.
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }

# wanted NAME [ASKED...]: NAME is not skipped, and is one of those asked
# for, or none were.
wanted() {
  case "$skip" in *",$1,"*) return 1 ;; esac
  [ $# -le 1 ] && return 0
  local n
  for n in "${@:2}"; do [ "$n" = "$1" ] && return 0; done
  return 1
}

names=()
t0=$(now)
while IFS='|' read -r name dir cmd; do
  [ -n "$name" ] || continue
  wanted "$name" "$@" || continue
  names+=("$name")
  (
    cd "$ROOT/$dir" || exit 1
    start=$(now)
    # Word splitting is the point: each command is a plain argv.  The glob
    # is node's, so it is not expanded here.
    set -f
    # shellcheck disable=SC2086
    $cmd >"$work/$name.out" 2>&1
    rc=$?
    echo "$rc $start $(now)" >"$work/$name.rc"
  ) &
done <<EOF
$SUITES
EOF
wait
if wanted generated "$@"; then
  names+=(generated)
  (
    cd "$ROOT" || exit 1
    start=$(now)
    {
      node plugin/tools/gen-option-docs.ts &&
        node plugin/tools/gen-config-cases.ts >/dev/null &&
        node plugin/tools/gen-fold-saves.ts >/dev/null &&
        node plugin/tools/gen-grid-cases.ts >/dev/null &&
        node plugin/tools/gen-row-cases.ts >/dev/null &&
        node plugin/tools/gen-plugin-fixtures.ts >/dev/null &&
        dirty="$(git status --porcelain --untracked-files=all)" &&
        if [ -n "$dirty" ]; then
          echo "$dirty"
          echo "FAIL: the tree is not clean after the generators"
          false
        else
          echo "ok the tree is clean after the generators"
        fi
    } >"$work/generated.out" 2>&1
    rc=$?
    echo "$rc $start $(now)" >"$work/generated.rc"
  )
fi
t1=$(now)
if [ ${#names[@]} -eq 0 ]; then
  echo "no suite named $*; the names are the first column of SUITES, and generated" >&2
  exit 2
fi

# The line a suite sums itself up in: its last that counts or says ok.
result() {
  grep -E 'pass [0-9]+ +fail|^ℹ (pass|fail) |files differ|^ok |^OK|^Ran [0-9]|[0-9]+ pass|Validation (passed|failed)|^FAIL: ' "$1" \
    | grep -v '^  ok ' | tail -2 | tr '\n' ' ' | sed 's/  */ /g'
}

failed=0
for name in "${names[@]}"; do
  read -r rc start end <"$work/$name.rc"
  took=$(secs "$start" "$end")
  if [ "$rc" -eq 0 ]; then mark=ok; else mark=FAIL; failed=$((failed + 1)); fi
  printf '%-24s %6ss  %-4s  %s\n' "$name" "$took" "$mark" \
    "$(result "$work/$name.out")"
done
printf '%-24s %6ss  %d of %d failed\n' "wall" \
  "$(secs "$t0" "$t1")" "$failed" "${#names[@]}"

for name in "${names[@]}"; do
  read -r rc _ <"$work/$name.rc"
  [ "$rc" -eq 0 ] && continue
  echo
  echo "=== $name failed: the last 40 lines ==="
  tail -40 "$work/$name.out"
done
exit "$failed"

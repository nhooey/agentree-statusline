#!/usr/bin/env bash
# The status cases of tests/fixtures/cases.json, kept under this name for CI
# and habit.  See run-cases.py; --regen passes through.
# $TEST_PYTHON, where set, runs both the harness and the program.
exec "${TEST_PYTHON:-/usr/bin/python3}" "$(dirname "$0")/run-cases.py" --suite status "$@"

#!/usr/bin/env bash
# Run typecheck + tests via the built-in Node test runner.
#
# Usage:
#   ./run_test.sh                              # typecheck + all tests
#   ./run_test.sh server/state.test.ts         # single file
#   ./run_test.sh --watch                      # rerun on change
#   ./run_test.sh --test-name-pattern=evict    # filter by test name
#   SKIP_TYPECHECK=1 ./run_test.sh             # tests only
#
# Discovery: `node --test` walks the cwd for files matching
#   **/{test,test-*,*.test,*-test,*_test}.{js,ts,mjs,cjs,mts,cts}
# and anything under **/test/**. Node 24 strips TS types natively;
# no extra deps required.

set -euo pipefail

cd "$(dirname "$0")"

if [[ "${SKIP_TYPECHECK:-0}" != "1" ]]; then
  echo "→ typecheck"
  npm run --silent typecheck
fi

echo "→ tests"
exec node --test --test-reporter=spec "$@"

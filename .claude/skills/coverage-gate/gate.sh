#!/usr/bin/env bash
# Black-box coverage gate: line coverage of src/core reached by tests/blackbox
# alone. Usage: gate.sh [threshold-percent]
set -euo pipefail

THRESHOLD="${1:-${COVERAGE_THRESHOLD:-85}}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

npx vitest run tests/blackbox \
    --coverage.enabled --coverage.provider=v8 \
    --coverage.include='src/core/**' \
    --coverage.reporter=text --coverage.reporter=json-summary \
    --coverage.reportsDirectory="$OUT"

PERCENT="$(node -e 'console.log(require(process.argv[1]).total.lines.pct)' "$OUT/coverage-summary.json")"
if ! [[ "$PERCENT" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "ERROR: couldn't read line coverage (got '${PERCENT}')." >&2
    exit 2
fi
echo
echo "Black-box line coverage of src/core: ${PERCENT}% (gate ${THRESHOLD}%)"

if awk -v p="$PERCENT" -v t="$THRESHOLD" 'BEGIN { exit !(p + 0 >= t + 0) }'; then
    echo "PASS"
else
    echo "FAIL: add black-box tests. The 'Uncovered Line #s' column above lists the gaps."
    exit 1
fi

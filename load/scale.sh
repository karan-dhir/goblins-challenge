#!/usr/bin/env bash
# Run the testing-day spike at increasing scale against the grading service to
# find the breaking point. $0 against GRADER_MODE=stub; re-runnable infinitely.
#
#   TARGET=http://localhost:3001 ./load/scale.sh
#   (start the service first: GRADER_MODE=stub pnpm service)
set -euo pipefail

cd "$(dirname "$0")"
TARGET="${TARGET:-http://localhost:3001}"
MULTS="${MULTS:-1 2 4 8 16}"
mkdir -p results

if ! curl -sf "$TARGET/health" >/dev/null; then
  echo "grading service not reachable at $TARGET — start it first (GRADER_MODE=stub pnpm service)"; exit 1
fi

echo "load target: $TARGET   scales: $MULTS"
for M in $MULTS; do
  echo; echo "### running spike at MULT=$M ..."
  k6 run -e MULT="$M" -e TARGET="$TARGET" scenario.js || true
done

echo; echo "summaries written to load/results/summary-mult*.json"

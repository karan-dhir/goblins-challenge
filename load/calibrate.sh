#!/usr/bin/env bash
# Small REAL-OpenRouter run to anchor the stub's latency/cost model. Keeps spend
# in the cents. Requires the service running with GRADER_MODE=real + a real key.
#
#   TARGET=http://localhost:3001 ./load/calibrate.sh
set -euo pipefail
cd "$(dirname "$0")"
TARGET="${TARGET:-http://localhost:3001}"
mkdir -p results

if ! curl -sf "$TARGET/health" >/dev/null; then
  echo "service not reachable at $TARGET (start with GRADER_MODE=real)"; exit 1
fi

# Tiny load: ~0.2x of the base scenario → a handful of real grades.
MULTS="0.2" MULT=0.2 k6 run -e MULT=0.2 -e TARGET="$TARGET" scenario.js | tee results/calibration.txt
echo
echo "real grade latency (from /metrics):"
curl -s "$TARGET/metrics" | tee results/calibration-metrics.json
echo
echo "→ set STUB_LATENCY_MS_MEAN/STD from gradeLatencyP50/P95 above; record cost from the OpenRouter dashboard."

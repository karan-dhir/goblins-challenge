/**
 * Testing-day spike against the grading pipeline's ingestion path (POST /grade).
 *
 * Why POST /grade is the right target: enqueue returns 202 immediately, so its
 * latency stays flat UNTIL the bounded queue fills — at which point Queue.offer
 * applies backpressure and POST latency climbs. That knee IS the breaking point.
 * A second low-rate VU polls /metrics to record queue depth + grade p95 so we
 * can tell queue saturation from DB stall (db_write_latency_p95).
 *
 * Scale with MULT (1, 10, 100). Run against GRADER_MODE=stub for $0/unlimited.
 *   k6 run -e MULT=10 -e TARGET=http://localhost:3001 load/scenario.js
 */
import http from "k6/http"
import { check } from "k6"
import { Trend, Counter } from "k6/metrics"
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js"

const TARGET = __ENV.TARGET || "http://localhost:3001"
const MULT = Number(__ENV.MULT || "1")

const rubric = JSON.parse(open("./payloads/test-rubric.json"))
// Tiny 1x1 PNG data URL — stub ignores it; keeps payload small under load.
const IMG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pcaAAAAAElFTkSuQmCC"

const queueDepth = new Trend("queue_depth")
const gradeP95 = new Trend("grade_latency_p95")
const dbP95 = new Trend("db_write_latency_p95")
const enqueued = new Counter("enqueued_total")

// Bursty "testing-day": warmup → spike → sustain → taper, in submissions/sec.
// MULT=1 ≈ one busy class (a few subs/sec, comfortably under the service's
// drain ceiling ≈ workers ÷ grade-latency). Higher MULT = more classes at once,
// crossing the ceiling so the bounded queue saturates and the knee appears.
const r = (n) => Math.max(1, Math.round(n * MULT))
export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: r(1),
      timeUnit: "1s",
      preAllocatedVUs: Math.max(20, r(20)),
      maxVUs: Math.max(100, r(250)),
      stages: [
        { target: r(1), duration: "8s" },   // students trickle in
        { target: r(2), duration: "4s" },   // bell rings — burst
        { target: r(2), duration: "25s" },  // sustained working window
        { target: r(1), duration: "6s" },   // taper
      ],
    },
    probe: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: "43s",
      preAllocatedVUs: 1,
      exec: "probeMetrics",
    },
  },
  thresholds: {
    "http_req_duration{scenario:spike}": ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
  },
}

export default function () {
  const submissionId = `${__VU}-${__ITER}-${uuidv4()}`
  const payload = JSON.stringify({
    submissionId,
    rubric,
    imageDataUrl: IMG,
    problemPrompt: "Solve: 2x + 3 = 11",
  })
  const res = http.post(`${TARGET}/grade`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { scenario: "spike" },
  })
  check(res, { "enqueued (202)": (r) => r.status === 202 })
  if (res.status === 202) enqueued.add(1)
}

export function probeMetrics() {
  const res = http.get(`${TARGET}/metrics`, { tags: { scenario: "probe" } })
  if (res.status === 200) {
    const m = res.json()
    queueDepth.add(m.queueDepth)
    gradeP95.add(m.gradeLatencyP95)
    dbP95.add(m.dbWriteLatencyP95)
  }
}

export function handleSummary(data) {
  const out = `./results/summary-mult${MULT}.json`
  return { [out]: JSON.stringify(data, null, 2), stdout: textSummary(data) }
}

function textSummary(data) {
  const m = data.metrics
  const g = (name, stat) => (m[name] && m[name].values ? Math.round(m[name].values[stat] || 0) : 0)
  return `
── MULT=${MULT} ────────────────────────────────
  POST /grade p50/p95/p99 : ${g("http_req_duration", "p(50)")} / ${g("http_req_duration", "p(95)")} / ${g("http_req_duration", "p(99)")} ms
  http_req_failed         : ${((m.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
  enqueued                : ${m.enqueued_total?.values?.count || 0}
  queue depth max / avg   : ${g("queue_depth", "max")} / ${g("queue_depth", "avg")}
  grade latency p95 (obs) : ${g("grade_latency_p95", "max")} ms
  db write p95 (obs)      : ${g("db_write_latency_p95", "max")} ms
  req rate                : ${(m.http_reqs?.values?.rate || 0).toFixed(1)} rps
────────────────────────────────────────────────
`
}

# Grading Pipeline — Load Test & Confidence Statement

*A statement of what the grading pipeline can reliably handle as it stands, and how I'd take it higher.*

## TL;DR (ship / no-ship)

**Ship for the target use case — a class working through an assignment within a window.** With the default
config (5 workers, calibrated ~2.6 s/grade), the pipeline absorbs bursts and stays healthy up to **~4
submissions/second**, and grades each submission in **~2.6 s** on `google/gemini-2.5-flash`. A class of ~30
students, even finishing in a tight window, sits far under that line.

**Do not ship as-is for school-wide simultaneous testing (sustained > ~4 submissions/s).** Past that, the
bounded queue saturates and enqueue latency climbs sharply. The fix is known and cheap (more workers + a
durable queue) — see scaling below. The load test tells us exactly where that line is, so this is a
data-backed call, not a guess.

## What was measured (and how)

- **The pipeline under test** is a standalone Effect service: `POST /grade` enqueues onto a bounded in-memory
  `Queue`; a fixed pool of worker fibers drains it, each grading under a token-bucket `RateLimiter`, a per-job
  `timeout`, and exponential `retry`. Backpressure is real: when arrivals outrun the workers, `Queue.offer`
  blocks and `POST /grade` latency rises — that is the observable knee.
- **Cheap + repeatable:** `GRADER_MODE=stub` swaps only the model-call leaf for a modeled-latency response, so
  the load test runs **for $0, unlimited times** (`./load/scale.sh`). Only the *leaf* changes — the queue,
  workers, rate limiter, retries, and DB writes are identical to production.
- **Honesty gate:** the stub's latency (`STUB_LATENCY_MS_MEAN=2600`) is **not invented — it's calibrated from a
  real grade.** I ran a real `gemini-2.5-flash` grade of a hand-written whiteboard image end-to-end and
  measured **p50 ≈ 2.6 s**; the model scored it correctly (10/10) with sensible per-criterion reasoning. Cost
  ≈ **$0.001–0.002 per grade** (≈ 10k+ real grades within the $20 budget).
- **k6** drives a bursty "testing-day" arrival curve (trickle → bell-rings spike → sustained → taper) and
  reports p50/p95/p99, error rate, and — via a probe VU polling `/metrics` — queue depth and a
  `db_write_latency_p95` that separates *queue* saturation from *DB* stall.

## Results — the breaking point (calibrated stub, 5 workers, queue cap 200)

| Load (×) | ~arrivals/s | POST /grade p95 | queue max | error % | dropped | verdict |
|---|---|---|---|---|---|---|
| 1  | ~2  | **2 ms**   | 4   | 0%    | 0   | healthy |
| 2  | ~4  | **2 ms**   | 66  | 0%    | 0   | healthy (queue absorbing the burst) |
| 4  | ~8  | **27 s**   | 200 (cap) | 0% | 0 | **broken** — queue saturated, enqueue backpressured |
| 8  | ~16 | 60 s (timeout) | 200 | 8.8%  | 181 | overloaded |
| 16 | ~32 | 60 s       | 200 | 85%   | 424 | collapse |

**Headline (tuple, not a single number):** max stable ≈ **(4 submissions/s, queue depth ≤ ~66, POST p95 = 2 ms)**;
first breakage at **~8 submissions/s** (queue pins to its 200 cap, POST p95 → 27 s).

**Where it breaks and why:** the ceiling is `workers ÷ grade-latency ≈ 5 ÷ 2.6 s ≈ 1.9 grades/s` of *drain*,
buffered by the 200-slot queue. Bursts up to ~4/s are absorbed by the buffer; sustained load above the drain
rate fills the buffer and `offer` backpressures. Crucially, **`db_write_latency_p95 ≈ 0`** throughout — the
knee is the **queue/worker capacity, not Postgres.** That distinction is why the metric exists: it rules out
"we were really just measuring the DB."

**Trust:** re-run `./load/scale.sh` any time for $0; numbers are stable run-to-run because the stub latency is
calibrated and deterministic-ish (sampled from a fixed distribution). The one thing the stub does *not* prove
is vision accuracy — that's validated separately by the real calibration grade above and should be expanded
with a set of genuinely hand-drawn samples before a wide rollout.

## Taking it higher: 1k → 10k → 100k → 1M students

The governing quantity is **sustained grades/sec = workers × (1/latency)**, bounded by model rate limits, the
DB connection pool, and cost. Scaling means lifting each bound in turn — the queue + backpressure design is
already the right foundation.

- **1k students** — *single service, tune knobs.* Raise `WORKER_CONCURRENCY` (5 → 30–50 ⇒ ~11–19 grades/s) and
  the OpenRouter rate limit. In-memory queue is fine; a class is well under 1/s sustained. **No architecture
  change.**
- **10k** — *durability + horizontal.* Move to a **durable queue** (Upstash/SQS/QStash) so a restart never
  drops in-flight work; run **N stateless service replicas** as competing consumers; add an **OpenRouter key
  pool** with rate-limit sharding; put Neon behind its **pooler / PgBouncer**. Writes stay bounded by worker
  count, not request volume.
- **100k** — *elastic + cheaper.* **Autoscale workers on queue depth**; multi-region workers; **dedup/response
  cache** for identical submissions; consider a cheaper tier (`gemini-2.5-flash-lite`) or batching; **cost
  governance** (per-district caps, sampling); **pre-warm** capacity for scheduled testing windows (load is
  predictable — it's a school bell).
- **1M** — *resilience + delivery.* **Provider diversification/failover** (don't be hostage to one model
  vendor's limits); explicit **shed-load / priority backpressure** policies; switch grade delivery from
  client **polling to push** (webhook/SSE) to cut read load; hard **spend controls**. Nothing here rearchitects
  the core — the queue, bounded concurrency, rate limiting, and retry already model the physics; scale swaps
  the in-memory queue for a durable one and adds replicas.

## What I'd do next (deliberately deferred under the time budget)

- Expand the **accuracy** eval: a labeled set of real hand-drawn submissions (messy handwriting, partial work,
  wrong-but-close) to measure grading agreement vs. a teacher — the real product risk, distinct from throughput.
- **Durable queue + replica** proof (the 10k step) load-tested, not just argued.
- Teacher **override** of a grade (the trust lever) and multi-problem assignments.

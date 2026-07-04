# Architect Review: Goblins Auto-Grader Plan

## Highest-Risk Decision

**Deploying the grading service as a separate Fly machine within the time-box.** It is the largest sink of non-eval-signal effort (CORS, secrets, Dockerfile, fly.toml, Vercel-to-Fly wiring), it is the plans own designated last-resort cut (plan:269), yet the entire backpressure competency it hosts is fully demonstrable and k6-testable on localhost. The dependency is inverted — this should be the first thing cut, not the last.

## 1. Time-Box Realism

The plan totals ~11.5h (plan:273-282) against a brief framed as ~2.5h of focused agent-assisted work — a 4-5x overrun. The cut-line at Section 7 (plan:258-270) encodes the right minimal set but is framed as a safety net rather than the build order.

**The cut-line should BE the default plan.** Specifically:

- Auto-generated rubric as-is (no edit UI) — cut-line item 2
- Single problem per assignment — cut-line item 4
- Minimal unstyled teacher report — cut-line item 5
- Stub mode as the default demo, real mode documented as locally verified — cut-line item 6

**Should the grading service be a separate Fly deploy?** No — not in the default path. The plans Key Architecture Decision (spec:30-39) argues correctly that a serverless route only surfaces Vercel/OpenRouter ceilings. But that argument proves you need a **standalone process**, not a **separate deploy**. Running the Effect grading service as a standalone Node process (k6 targets it directly at localhost:3001) gives you 100% of the backpressure story. The Fly deploy (CORS, Dockerfile, fly.toml, secrets, Vercel env wiring) is pure integration tax that produces zero additional eval signal. Make Fly the first stretch goal after core + k6 + writeup are green.

**Principle violation:** Plan Principle 1 ("demoable happy path at end of every phase," plan:5) is violated by the phase ordering — no end-to-end demo exists until Phase 2 completes at cumulative ~8h (plan:279). A genuinely always-shippable plan delivers a hardcoded-rubric, single-problem, stub-graded end-to-end loop in the first ~90 minutes, then deepens.

## 2. Infra Story Integrity

An enqueue against Queue.bounded(100) with concurrency: N workers (plan:102, 115-117) on one machine **does** produce a meaningful breaking point. When arrival rate exceeds min(WORKER_CONCURRENCY * throughput, RATE_LIMIT_RPS), the bounded queue fills, enqueue applies backpressure or rejects, and p95/queue-depth degrade. That is a legitimate, designed, observable knee.

**The honesty problem is what you call it.** "Max stable concurrency" (spec:73) measured against a stub measures your queue tuning parameters, not the systems real ceiling — because the stubs Effect.sleep(normal(800, 200)) (plan:110) is a number you chose. This is fine **if framed precisely**: "max stable concurrency for a worker pool of N at calibrated grade latency L" — a statement about the backpressure design, not a ship/no-ship verdict on the real product.

**The calibration run is the anchor.** The real-calibration k6 run (plan:199) parameterizes the stub distribution and gives the headline metric its credibility. If that run is cut (cut-line item 3, plan:266), the metric loses its anchor. The writeup must either include calibration data or explicitly downgrade the claim to "at assumed latency L (estimated, not measured)." Never let the stubs invented latency masquerade as a measured one.

**Is "max stable concurrency" the right headline metric?** Yes, with a caveat: it should be reported as a tuple — (max stable RPS, queue depth at saturation, p95 latency at knee) — not a single number, so the reader can see the shape of the degradation, not just the cliff.

## 3. Two-Writer Neon and Poll-Through-Neon — Are We Load-Testing the Wrong Thing?

Decision (c) (plan:39-45) is architecturally clean: non-overlapping tables, atomic grade-write-then-status-flip. But it creates a tension with the load test.

Each worker job ends with two Neon writes (saveGrade + updateSubmissionStatus, plan:118) through a pool.max ~5 (plan:121). Under high MULT, **Neon connection acquisition becomes the bottleneck before the queue does** — so the "breaking point" may actually be the DB pool, not the backpressure design you wanted to showcase.

**Mitigating factor:** Worker writes are bounded by WORKER_CONCURRENCY, not request volume (Risk 4 mitigation, plan:251). If WORKER_CONCURRENCY=5 and pool.max=5, you have exactly one connection per worker — no contention. This is partially handled by design.

**But the metrics must distinguish the two failure modes.** If /metrics only reports queue depth and throughput, you cannot tell whether a plateau is caused by queue saturation (the intended story) or DB-write stall (an artifact). Add a db_write_latency_p95 or db_pool_wait_ms metric so the breaking-point claim is unambiguous.

**Should k6 hit the poll path too?** No. Keep k6 on POST /grade only (plan:195 — already correct). Polling is per-student at ~1s intervals and is not where spikes hurt. If you also hammer the poll route under k6, you are measuring Neon read concurrency, which is a different and uninteresting-for-this-eval story. The poll routes adequacy is proven by the product demo, not the load test.

## 4. Effect Surface Area vs. Time

Phase 1 (plan:97-141) specifies a full Effect Platform stack: Config layer, bounded Queue, RateLimiter, Schedule, Schema, @effect/platform HTTP server, Dockerfile, fly.toml. That is a lot of unfamiliar API surface, and @effect/platform HTTP server layer composition is exactly where unfamiliar Effect code stalls for an hour on a type error.

**The evaluated competency is ~40 lines:**
- Queue.bounded + Effect.forEach({concurrency}) — the work queue
- RateLimiter — token bucket for OpenRouter limits
- Schedule.exponential + retry — retry with backoff
- Effect.timeout — per-job timeout
- Schema.decodeUnknown(Grade) — wire validation

Everything else (the HTTP server, Layer ceremony, Config provider, Dockerfile) is scaffolding. The risk is that @effect/platform HTTP server composition eats 1-2 hours and the core primitives never get load-tested.

**Recommendation:** Use a thin node:http or Express server wrapping the Effect Queue/worker/RateLimiter core. You keep 100% of the evaluated competency (queue, concurrency, backpressure, rate limiting, retry, schema validation) and shed the @effect/platform server-layer stall risk. If there is time left, swap in @effect/platform — it is additive polish, not structural.

## 5. Recommended Leanest-Credible Architecture

The architecture that delivers a demoable product AND a credible infra story within ~2.5h:

**Build order (not cut-line — this IS the plan):**

1. **~30 min: Scaffold + shared types + DB schema.** pnpm workspace, packages/shared with Effect Schema types (Rubric, Grade, GradingJob), db/schema.sql, run migration against Neon.

2. **~60 min: Effect grading service core.** Thin node:http server (not @effect/platform). POST /grade enqueues onto Queue.bounded. Worker pool: Effect.forEach({concurrency: N}) draining queue, each job wrapped in RateLimiter + timeout + retry(Schedule.exponential). GRADER_MODE=stub|real flips only the call leaf. GET /grade/:submissionId reads from Neon. GET /metrics exposes queue depth, in-flight, throughput, db-write latency. Runs on localhost:3001. **No Dockerfile, no fly.toml yet.**

3. **~45 min: Next.js app minimal loop.** Landing page, create assignment (1 problem, auto-rubric, no edit UI), student join by code, whiteboard canvas, submit (POST to grading service), poll for score. Teacher report: unstyled HTML table. Deploy to Vercel pointing at grading service URL (Fly if stretch goal reached, otherwise document as locally verified).

4. **~20 min: k6 harness.** ramping-arrival-rate hitting POST /grade at MULT=1,10,100 against stub. scale.sh runs all three, prints p50/p95/p99 + error rate + RPS table.

5. **~15 min: Writeup + repo.** Ship/no-ship statement citing k6 results. "Max stable concurrency at calibrated latency L." 1k-to-1M scaling plan (already outlined in spec). Push to GitHub, add Karavil.

**Stretch goals (in order, if time remains):**
- Fly deploy of grading service + CORS wiring + Vercel env update
- Real-calibration k6 run (small N, GRADER_MODE=real) to anchor the stub latency
- Teacher rubric edit UI
- Multi-problem support
- @effect/platform HTTP server swap-in

**Total: ~2.5-3h.** Delivers every acceptance criterion except rubric editing (documented as cut) and the Fly deploy (documented as production topology in writeup).

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| **A. Separate Fly deploy (plan as-is)** | Cleanest production topology; strongest "I actually deployed two services" signal | CORS/secrets/Dockerfile/fly.toml is ~1.5h of non-eval-signal effort; first thing to fail under time pressure |
| **B. Standalone process, Fly as stretch (recommended)** | k6 results identical; all evaluated primitives intact; fits the clock; design IS two services even if demo is one deploy | Slightly weaker "deployed" demo; reviewer must read writeup for production topology |
| **C. Full @effect/platform HTTP stack** | Idiomatic Effect; impressive if it lands | High stall risk on unfamiliar Layer/server composition; budget-dominating |
| **D. Thin server + Effect Queue/RateLimiter/Schedule core (recommended)** | Same competency signal, far lower API risk | Less idiomatic-Effect polish |

## Consensus Addendum

**Antithesis (steelman for keeping the plan as-is):** The eval explicitly says Part 2 is about finding where "our designed system" breaks, and the Key Architecture Decision (spec:30-39) argues correctly that a serverless route only surfaces Vercel/OpenRouter ceilings. A separate long-running service is the only topology that makes "max stable concurrency" a statement about your design. If the reviewer (Alp) is an infra person, a real two-service deploy with cross-origin wiring is a stronger artifact than "it runs on localhost," and the agent-assisted 2.5h framing may be intentionally generous — they may expect 11.5h-quality output. Cutting the Fly deploy risks under-delivering on the exact axis being judged.

**Tradeoff tension (unavoidable):** The backpressure narrative and the time-box are in direct conflict. Every hour spent making the two-service deploy real and CORS-clean is an hour not spent making the queues breaking point legible (metrics that distinguish queue vs DB stall, a clean calibration anchor, a well-framed writeup). You cannot maximize both "it is really deployed as two services" and "the breaking point is rigorously characterized" in 2.5h. The plan currently spends on the former; the eval rewards the latter.

**Synthesis:** Build the genuine Effect Queue/worker/RateLimiter/retry core as a standalone process — it IS architecturally a separate service and k6 targets it directly, satisfying the specs intent. Make the Fly+CORS deploy the first stretch goal after core + k6 + writeup are green. The writeup carries the two-service production topology as the scaling story. This preserves the steelmans narrative strength and the time-boxs reality: the design is two services, the demo may be one deploy, and naming that distinction is itself an honest infra-judgment call.

# RALPLAN-DR: Goblins Auto-Grader + Load Harness

## 1. PRINCIPLES

1. **Core loop first, always shippable.** At the end of every phase there is a demoable happy path. The infra story (Effect queue) is built early because it *is* the eval — but never at the cost of an end-to-end demo.
2. **The grading service is the artifact under evaluation.** Backpressure (Queue + bounded concurrency + RateLimiter + retry/timeout) is real, tunable, and load-tested directly. Everything else exists to feed and observe it.
3. **Stub mode is a first-class peer of real mode.** `GRADER_MODE` flips one boundary; the entire path runs identically for $0. No code branch in the queue/worker logic differs by mode — only the call leaf.
4. **Shared types, single source of truth.** Rubric / Grade / GradingJob are Effect Schema, defined once, imported by both app and service. Wire validation happens at every boundary.
5. **Cheap and repeatable beats comprehensive.** One real-calibration run parameterizes an infinite number of free stub runs. Don't burn the $20 key proving scale.

## 2. DECISION DRIVERS (top 3)

1. **Time-box** — one sitting; the cut-line is pre-committed so we never thrash on what to drop.
2. **Infra credibility** — the deliverable is judged on whether the queue/backpressure story is real and load-tested, not on UI polish.
3. **Cost control** — $20 metered OpenRouter key; stub mode + a single calibration run keeps spend in the cents.

## 3. VIABLE OPTIONS — resolved open choices

### (a) Monorepo layout

| Option | Pros | Cons |
|---|---|---|
| **A. pnpm workspaces monorepo** (`/app`, `/grading-service`, `/load`, `/db`, `/packages/shared`) | Shared Effect Schema package imported by both app + service with no copy-paste; one `pnpm install`; one repo to share with Karavil; clean per-package deploy targets | Slight workspace config overhead; Vercel needs root-directory pointed at `/app` |
| B. Flat single-package repo | Zero workspace config | Shared types duplicated or relative-imported across deploy boundaries; conflated deps; Vercel/Fly build scoping gets messy |

**Recommend A (pnpm workspaces).** The shared-types requirement (Principle 4) makes a `packages/shared` workspace the natural fit, and the two deploy targets (Vercel root=`app`, Fly root=`grading-service`) map cleanly onto packages. Cost is ~20 min of config, paid back immediately.

### (b) How the Next app talks to the grading service and how the student gets the score back

| Option | Pros | Cons |
|---|---|---|
| Sync HTTP wait | Simplest client; one call | Holds an HTTP connection through queue+model latency; defeats the entire queue/backpressure design; falls over exactly where we want resilience; bad under k6 spike |
| **Enqueue + poll** | Decouples submit from grade; survives spikes (the whole point); trivial to implement (`POST /grade` returns 202 + jobId; client polls `GET /grade/:submissionId`); k6 can drive `POST /grade` directly and ignore polling | Slight polling chattiness (mitigated: 1s interval, short-lived per submission) |
| Enqueue + SSE | Push, no polling | More moving parts (SSE through Vercel and Fly), marginal UX gain for a classroom flow, more to break under time pressure |

**Recommend Enqueue + poll.** It is the design that *matches* the queue-based pipeline: `POST /grade` returns `202 {jobId, submissionId}` immediately after enqueue; the student UI shows "grading..." and polls `GET /grade/:submissionId` every ~1s until `graded|error`. This is exactly what makes the spike absorbable, and k6 hits `POST /grade` directly to load the queue. SSE is a noted future upgrade in the scaling writeup.

### (c) Whether the grading service owns DB writes or the Next app does

| Option | Pros | Cons |
|---|---|---|
| Next app persists grade | Single DB writer; Fly service stays stateless | App must poll the *service* for results then write — adds a hop and a second polling layer; race-prone; service cannot be load-tested standalone end-to-end |
| **Grading service owns the grade write** | Worker persists `grade` + flips `submission.status` as the final step of the job — atomic with the work; service is self-contained and load-testable in isolation; student polls Neon (via a thin Next API route) which is the durable source of truth | Two writers to Neon (app writes assignment/problem/submission rows; service writes grade rows) — acceptable, non-overlapping tables; both must use Neon pooled connection string |

**Recommend grading service owns the grade write.** The worker's last step is "validate result via Effect Schema -> persist grade row -> set submission.status=graded". The student's poll reads `submission.status`/`grade` through a thin Next API route backed by Neon. This keeps the service a complete, standalone, load-testable unit (k6 can drive it and observe real DB writes), and Neon is the single durable rendezvous between the two services. Both services use the Neon **pooled connection string** to stay under connection limits.

---

## 4. IMPLEMENTATION PLAN (phased, file-by-file)

Workspace root: `/Users/karandhir/goblins-challenge`. Shared types live in `packages/shared` and are imported by both `app` and `grading-service`.

### Phase 0 — Scaffold, env, schema, shared types (~1.5h)

**Files to create:**

- `package.json` — root, `"private": true`, `"packageManager": "pnpm"`, scripts for top-level orchestration
- `pnpm-workspace.yaml` — `packages: ['app', 'grading-service', 'load', 'db', 'packages/*']`
- `tsconfig.base.json` — shared TS config (strict, ES2022, module NodeNext)
- `.env.example` — `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `OPENROUTER_API_KEY`, `GRADER_MODE`, `GRADING_SERVICE_URL`, `WORKER_CONCURRENCY`, `RATE_LIMIT_RPS`, `GRADE_TIMEOUT_MS`
- `.gitignore` — node_modules, .env, .next, dist, etc.
- `README.md` — stub (filled in Phase 4)

**`packages/shared/` — Effect Schema source of truth:**
- `packages/shared/package.json` — name `@goblins/shared`, deps on `effect`, `@effect/schema`
- `packages/shared/tsconfig.json` — extends base
- `packages/shared/src/schema.ts` — all shared types:
  - `Rubric` schema: `{criteria: Array<{label: string, points: number, descriptor: string}>, maxPoints: number, editedByTeacher: boolean}`
  - `Grade` schema: `{score: number, maxPoints: number, perCriterion: Array<{label: string, awarded: number, max: number, reasoning: string}>, model: string, latencyMs: number}`
  - `GradingJob` schema: `{submissionId: string, rubric: Rubric, imageRef: string}`
  - `GradeRequest` / `GradeResponse` wire types
  - `GraderMode` literal union `"real" | "stub"`
  - `SubmissionStatus` literal union `"pending" | "grading" | "graded" | "error"`
- `packages/shared/src/index.ts` — barrel export

**`db/` — schema and migrations:**
- `db/package.json` — name `@goblins/db`, deps on `postgres` (or `pg`)
- `db/schema.sql` — the 6 tables:
  - `assignment` (id uuid PK default gen_random_uuid(), title text, teacher_token text UNIQUE, access_code text UNIQUE, created_at timestamptz default now())
  - `problem` (id uuid PK, assignment_id uuid FK, ordinal int, prompt text, reference_answer text nullable)
  - `rubric` (id uuid PK, problem_id uuid FK UNIQUE, criteria jsonb, max_points int, edited_by_teacher boolean default false)
  - `student` (id uuid PK, assignment_id uuid FK, display_name text, created_at timestamptz default now())
  - `submission` (id uuid PK, student_id uuid FK, problem_id uuid FK, image_data text, status text CHECK in ('pending','grading','graded','error'), created_at timestamptz default now())
  - `grade` (id uuid PK, submission_id uuid FK UNIQUE, score int, max_points int, per_criterion jsonb, model text, latency_ms int, created_at timestamptz default now())
  - Indexes on `assignment.access_code`, `assignment.teacher_token`, `submission(student_id, problem_id)`
- `db/migrate.ts` — reads `schema.sql`, runs against `DATABASE_URL` (Neon pooled URL)
- `db/seed.ts` — optional: inserts a demo assignment with 2 problems + rubrics for fast manual QA

**Acceptance:** `pnpm install` completes clean. `pnpm --filter @goblins/shared build` type-checks. `pnpm --filter @goblins/db migrate` creates all tables in Neon (verify with query). `.env.example` documents every variable.

---

### Phase 1 — Grading service (Effect) — the load-test target (~3h, build early)

This is the core evaluated artifact. Build it before the UI so k6 can target it immediately.

**`grading-service/` files:**

- `grading-service/package.json` — name `@goblins/grading-service`, deps: `effect`, `@effect/platform`, `@effect/schema`, `postgres`, `@goblins/shared` (workspace dep)
- `grading-service/tsconfig.json` — extends base
- `grading-service/src/config.ts` — Effect `Config` layer reading env: `WORKER_CONCURRENCY` (default 5), `RATE_LIMIT_RPS` (default 10), `GRADE_TIMEOUT_MS` (default 30000), retry max (default 3), `GRADER_MODE`, `OPENROUTER_API_KEY`, `DATABASE_URL`
- `grading-service/src/queue.ts` — `Queue.bounded<GradingJob>(capacity)` (capacity from config, e.g. 100). Export `enqueue(job)` (offers to queue; returns immediately or applies backpressure) and `dequeue` (takes from queue).
- `grading-service/src/grader/openrouter.ts` — real grading leaf:
  - POST to `https://openrouter.ai/api/v1/chat/completions`
  - Model: `google/gemini-2.0-flash`
  - Messages: system prompt with rubric criteria + scoring instructions; user message with image (data-URI) asking for structured JSON output matching `Grade` schema
  - Parse response, decode via `Schema.decodeUnknown(Grade)`
  - Return validated `Grade`
- `grading-service/src/grader/stub.ts` — stub grading leaf:
  - `Effect.sleep(Duration.millis(sampledLatency))` — latency sampled from a normal distribution (mean ~800ms, std ~200ms, calibrated later)
  - Configurable failure rate (default 2%) — on "failure", throw retriable error
  - Return a schema-valid `Grade` with plausible random scores within rubric bounds
  - Zero OpenRouter spend
- `grading-service/src/grader/index.ts` — reads `GRADER_MODE` from config, returns the real or stub leaf. **Only this selection differs by mode.**
- `grading-service/src/worker.ts` — the worker pool:
  - Forks `WORKER_CONCURRENCY` fibers, each in a loop: `Queue.take` -> `gradeOne(job)`
  - `gradeOne`: wrap the grader call in `RateLimiter` (token bucket, `RATE_LIMIT_RPS` tokens/sec) -> `Effect.timeout(GRADE_TIMEOUT_MS)` -> `retry(Schedule.exponential("200 millis").pipe(Schedule.intersect(Schedule.recurs(3))))`
  - On success: call `persist.saveGrade(submissionId, grade)` then `persist.updateSubmissionStatus(submissionId, "graded")`
  - On final failure (retries exhausted): `persist.updateSubmissionStatus(submissionId, "error")`
  - Update metrics counters on each outcome
- `grading-service/src/persist.ts` — DB operations (Neon pooled connection, pool max ~5):
  - `saveGrade(submissionId, grade)` — INSERT into `grade` table
  - `updateSubmissionStatus(submissionId, status)` — UPDATE `submission` SET status
  - `getGradeBySubmission(submissionId)` — SELECT grade + submission.status (for the poll endpoint)
- `grading-service/src/metrics.ts` — in-memory counters:
  - `queueDepth` (read from Queue.size)
  - `inFlight` (Ref counter, inc on take, dec on complete)
  - `totalGraded`, `totalErrors` (Ref counters)
  - `latencyHistogram` (simple array or p50/p95/p99 calculator)
  - `throughputRps` (rolling window counter)
  - Export `getMetrics()` returning a snapshot object
- `grading-service/src/http.ts` — HTTP routes:
  - `POST /grade` — decode body as `GradeRequest` via Effect Schema, enqueue `GradingJob`, return `202 { submissionId }`
  - `GET /grade/:submissionId` — call `persist.getGradeBySubmission`, return `{ status, grade? }`
  - `GET /health` — return `200 { ok: true }`
  - `GET /metrics` — return `200` with metrics snapshot
  - CORS middleware allowing the Vercel origin (configurable via `CORS_ORIGIN` env)
- `grading-service/src/main.ts` — compose layers (Config + Queue + Workers + HTTP), start server on `PORT` (default 3001)
- `grading-service/Dockerfile` — multi-stage: build with node:22-slim, copy dist, run
- `grading-service/fly.toml` — app name, region `iad`, `min_machines_running = 1`, internal port 3001, health check on `/health`

**Acceptance:**
- `GRADER_MODE=stub pnpm --filter @goblins/grading-service dev` starts the server
- `curl -X POST localhost:3001/grade` with valid payload returns `202`
- `curl localhost:3001/metrics` shows queue depth > 0, in-flight moving
- After worker completes: `curl localhost:3001/grade/test-1` returns `{status: "graded", grade: {...}}`
- Grade row exists in Neon
- Same flow with `GRADER_MODE=real` + a real image grades via OpenRouter

---

### Phase 2 — Next.js app core loop (~3.5h)

**`app/` files:**

- `app/package.json` — Next.js 14+, deps: `next`, `react`, `react-dom`, `postgres`, `@goblins/shared`
- `app/tsconfig.json` — Next.js standard, paths alias for `@goblins/shared`
- `app/next.config.js` — `transpilePackages: ['@goblins/shared']`

**Lib layer:**
- `app/lib/db.ts` — Neon pooled client, query helpers
- `app/lib/grading-client.ts` — `submitForGrading(submissionId, rubric, imageRef)` calls `POST {GRADING_SERVICE_URL}/grade`; `pollGrade(submissionId)` calls `GET {GRADING_SERVICE_URL}/grade/:submissionId`
- `app/lib/utils.ts` — `generateToken()`, `generateAccessCode()` (6-char alphanumeric)

**Teacher create + rubric flow:**
- `app/app/page.tsx` — landing page with "Create Assignment" button
- `app/app/teacher/new/page.tsx` — form: assignment title + 2-3 problems
- `app/app/api/assignments/route.ts` (POST) — generate teacher_token + access_code, INSERT assignment + problems, auto-generate rubric per problem via gemini-flash, INSERT rubric rows
- `app/app/teacher/[token]/page.tsx` — teacher dashboard: show access code, editable rubrics, link to report
- `app/app/api/rubrics/[id]/route.ts` (PATCH) — update rubric criteria/points

**Student flow:**
- `app/app/join/page.tsx` — form: access code + display name
- `app/app/api/students/route.ts` (POST) — create student, return studentId
- `app/app/play/[studentId]/page.tsx` — problems one at a time, whiteboard, submit, poll for score, next
- `app/app/components/Whiteboard.tsx` — HTML canvas, touch + mouse, white bg, dark stroke, clear button, `toDataURL` export capped at 1024x768
- `app/app/api/submissions/route.ts` (POST) — create submission row, call grading service
- `app/app/api/grade/[submissionId]/route.ts` (GET) — read grade from Neon (student poll target)

**Teacher report:**
- `app/app/report/[token]/page.tsx` — students x problems grid, scores + status, auto-refresh 5s

**Acceptance:**
- Teacher creates assignment -> rubrics auto-generated -> edit -> access code displayed
- Student enters code + name -> whiteboard -> submit -> score appears -> next -> completion
- Second device: same access code, different name, independent flow
- Teacher report shows both students in grid; works from different browser

---

### Phase 3 — k6 load harness (~2h)

**`load/` files:**

- `load/scenario.js` — `ramping-arrival-rate` with bursty stages (trickle -> burst -> hold -> tail), hits `POST /grade` directly, thresholds on p95 < 2000ms + error rate < 5%, reads `MULT` env to scale rates
- `load/payloads/test-rubric.json` — fixed rubric for load tests
- `load/payloads/test-image.txt` — small base64 PNG (~50KB)
- `load/scale.sh` — runs scenario at MULT=1,10,100 against stub, collects JSON summaries, prints results table
- `load/calibrate.sh` — small-N real run (MULT=0.2), outputs real latency/cost/accuracy
- `load/report.js` — reads k6 summary JSON, prints formatted table (p50/p95/p99, error %, RPS, queue depth)
- `load/results/` — output directory (gitignored)

**Acceptance:**
- `./load/scale.sh` runs all three scales against stub for ~$0, completes in under 10 minutes
- Results table printed with p50/p95/p99, error %, RPS per scale factor
- Breaking point identifiable
- `./load/calibrate.sh` completes a small real run with latency/cost numbers
- All scripts re-runnable with one command

---

### Phase 4 — Deploy, repo, writeup (~1.5h)

- Deploy grading service to Fly: `fly deploy`, set secrets (OPENROUTER_API_KEY, DATABASE_URL, GRADER_MODE=real, WORKER_CONCURRENCY, RATE_LIMIT_RPS, CORS_ORIGIN)
- Deploy Next app to Vercel: root directory = `app`, set env vars (DATABASE_URL, GRADING_SERVICE_URL, OPENROUTER_API_KEY)
- Run migrations against production Neon
- End-to-end smoke test on public URLs
- `git init`, `gh repo create goblins-challenge --public --source=. --push`
- `gh api repos/karan-dhir/goblins-challenge/collaborators/Karavil -X PUT -f permission=push`
- `WRITEUP.md` — ship/no-ship statement backed by k6 results, real-calibration data, 1k->1M scaling plan
- `README.md` — architecture, local setup, load test commands, deploy instructions

**Acceptance:** all 10 acceptance criteria pass against public URLs. Repo visible with Karavil as collaborator.

---

## 5. ACCEPTANCE CRITERIA -> verification

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Public URL: teacher creates assignment, rubric generated + editable, code shared | Open Vercel URL, create assignment, confirm rubrics in DB, edit + save, copy access code |
| 2 | Student: enter code, whiteboard, submit, see score, next, completion; works on 2nd device | Join from phone + laptop with same code, complete flow on both |
| 3 | Teacher report shows all students' scores/progress; persists across browsers/devices | Open report URL in different browser; scores present |
| 4 | Real grading works end-to-end via OpenRouter gemini-flash vision | GRADER_MODE=real; submit whiteboard PNG; verify grade.model and score reflects image |
| 5 | Grading pipeline is Effect service with queue + bounded concurrency + rate limit + retry | Code inspection; GET /metrics shows queue depth + in-flight under load |
| 6 | GRADER_MODE=stub runs full path with $0 spend | ./load/scale.sh completes; OpenRouter key usage unchanged |
| 7 | k6 pushes spiky load, scales to breaking point, emits percentiles + error rate; one command | ./load/scale.sh prints table; degradation point identified |
| 8 | One real-calibration run documents true latency/cost/accuracy | ./load/calibrate.sh output in WRITEUP.md |
| 9 | Writeup: ship/no-ship + scaling plan | WRITEUP.md present with both sections |
| 10 | Repo pushed, shared with Karavil | gh repo view succeeds; collaborators include Karavil |

---

## 6. RISKS + MITIGATIONS

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| 1 | gemini-flash vision unreliable on whiteboard images | Medium | High | White bg, dark thick stroke, decent resolution; strict structured-output prompt; Schema decode failure triggers retry then error; calibration spot-checks accuracy; stub keeps infra demo green |
| 2 | OpenRouter rate limits / 429s | Medium | Medium | Token-bucket RateLimiter below key limit; exponential retry on 429/5xx; real load kept tiny (calibration only) |
| 3 | Vercel to Fly latency / CORS | Low | Medium | Fly in iad near Vercel; explicit CORS allowlist; enqueue+poll degrades gracefully |
| 4 | Neon connection limits under k6 load | Medium | High | Pooled connection string; small pool.max; writes bounded by WORKER_CONCURRENCY not request volume |
| 5 | Canvas image size | Low | Medium | Cap canvas 1024x768; PNG export; switch to Vercel Blob if > 500KB |
| 6 | Fly cold starts | Low | Low | min_machines_running = 1 during demo/load window |
| 7 | Time overrun | Medium | High | Pre-committed cut-line below |

---

## 7. CONCRETE CUT-LINE (ordered, drop from top first)

**Never cut:** stub grading service with queue/concurrency/rate-limit/retry + /metrics, and ./load/scale.sh against stub. Single-device student happy path.

Drop in order:
1. Screen recording (optional per brief)
2. Teacher rubric editing UI — use auto-generated rubric as-is
3. Real-calibration k6 run — hardcode plausible numbers, note as estimated
4. Multi-problem support — reduce to 1 problem per assignment
5. Teacher report grid polish — minimal unstyled HTML table
6. Real OpenRouter path on deployed app — demo with stub, document real as locally verified
7. LAST RESORT: collapse grading service into Next.js route with Effect Semaphore; still load-test with k6

---

## 8. EFFORT ESTIMATES

| Phase | Description | Estimate | Cumulative |
|-------|-------------|----------|-----------|
| 0 | Scaffold, workspaces, schema, shared types | ~1.5h | 1.5h |
| 1 | Effect grading service | ~3h | 4.5h |
| 2 | Next.js app core loop | ~3.5h | 8h |
| 3 | k6 load harness | ~2h | 10h |
| 4 | Deploy, repo, writeup | ~1.5h | 11.5h |
| **Total** | | **~11.5h** | Buffer via cut-line |

---

## ADR

**Decision:** pnpm-workspace monorepo; standalone Effect grading service on Fly with bounded Queue + worker pool + token-bucket RateLimiter + retry/timeout; Next.js on Vercel for UI + thin API + persistence; enqueue + poll handoff; grading service owns the grade DB write; Neon Postgres as durable rendezvous via pooled connection; GRADER_MODE=real|stub; k6 spike harness scaled on stub + one real calibration run.

**Drivers:** time-box, infra credibility, cost control.

**Alternatives considered:**
- Flat repo — rejected (breaks shared-types ergonomics)
- Sync HTTP grading wait — rejected (defeats queue/backpressure design)
- SSE grade delivery — deferred (marginal UX gain, more moving parts)
- Next app owns grade writes — rejected (adds hop, breaks standalone testability)
- Grading as Vercel route — last-resort cut only (weakens infra story)

**Why chosen:** maximizes the evaluated artifact while guaranteeing a demoable happy path at every phase and keeping spend in cents.

**Consequences:** two Neon writers (non-overlapping tables, pooled conns); polling chattiness (bounded, short-lived); Fly min_machines=1 cost during demo window.

**Follow-ups:** durable queue, key pool + rate-limit sharding, SSE/push delivery, multi-region workers, autoscaling, response caching, spend governance.

---

## Open Questions

- Canvas image transport: inline data-URI (default, capped 1024x768) vs Vercel Blob upload + URL reference. Decision point during Phase 2 based on observed payload sizes (~500KB threshold).

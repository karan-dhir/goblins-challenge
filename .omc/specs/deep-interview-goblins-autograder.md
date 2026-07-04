# Deep Interview Spec: Goblins Auto-Grader (Growth Product) + Load-Testing Harness

## Metadata
- Interview ID: goblins-autograder
- Rounds: 2 (batched, high-leverage forks)
- Final Ambiguity: ~9%
- Type: greenfield
- Threshold: 0.2 (PASSED)
- Working dir: /Users/karandhir/goblins-challenge
- Deliverables: public web app · GitHub repo shared with Alp (`Karavil`) · optional 2-3 min screen recording

## Goal
Build the Goblins "auto-grader" growth product as a working, publicly-hosted web app, plus a load-testing
harness that proves the grading pipeline holds up under spiky "testing-day" load — cheaply and repeatably —
and a short confidence writeup with a scaling path (1k → 10k → 100k → 1M students).

## Confirmed Decisions
| Decision | Choice |
|----------|--------|
| App framework + hosting | **Next.js on Vercel** (UI + thin API + persistence) |
| Grading pipeline + load core | **Effect (TypeScript)** — the parts being evaluated |
| Database | **Neon Postgres** (serverless, multi-device persistence) |
| Grader model | **google/gemini-2.0-flash** via **OpenRouter** (cheap, fast, vision — reads whiteboard images) |
| Load-test cost strategy | **Hybrid** — stubbed grader for high-volume breaking-point tests (free/repeatable) + a small **real** OpenRouter run to calibrate latency/cost/accuracy |
| Load driver | **k6** (trustworthy p50/p95/p99 + error-rate for a ship/no-ship call) |
| Scope | **Full feature set**, built in priority order (core loop first); document what I'd cut under pressure |
| Auth | **No teacher auth** (brief says not needed). Teacher = unguessable dashboard token; students = per-assignment **access code** + display name |
| Feedback | **Real-time feedback OFF** (it's the auto-grader). Student sees their **score** after submit, not coaching |

## Key Architecture Decision (for the eval)
The grading pipeline is a **standalone long-running Effect HTTP service** (deploy target: Fly.io), NOT a
Vercel serverless route. Why: Part 2 is about absorbing spikes and finding where *our* system breaks. A
serverless route would only surface Vercel's concurrency ceiling and OpenRouter's rate limit — not an infra
story we designed. A long-running Effect service lets us use a real **in-memory work Queue + bounded
worker concurrency + a token-bucket RateLimiter + retry/timeout (Schedule)** — backpressure we can reason
about, tune, and load-test. The Next.js app calls this service; k6 also targets it directly.

Fallback if time-constrained: collapse the grading service into a Next.js route with an Effect semaphore
(documented as a degraded option that weakens the infra story).

## Product Flow (the slice)
1. **Teacher** creates an assignment: title + 2–3 problems (prompt text; optional reference answer).
2. **Rubric auto-generated** per problem (gemini-flash) → teacher can **edit** criteria/points before sharing.
3. Teacher **shares an access code** (+ gets a private report link).
4. **Student** enters code + name → sees problems one at a time → **whiteboard** (HTML canvas) to show work → **submit**.
5. On submit: canvas → PNG → grading service grades against the rubric → student sees a brief "grading…" then their **score**, continues to next problem until done.
6. **Teacher report**: students × problems grid with scores + progress; persists across devices.

## Data Model (Neon Postgres)
- `assignment` (id, title, teacher_token, access_code, created_at)
- `problem` (id, assignment_id, ordinal, prompt, reference_answer?)
- `rubric` (id, problem_id, criteria JSONB [{label, points, descriptor}], max_points, edited_by_teacher)
- `student` (id, assignment_id, display_name, created_at)
- `submission` (id, student_id, problem_id, image_url/blob, status [pending|graded|error], created_at)
- `grade` (id, submission_id, score, max_points, per_criterion JSONB, model, latency_ms, created_at)

## Grading Pipeline (Effect service)
- `POST /grade` — accepts {submissionId, rubric, imageRef}. Enqueues onto a bounded `Queue`.
- Worker pool: `Effect.forEach(..., { concurrency: N })` draining the queue; each job = OpenRouter call
  (gemini-flash, vision) → structured output validated by **Effect Schema** (score + per-criterion) →
  persist grade. Wrapped in `RateLimiter` (respect OpenRouter limits), `timeout`, and `retry(Schedule.exponential)`.
- `GRADER_MODE=real|stub`: **stub** returns a modeled response (latency sampled from a calibrated
  distribution, configurable failure rate, $0) so load tests run unlimited; **real** calls OpenRouter.
- Health/metrics endpoint exposing queue depth, in-flight, throughput.

## Load-Testing Harness (k6)
- Models a **testing-day spike**: a class (~30 students) working through the assignment within a window —
  spiky arrival (k6 `ramping-arrival-rate` with bursts), not uniform.
- Scales the scenario up (×1, ×10, ×100 …) against `GRADER_MODE=stub` to find the **breaking point**:
  where p95/p99 latency degrades, error rate climbs, throughput plateaus, queue saturates.
- A separate **real-calibration run** (small N, `GRADER_MODE=real`) measures true per-grade latency/cost and
  spot-checks accuracy; those numbers parameterize the stub.
- Output: a results table (p50/p95/p99, error %, RPS, max stable concurrency) → ship/no-ship statement.

## Acceptance Criteria
- [ ] Public URL: teacher creates assignment → rubric generated + editable → access code shared.
- [ ] Student: enter code → whiteboard → submit → see score → next → completion; works on a 2nd device.
- [ ] Teacher report shows all students' scores/progress; data persists across browsers/devices.
- [ ] Real grading works end-to-end via OpenRouter gemini-flash (vision on whiteboard image).
- [ ] Grading pipeline is an Effect service with queue + bounded concurrency + rate limit + retry.
- [ ] `GRADER_MODE=stub` runs the full path with no model spend.
- [ ] k6 harness pushes a spiky testing-day load, scales to a breaking point, and emits p50/p95/p99 + error rate; re-runnable with one command for ~$0.
- [ ] One real-calibration run documents true latency/cost/accuracy.
- [ ] Writeup: ship/no-ship confidence statement + 1k→10k→100k→1M scaling plan.
- [ ] Repo pushed to GitHub, shared with `Karavil`.

## Non-Goals (explicitly cut / deferred)
- Teacher email/password auth (token link only).
- Real-time feedback/coaching (it's the auto-grader; feedback OFF by design).
- Multi-teacher orgs, classes management, LMS integration, billing.
- Handwriting OCR beyond what gemini-flash vision gives natively.
- Production secret management / multi-region — discussed in the scaling writeup, not built.

## Scaling Writeup Outline (1k → 1M)
- **1k**: single Effect service, in-memory queue, modest worker concurrency, one OpenRouter key.
- **10k**: durable queue (Upstash/QStash/SQS), horizontal workers, OpenRouter key pool + rate-limit sharding, DB connection pooling (PgBouncer/Neon pooler).
- **100k**: multi-region workers, autoscaling on queue depth, response caching for identical submissions, batch/streaming where possible, cost controls (cheaper model tiers, sampling).
- **1M**: provider diversification/failover, backpressure + shed-load policies, pre-warmed capacity for known testing windows, async grade delivery (push), spend governance per district.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Assignment | core | id, title, teacher_token, access_code | has many Problems, Students |
| Problem | core | id, ordinal, prompt, reference_answer | has one Rubric; has many Submissions |
| Rubric | core | criteria[], max_points, edited | belongs to Problem |
| Student | core | id, display_name | belongs to Assignment; has many Submissions |
| Submission | core | image, status | belongs to Student+Problem; has one Grade |
| Grade | core | score, per_criterion, latency_ms, model | belongs to Submission |
| GradingJob | infra | submissionId, rubric, imageRef | flows through Queue → Worker |
| LoadScenario | infra | arrival pattern, multiplier, mode | drives the grading service |

## Environment (verified)
- Empty greenfield dir; node 22, npm/pnpm/bun/deno; `vercel` + `fly` CLIs present; `gh` authed as `karan-dhir`.
- OPENROUTER_API_KEY not yet in env (user will provide the $20 metered key from email).

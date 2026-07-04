# Goblins Auto-Grader

A "growth product" for Goblins: teachers create an assignment, students show their work on a whiteboard, and
it's **graded instantly by AI**. Real-time feedback is intentionally *off* (this is the auto-grader) — students
see a score, teachers see a live grades report. No sign-up; everything persists across devices.

- **Product** (Part 1): the full teacher → student → grade → report loop.
- **Infra** (Part 2): a standalone Effect grading pipeline (queue + backpressure) with a k6 load test that
  finds where it breaks — cheaply and repeatably. See **[WRITEUP.md](./WRITEUP.md)**.

## Architecture

```
  Teacher / Student (browser)
          │
   Next.js app  ──────────────►  Neon Postgres  ◄─────────────  Grading service (Effect)
   (Vercel)        writes           (rendezvous)      writes         (standalone, load-tested)
   UI + thin API   assignment/…      grade + status        grade      Queue → workers → RateLimiter
          │                                                            → retry/timeout → gemini-2.5-flash
          └── POST /grade (202, enqueue) ──────────────────────────────►  │
          └── GET  /api/grade/:id (poll Neon for status+grade) ◄──────────┘
```

- **Why a separate grading service?** Part 2 asks where *our* system breaks under a spike. A queue on a
  long-running service gives real, tunable backpressure to load-test — a serverless route would only surface
  the platform's and the model vendor's limits. The design is two services; k6 targets the grading service
  directly.
- **`GRADER_MODE=real|stub`** flips *only* the model-call leaf. `stub` returns a calibrated-latency response so
  the load test runs for **$0, unlimited** — the queue/worker/rate-limit/retry/DB path is identical.
- **Poll, not wait:** `POST /grade` returns `202` immediately (the queue absorbs the spike); the student UI
  polls for the score. That's what makes bursts survivable.

## Packages (pnpm workspace)

| Path | What |
|---|---|
| `packages/shared` | Effect `Schema` types (Rubric, Grade, GradingJob…) — one source of truth, both sides decode at the boundary |
| `grading-service`  | Standalone Effect service: `Queue` + worker pool + `RateLimiter` + `Schedule` retry/timeout; `POST /grade`, `GET /grade/:id`, `/health`, `/metrics` |
| `app`              | Next.js (App Router): teacher create + auto-rubric, student whiteboard + submit, live report |
| `db`               | `schema.sql` + migration runner |
| `load`             | k6 spike scenario + `scale.sh` (breaking-point sweep) + `calibrate.sh` (real-latency anchor) |

## Setup

```bash
pnpm install
cp .env.example .env      # fill in DATABASE_URL (Neon pooled) + OPENROUTER_API_KEY
pnpm migrate              # create tables (uses DATABASE_URL_UNPOOLED if set)
```

Any Postgres works locally (SSL auto-enables only for Neon / `sslmode=require`).

## Run it

```bash
# 1) grading service (stub = no API spend; real = calls gemini-2.5-flash)
GRADER_MODE=stub pnpm service          # http://localhost:3001

# 2) app (in another shell)
pnpm app                               # http://localhost:3000
```

Open http://localhost:3000 → "create an assignment" → share the code → "join" on another device → draw → submit.

## Load test (Part 2)

```bash
GRADER_MODE=stub pnpm service          # start the service first
./load/scale.sh                        # spike sweep at MULT=1,2,4,8,16 → breaking-point table ($0)
./load/calibrate.sh                    # optional: small REAL run to (re)anchor stub latency + cost
```

Results land in `load/results/`. Interpretation + ship/no-ship in **[WRITEUP.md](./WRITEUP.md)**.

## Determinism / cost notes

- **Deterministic:** schema, migrations, k6 scenario, the whole stub load path ($0, re-runnable).
- **Non-deterministic:** real model calls (`gemini-2.5-flash`, ~2.6 s/grade, ~$0.001–0.002/grade). The stub's
  latency is *calibrated* from a measured real grade, not invented.
- Secrets live only in `.env` (gitignored). Never commit real keys.

## Deploy

- **App** → Vercel (root directory `app`; env: `DATABASE_URL`, `GRADING_SERVICE_URL`, `OPENROUTER_API_KEY`, `GRADER_MODEL`).
- **Grading service** → Fly.io (`grading-service/fly.toml` + `Dockerfile`; secrets: `DATABASE_URL`, `OPENROUTER_API_KEY`, `GRADER_MODE=real`, `CORS_ORIGIN`).
- **DB** → Neon; run `pnpm migrate` against it once.

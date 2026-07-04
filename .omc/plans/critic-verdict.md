# Critic Verdict: Goblins Auto-Grader (ralplan consensus)

**Reviewer:** Critic (final quality gate) · **Date:** 2026-06-12 · **Mode:** THOROUGH (no escalation — no CRITICAL, < 3 MAJOR after self-audit)

---

## (a) VERDICT: APPROVE (with mandatory required-changes checklist below)

PLAN + the Architect's seven refinements together form a sound, testable, buildable spec for a time-boxed take-home. The architect's reframing (cut-line becomes the default build order; standalone process instead of separate Fly deploy; thin node:http wrapper instead of @effect/platform server; tuple headline metric; DB-write-latency metric; calibration-anchored claim; reordered ~2.5–3h build) resolves the single biggest defect in the original plan — an 11.5h plan masquerading as a one-sitting deliverable that violated its own Principle 1 (no end-to-end demo until ~8h cumulative).

This is APPROVE rather than ITERATE because every required change below is a one-line constraint the executor can absorb without a re-plan round; none require redesign. Do not gold-plate — this is a take-home, not production infra.

---

## (b) REQUIRED-CHANGES CHECKLIST (architect refinements: MANDATORY vs optional)

**MANDATORY (must be in the executor's default path):**

- [ ] **M1 — Cut-line IS the default build order.** Auto-rubric with no edit UI; single problem per assignment; minimal unstyled report; stub as default demo with real documented as locally verified. (Architect #1) — *Non-negotiable: without this the plan does not fit the time-box and violates Principle 1.*
- [ ] **M2 — Grading service is a STANDALONE PROCESS on localhost:3001; k6 targets it directly.** Fly deploy + CORS is the FIRST STRETCH GOAL, not default. Design remains two services; the writeup carries the production topology. (Architect #2) — *This is the highest-leverage change: ~1.5h of pure integration tax for zero additional eval signal.*
- [ ] **M3 — Thin node:http/Express wrapper around the real Effect Queue/worker/RateLimiter/Schedule/Schema core (~40 lines of real Effect).** NOT @effect/platform HTTP server in the default path (stall risk). @effect/platform is additive polish only. (Architect #3)
- [ ] **M4 — Headline metric is a TUPLE: (max stable RPS, queue depth at saturation, p95 latency at the knee).** Never a single "max stable concurrency" number. (Architect #4)
- [ ] **M5 — Add `db_write_latency_p95` / pool-wait metric to `/metrics`** so the breaking point distinguishes queue saturation (intended story) from Neon-pool stall (artifact). k6 stays on `POST /grade` only — do NOT hammer the poll route. (Architect #5)
- [ ] **M6 — Honesty gate on the headline claim.** If the real-calibration run happens, anchor the metric to measured latency L. If calibration is cut, the writeup MUST downgrade to "at estimated latency L (modeled, not measured)" and must never present the stub's chosen `normal(800,200)` latency as measured. (Architect #6) — *This is the integrity gate for the entire infra narrative; non-negotiable.*

**MANDATORY — net-new prerequisites the plan/architect both omit:**

- [ ] **M7 — Install k6 as an explicit Phase-0 prerequisite.** VERIFIED ABSENT in this environment (`k6 not found`; `brew list k6` empty). The plan's entire Phase 3 (`./load/scale.sh`) silently assumes a binary that does not exist. Add `brew install k6` to setup and to the README. *(Note: the spec at line 113 only claims `vercel`+`fly` CLIs — it does NOT falsely claim k6, so this is a gap, not a contradiction. Still blocking for Phase 3.)*
- [ ] **M8 — Idempotency on `POST /grade` under k6 retries.** k6 will retry on transient errors/timeouts and a bursty `ramping-arrival-rate` can replay submissionIds. Without a dedup guard, retries double-enqueue the same `submissionId`, inflating queue depth and corrupting the breaking-point reading (you measure phantom load). Fix: make enqueue idempotent per `submissionId` (skip-if-already-pending/graded, or `ON CONFLICT DO NOTHING` on a job-claim insert). For stub load this is cheap and protects the headline number.

**OPTIONAL (stretch goals, in order — explicitly NOT required for the deliverable):**

- [ ] O1 — Fly deploy of grading service + CORS + Vercel env wiring (Architect #2 stretch)
- [ ] O2 — Real-calibration k6 run (small N, `GRADER_MODE=real`) to anchor stub latency (Architect #7 stretch). *If done, it discharges M6's measured branch.*
- [ ] O3 — Teacher rubric edit UI
- [ ] O4 — Multi-problem support
- [ ] O5 — @effect/platform HTTP server swap-in
- [ ] O6 — Screen recording (optional per brief)

**Reordered build (Architect #7) — ADOPTED as the canonical sequence:**
~30m scaffold+schema+shared types → ~60m Effect grading core (standalone, localhost:3001) → ~45m Next minimal loop → ~20m k6 → ~15m writeup+repo. Stretch goals O1–O6 only if green.

---

## (c) FINAL TESTABLE ACCEPTANCE CRITERIA + VERIFICATION COMMANDS

Default-path criteria (must pass). Commands assume workspace root `/Users/karandhir/goblins-challenge`.

| # | Criterion (default path) | Verification command / check |
|---|---|---|
| 1 | Scaffold + schema migrate clean | `pnpm install` exits 0; `pnpm --filter @goblins/shared build` type-checks; `pnpm --filter @goblins/db migrate` then `psql "$DATABASE_URL" -c "\dt"` shows all 6 tables |
| 2 | k6 present (NEW prereq) | `k6 version` exits 0 (install via `brew install k6` if absent) |
| 3 | Standalone grading service starts on :3001 | `GRADER_MODE=stub pnpm --filter @goblins/grading-service dev` then `curl -s localhost:3001/health` → `{"ok":true}` |
| 4 | `POST /grade` enqueues, returns 202 | `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3001/grade -d @load/payloads/test-rubric.json` → `202` |
| 5 | Idempotency under replay (M8) | POST the same `submissionId` twice quickly; `curl localhost:3001/metrics` shows queue depth incremented by 1, not 2 |
| 6 | Worker grades + persists (stub) | After ~2s: `curl -s localhost:3001/grade/<submissionId>` → `{"status":"graded","grade":{...}}`; row present in Neon `grade` table |
| 7 | Metrics distinguish queue vs DB (M5) | `curl -s localhost:3001/metrics` returns queue depth, in-flight, throughput, AND `db_write_latency_p95` |
| 8 | Real grading works (local) | `GRADER_MODE=real` + real whiteboard PNG → grade reflects image; `grade.model == "google/gemini-2.0-flash"` |
| 9 | Stub full path = $0 | `./load/scale.sh` completes; OpenRouter dashboard usage delta = 0 |
| 10 | k6 spike scales to breaking point (TUPLE, M4) | `./load/scale.sh` (MULT=1,10,100) prints table with p50/p95/p99, error %, RPS, queue depth; reports headline tuple `(max stable RPS, queue depth @ saturation, p95 @ knee)`; completes < 10 min |
| 11 | Product happy path (single-device default) | Open Vercel URL → create assignment (1 problem, auto-rubric) → copy access code → join → whiteboard → submit → score → completion |
| 12 | Persistence across devices | Open report URL in a second browser; student scores present |
| 13 | Writeup honesty gate (M6) | `WRITEUP.md` ship/no-ship cites k6 tuple; latency labeled "measured" ONLY if calibration ran, else "estimated/modeled"; 1k→1M scaling plan present |
| 14 | Repo + collaborator | `gh repo view karan-dhir/goblins-challenge` succeeds; `gh api repos/karan-dhir/goblins-challenge/collaborators/Karavil` confirms (Karavil verified as a real GH user) |

Deferred-to-stretch (documented as cut, not failures): Fly two-service deploy (O1), measured calibration (O2 — else claim downgraded per M6), rubric edit UI (O3), multi-problem (O4).

---

## (d) ADR CONFIRMATION (one line)

CONFIRMED — pnpm-workspace monorepo; **standalone** Effect grading service (thin node:http wrapper over real Queue + bounded worker pool + token-bucket RateLimiter + Schedule retry/timeout + Schema) on **localhost:3001 by default, Fly as first stretch**; Next.js on Vercel for UI + thin API + persistence; enqueue+poll handoff; grading service owns the grade write; Neon Postgres as durable rendezvous via pooled connection; `GRADER_MODE=real|stub`; k6 spike on stub + optional real calibration — drivers (time-box, infra credibility, cost control) and the chosen options are consistent, with the Fly-deploy consequence correctly demoted to stretch.

---

## (e) WHAT EVEN THE ARCHITECT MISSED

1. **DB-as-rendezvous poll race / timing window (CRITICAL-class correctness gap).** The worker does two writes — `saveGrade` then `updateSubmissionStatus("graded")` (plan:118). The student polls `submission.status` via the Next route (plan:45, 178). If the poll reads status between the two writes, or if status flips to `graded` before the grade row commits in a non-transactional sequence, the client sees `graded` with a null/missing grade and renders garbage. **Fix:** wrap the two writes in a single transaction (status flip last, same tx), and have the poll route read grade + status atomically (single SELECT join). One line in the spec; prevents an intermittent demo-day failure that is maddening to debug.

2. **Idempotency of `POST /grade` under k6 retries** — covered as M8 above; the architect's "k6 on POST /grade only" guidance (Architect #5) actually *increases* this risk because all retry pressure lands on the one mutating endpoint. Flagging here because it directly threatens the integrity of the headline tuple, which is the whole point of Part 2.

3. **Whiteboard image realism for *real* grading.** The stub never sends an image, so stub load proves nothing about vision quality. The single real-calibration image is a base64 fixture (`load/payloads/test-image.txt`, plan:197) — a synthetic PNG, not a hand-drawn whiteboard. gemini-flash vision accuracy on actual canvas-drawn handwriting (thin anti-aliased strokes, low contrast) is the real product risk (Risk 1, plan:248) and will be under-tested. **Fix:** the calibration spot-check (or manual QA) must use at least one genuinely hand-drawn canvas export, and the writeup should state accuracy was checked on N real drawings, not synthetic fixtures. Otherwise "real grading works" (criterion 8) is technically-passes-but-unproven.

4. **Secrets handling for a PUBLIC repo.** Repo is `--public` (plan:218) and `OPENROUTER_API_KEY` ($20 metered) plus `DATABASE_URL` (Neon creds) flow through env. Plan has `.gitignore` for `.env` (plan:61) but no explicit pre-push secret check. **Fix:** confirm `.env` is gitignored AND `git log -p | grep -i "sk-or-\|postgres://"` is clean before `gh repo create`; never commit `.env.example` with real values. A leaked metered key on a public repo is a real-money incident. (NOT downgraded — financial/secret exposure earns its severity.)

5. **Minor — `@effect/schema` is folded into `effect` core in recent versions.** Plan lists `@effect/schema` as a separate dep (plan:65, 99). On current Effect, Schema ships from `effect` directly; a stale separate `@effect/schema` import is a 10-minute version-mismatch stall. Verify import path against installed Effect version at scaffold time (consult Effect docs, do not assume).

---

## Ralplan gate summary

- **Principle/Option Consistency:** PASS — after M1/M2, Principle 1 ("demoable at every phase") is honored by the reordered build (end-to-end stub loop by ~90 min). The as-written plan FAILED this gate (no demo until ~8h); the architect refinement fixes it. Principle 3 (stub flips one leaf only) is preserved by M3.
- **Alternatives Depth:** PASS — monorepo vs flat, sync vs poll vs SSE, and writer-ownership options each have fair pros/cons and explicit rejection rationale (plan:21–45, ADR alternatives). Architect added the standalone-vs-Fly and thin-server-vs-platform options the plan lacked.
- **Risk/Verification Rigor:** PASS with the mandatory additions — risk table (plan:246–254) is concrete; M5 (DB-stall metric), M6 (calibration honesty gate), M8 (idempotency), and the poll-race fix close the rigor gaps that would have let an invented number masquerade as measured.
- **Deliberate Additions:** N/A — this is standard ralplan-DR, not deliberate mode; no separate pre-mortem/expanded-test-plan requirement enforced beyond the above.

**Verdict justification:** No CRITICAL findings survived self-audit (the poll-race and idempotency issues are real but each fixable in one line and caught by criteria 5–6). Two MAJOR-class net-new gaps (k6 absent M7, idempotency M8) are made mandatory rather than triggering ITERATE because they are additive constraints, not redesigns — the executor can satisfy them inline. Realist check: the secret-exposure item is NOT downgraded (financial/credential risk); the poll-race is high-annoyance but fast-detect in manual QA, so it's a required fix, not a reject. Plan is buildable, testable, and honest within the time-box. APPROVE.

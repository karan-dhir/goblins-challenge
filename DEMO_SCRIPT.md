# 2–3 min Demo Walkthrough — Goblins Auto-Grader

**Live:** https://goblins-autograder.vercel.app · **Repo:** https://github.com/karan-dhir/goblins-challenge

## Before recording (staging)
- Two browser windows side by side: **left = teacher**, **right = incognito (student)** — separate sessions.
- Left window on the live URL; zoom to ~110%.
- A terminal in `~/goblins-challenge` with the grading service running in stub mode:
  `GRADER_MODE=stub pnpm service`
- `WRITEUP.md` open in an editor tab (breaking-point table). Optionally pre-run `./load/scale.sh` so results exist.

---

### BEAT 1 — What it is · [0:00–0:20]
"Hey — this is my take on the Goblins auto-grader. It's a free growth product for teachers: they post an
assignment, students show their work on a whiteboard, and it's graded instantly by AI — no real-time feedback,
just a score, so it saves grading time and pulls teachers toward the main Goblins product. Let me show it live."
*Show:* the live landing page.

### BEAT 2 — Teacher creates an assignment · [0:20–0:50]
"As a teacher I create an assignment — 'solve 2x + 3 = 11, show your work.' When I submit, it auto-writes a
grading rubric with gemini-2.5-flash, so the teacher doesn't have to. And I get a share code."
*Show:* create assignment → dashboard with auto-rubric + big access code.

### BEAT 3 — Student does the work, gets graded · [0:50–1:30]
"Now I'm a student on another device. I enter the code, get the problem and a whiteboard, show my work, hit
submit — and a couple seconds later, my score with the rubric breakdown. On the teacher's side, the report
updates live. It all persists in a real database, so it follows you across devices."
*Show:* incognito → /join → draw 2x=8, x=4 → Submit → score + rubric breakdown. Switch to teacher → report shows the 10/10 row.

### BEAT 4 — Infra: does it hold under load? · [1:30–2:05]
"The harder half is the pipeline. Every grade is a model call that costs money, so I built the grader as a
standalone service with a real queue — a class submitting at once lines up instead of melting the system. And
I can load-test it for free: a stub mode swaps the model call for a calibrated fake, so I can hammer it at zero
cost. The breaking point: healthy to ~4 submissions/second, and around 8 the queue saturates and latency spikes
— and the metrics show it's the queue, not the database. Re-runnable any time; that's a real ship/no-ship number."
*Show:* `./load/scale.sh` (or mid-run) → cut to the WRITEUP breaking-point table.

### BEAT 5 — Decisions + what's next · [2:05–2:30]
"A couple of calls under the time budget: the live demo grades in a serverless function so it's one free deploy,
but the load-tested pipeline is that standalone queue service — same design, and the writeup carries the
production topology. If I had more time, the big one is teacher trust: let them override a grade, because an
auto-grader only saves time if they believe it. That's it — thanks."
*Show:* README architecture diagram or the report. End card: the live URL.

**Pacing:** Beats 2–3 are the heart — let the "grading… → score" moment breathe. If long, trim Beat 1.
**Honesty note if asked:** the load test runs against the local standalone service (not the deployed app) —
by design; the deployed app grades serverless, the load-tested pipeline is the standalone queue service.

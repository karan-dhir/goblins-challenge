/**
 * Persistence for the grading service. Two backends, auto-selected:
 *   - Postgres (Neon) when DATABASE_URL is set — the product path.
 *   - In-memory Map otherwise — lets the service + k6 load test run with zero
 *     external deps, and lets us load-test the QUEUE in isolation from Neon
 *     (so a plateau is attributable to backpressure, not the DB pool).
 *
 * Poll-race fix (consensus): the grade insert and the submission status flip to
 * 'graded' happen in ONE transaction, status last — a poll can never observe
 * 'graded' without a committed grade row.
 */
import postgres from "postgres"
import type { Grade, SubmissionStatus } from "@goblins/shared"
import { config } from "./config.js"

export interface Store {
  readonly kind: "postgres" | "memory"
  markGrading(submissionId: string): Promise<void>
  saveGradeAndComplete(submissionId: string, grade: Grade): Promise<void>
  markError(submissionId: string): Promise<void>
  getResult(submissionId: string): Promise<{ status: SubmissionStatus; grade: Grade | null }>
}

function memoryStore(): Store {
  const m = new Map<string, { status: SubmissionStatus; grade: Grade | null }>()
  const ensure = (id: string) => m.get(id) ?? { status: "pending" as SubmissionStatus, grade: null }
  return {
    kind: "memory",
    async markGrading(id) {
      m.set(id, { ...ensure(id), status: "grading" })
    },
    async saveGradeAndComplete(id, grade) {
      m.set(id, { status: "graded", grade })
    },
    async markError(id) {
      m.set(id, { ...ensure(id), status: "error" })
    },
    async getResult(id) {
      return ensure(id)
    },
  }
}

function postgresStore(url: string): Store {
  // Pooled connection; max kept small to stay under Neon limits. Writes are
  // bounded by WORKER_CONCURRENCY, so max ≈ concurrency + slack. SSL only when
  // the target requires it (Neon) — off for local Postgres.
  const ssl = /neon\.tech|sslmode=require/.test(url) ? "require" : false
  const sql = postgres(url, { max: config.workerConcurrency + 2, ssl })
  return {
    kind: "postgres",
    async markGrading(id) {
      await sql`UPDATE submission SET status = 'grading' WHERE id = ${id}`
    },
    async saveGradeAndComplete(id, grade) {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO grade (submission_id, score, max_points, per_criterion, model, latency_ms)
          VALUES (${id}, ${grade.score}, ${grade.maxPoints}, ${tx.json(grade.perCriterion as unknown as Parameters<typeof tx.json>[0])}, ${grade.model}, ${grade.latencyMs})
          ON CONFLICT (submission_id) DO UPDATE SET
            score = EXCLUDED.score, max_points = EXCLUDED.max_points,
            per_criterion = EXCLUDED.per_criterion, model = EXCLUDED.model, latency_ms = EXCLUDED.latency_ms
        `
        await tx`UPDATE submission SET status = 'graded' WHERE id = ${id}`
      })
    },
    async markError(id) {
      await sql`UPDATE submission SET status = 'error' WHERE id = ${id}`
    },
    async getResult(id) {
      const rows = await sql<
        { status: SubmissionStatus; score: number | null; max_points: number | null; per_criterion: unknown; model: string | null; latency_ms: number | null }[]
      >`
        SELECT s.status, g.score, g.max_points, g.per_criterion, g.model, g.latency_ms
        FROM submission s LEFT JOIN grade g ON g.submission_id = s.id
        WHERE s.id = ${id}
      `
      const r = rows[0]
      if (!r) return { status: "pending", grade: null }
      const grade: Grade | null =
        r.status === "graded" && r.score != null
          ? {
              score: r.score,
              maxPoints: r.max_points!,
              perCriterion: r.per_criterion as Grade["perCriterion"],
              model: r.model!,
              latencyMs: r.latency_ms!,
            }
          : null
      return { status: r.status, grade }
    },
  }
}

export const store: Store = config.databaseUrl ? postgresStore(config.databaseUrl) : memoryStore()

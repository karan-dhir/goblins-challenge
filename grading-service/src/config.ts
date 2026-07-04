/** Plain env config (thin wrapper — no Effect Config ceremony needed here). */
import type { GraderMode } from "@goblins/shared"

const num = (v: string | undefined, d: number) => (v ? Number(v) : d)

export const config = {
  port: num(process.env.PORT, 3001),
  mode: (process.env.GRADER_MODE ?? "stub") as GraderMode,
  model: process.env.GRADER_MODEL ?? "google/gemini-2.5-flash",
  openrouterKey: process.env.OPENROUTER_API_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  workerConcurrency: num(process.env.WORKER_CONCURRENCY, 5),
  rateLimitRps: num(process.env.RATE_LIMIT_RPS, 10),
  gradeTimeoutMs: num(process.env.GRADE_TIMEOUT_MS, 30000),
  queueCapacity: num(process.env.QUEUE_CAPACITY, 200),
  maxRetries: num(process.env.MAX_RETRIES, 3),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  stub: {
    // Calibrated from a real gemini-2.5-flash grade (~2.6s measured). Keeps the
    // free load test honest — stub latency mirrors the real path.
    latencyMean: num(process.env.STUB_LATENCY_MS_MEAN, 2600),
    latencyStd: num(process.env.STUB_LATENCY_MS_STD, 500),
    failureRate: num(process.env.STUB_FAILURE_RATE, 0.02),
  },
} as const

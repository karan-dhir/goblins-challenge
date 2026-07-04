/**
 * The evaluated artifact: a bounded work Queue drained by a fixed pool of
 * worker fibers, each grading under a token-bucket RateLimiter with a per-job
 * timeout and exponential retry (only on retriable errors). This is where
 * backpressure lives — when arrival rate exceeds
 * min(workers * 1/latency, rateLimitRps), the bounded queue fills and offers
 * apply backpressure, which the load test surfaces as the breaking point.
 */
import { Context, Duration, Effect, Layer, Queue, RateLimiter, Schedule } from "effect"
import type { GradeResult, GradingJob, Grade } from "@goblins/shared"
import { config } from "./config.js"
import { gradeLeaf, GradeError } from "./grader.js"
import { Metrics } from "./metrics.js"
import { store } from "./db.js"

export interface GradingApi {
  readonly enqueue: (job: GradingJob) => Effect.Effect<{ accepted: boolean }>
  readonly result: (submissionId: string) => Effect.Effect<GradeResult>
  readonly metrics: () => Effect.Effect<ReturnType<Metrics["snapshot"]>>
}
export class Grading extends Context.Tag("Grading")<Grading, GradingApi>() {}

const stamp = (out: { score: number; maxPoints: number; perCriterion: Grade["perCriterion"] }, latencyMs: number): Grade => ({
  ...out,
  model: config.mode === "real" ? config.model : "stub",
  latencyMs,
})

export const GradingLive = Layer.scoped(
  Grading,
  Effect.gen(function* () {
    const metrics = new Metrics()
    const dedup = new Set<string>() // idempotency: drop replays of an in-flight submissionId (k6 retries)
    const queue = yield* Queue.bounded<GradingJob>(config.queueCapacity)
    const limiter = yield* RateLimiter.make({
      limit: config.rateLimitRps,
      interval: Duration.seconds(1),
      algorithm: "token-bucket",
    })

    const timedDb = (run: () => Promise<void>) =>
      Effect.gen(function* () {
        const t = Date.now()
        yield* Effect.promise(run)
        metrics.recordDbWrite(Date.now() - t)
      })

    const retrySchedule = Schedule.exponential(Duration.millis(200)).pipe(
      Schedule.intersect(Schedule.recurs(config.maxRetries)),
      Schedule.whileInput((e: GradeError) => e.retriable),
    )

    const processJob = (job: GradingJob) =>
      Effect.gen(function* () {
        metrics.inFlight++
        yield* timedDb(() => store.markGrading(job.submissionId))
        const start = Date.now()

        const graded = yield* limiter(gradeLeaf(job)).pipe(
          Effect.timeout(Duration.millis(config.gradeTimeoutMs)),
          Effect.mapError((e) => (e instanceof GradeError ? e : new GradeError(`timeout/${e}`, true))),
          Effect.retry(retrySchedule),
          Effect.either,
        )

        if (graded._tag === "Right") {
          const latency = Date.now() - start
          yield* timedDb(() => store.saveGradeAndComplete(job.submissionId, stamp(graded.right, latency)))
          metrics.recordGrade(latency)
        } else {
          yield* timedDb(() => store.markError(job.submissionId))
          metrics.recordError()
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            metrics.inFlight--
            dedup.delete(job.submissionId)
          }),
        ),
      )

    // Fixed worker pool: N fibers each draining the queue forever.
    // queueDepth is tracked with an O(1) counter (Effect 3.x Queue has no sync
    // size read): ++ on accepted offer, -- on take.
    yield* Effect.forEach(
      Array.from({ length: config.workerConcurrency }, (_, i) => i),
      () =>
        Effect.forkScoped(
          Effect.forever(
            Queue.take(queue).pipe(
              Effect.tap(() => Effect.sync(() => (metrics.queueDepth = Math.max(0, metrics.queueDepth - 1)))),
              Effect.flatMap(processJob),
            ),
          ),
        ),
      { concurrency: "unbounded" },
    )

    yield* Effect.logInfo(
      `grading service ready: mode=${config.mode} workers=${config.workerConcurrency} rps=${config.rateLimitRps} queueCap=${config.queueCapacity} store=${store.kind}`,
    )

    return Grading.of({
      enqueue: (job) =>
        Effect.gen(function* () {
          if (dedup.has(job.submissionId)) return { accepted: false }
          dedup.add(job.submissionId)
          yield* Queue.offer(queue, job) // suspends (backpressure) when the bounded queue is full
          metrics.queueDepth++
          return { accepted: true }
        }),
      result: (id) =>
        Effect.promise(() => store.getResult(id)).pipe(
          Effect.map((r) => ({ submissionId: id, status: r.status, grade: r.grade }) satisfies GradeResult),
        ),
      metrics: () => Effect.sync(() => metrics.snapshot(config.workerConcurrency, config.mode)),
    })
  }),
)

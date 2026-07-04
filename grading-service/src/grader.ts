/**
 * The grading leaf. GRADER_MODE selects real vs stub — this is the ONLY place
 * the two modes differ; the queue/worker/rate-limit/retry path around it is
 * identical (consensus Principle 3).
 */
import { Effect, Duration } from "effect"
import { decodeModelGradeOutput, type GradingJob, type ModelGradeOutput } from "@goblins/shared"
import { config } from "./config.js"

export class GradeError extends Error {
  readonly _tag = "GradeError"
  constructor(message: string, readonly retriable: boolean) {
    super(message)
  }
}

// ---- stub leaf: modeled latency + failure, zero spend ---------------------
function gaussian(mean: number, std: number): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const stub = (job: GradingJob): Effect.Effect<ModelGradeOutput, GradeError> =>
  Effect.gen(function* () {
    const latency = Math.max(50, Math.round(gaussian(config.stub.latencyMean, config.stub.latencyStd)))
    yield* Effect.sleep(Duration.millis(latency))
    if (Math.random() < config.stub.failureRate) {
      return yield* Effect.fail(new GradeError("stub injected failure", true))
    }
    const perCriterion = job.rubric.criteria.map((c) => {
      const awarded = Math.round(Math.random() * c.points)
      return { label: c.label, awarded, max: c.points, reasoning: "stubbed" }
    })
    const score = perCriterion.reduce((s, c) => s + c.awarded, 0)
    return { score, maxPoints: job.rubric.maxPoints, perCriterion }
  })

// ---- real leaf: OpenRouter gemini-flash vision ----------------------------
const real = (job: GradingJob): Effect.Effect<ModelGradeOutput, GradeError> =>
  Effect.gen(function* () {
    const system =
      "You are a strict but fair grader. Grade the student's handwritten work (image) against the rubric. " +
      "Award integer points per criterion, never exceeding its max. Respond ONLY with JSON: " +
      `{"score": number, "maxPoints": ${job.rubric.maxPoints}, "perCriterion": [{"label": string, "awarded": number, "max": number, "reasoning": string}]}.`
    const rubricText = job.rubric.criteria
      .map((c) => `- ${c.label} (max ${c.points}): ${c.descriptor}`)
      .join("\n")

    const res = yield* Effect.tryPromise({
      try: (signal) =>
        fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          signal,
          headers: {
            Authorization: `Bearer ${config.openrouterKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: [
                  { type: "text", text: `Problem: ${job.problemPrompt}\n\nRubric:\n${rubricText}` },
                  { type: "image_url", image_url: { url: job.imageDataUrl } },
                ],
              },
            ],
          }),
        }),
      catch: (e) => new GradeError(`openrouter fetch failed: ${e}`, true),
    })

    if (!res.ok) {
      const retriable = res.status === 429 || res.status >= 500
      return yield* Effect.fail(new GradeError(`openrouter ${res.status}`, retriable))
    }
    const body = (yield* Effect.tryPromise({
      try: () => res.json() as Promise<{ choices?: { message?: { content?: string } }[] }>,
      catch: (e) => new GradeError(`bad json envelope: ${e}`, false),
    }))
    const content = body.choices?.[0]?.message?.content ?? ""
    const jsonText = content.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    const parsed = yield* Effect.tryPromise({
      try: () => Promise.resolve(JSON.parse(jsonText)),
      catch: (e) => new GradeError(`model returned non-JSON: ${e}`, true),
    })
    return yield* decodeModelGradeOutput(parsed).pipe(
      Effect.mapError((e) => new GradeError(`schema mismatch: ${e}`, true)),
    )
  })

export const gradeLeaf = config.mode === "real" ? real : stub

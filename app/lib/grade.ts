/**
 * In-process grader for the SERVERLESS deployment path. Used only when
 * GRADING_SERVICE_URL is unset (i.e. on Vercel, where a long-running queue
 * can't live). Reuses the shared ModelGradeOutput schema + the same prompt as
 * the standalone Effect service. Grades synchronously and persists in one
 * transaction (grade insert + status flip) so a poll never sees a half-written
 * result.
 *
 * The standalone Effect service (queue + backpressure) remains the pipeline the
 * k6 load test targets — see WRITEUP.md. This route is the live-demo grader.
 */
import type { Grade, GradingJob, ModelGradeOutput } from "@goblins/shared"
import { sql } from "./db"

// Light validation (avoids bundling Effect into the serverless function). The
// standalone service uses the full Effect Schema decode; here we guard the
// essential shape and clamp awarded points into [0, max].
function parseModelGrade(raw: string, maxPoints: number): ModelGradeOutput {
  const o = JSON.parse(raw) as Record<string, unknown>
  if (typeof o.score !== "number" || !Array.isArray(o.perCriterion)) throw new Error("bad grade shape")
  const perCriterion = (o.perCriterion as Record<string, unknown>[]).map((c) => {
    const max = Number(c.max ?? 0)
    return {
      label: String(c.label ?? ""),
      awarded: Math.max(0, Math.min(max, Number(c.awarded ?? 0))),
      max,
      reasoning: String(c.reasoning ?? ""),
    }
  })
  return { score: Number(o.score), maxPoints: Number(o.maxPoints ?? maxPoints), perCriterion }
}

export async function gradeInProcess(job: GradingJob): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY
  const model = process.env.GRADER_MODEL ?? "google/gemini-2.5-flash"
  await sql`UPDATE submission SET status = 'grading' WHERE id = ${job.submissionId}`
  const start = Date.now()
  try {
    if (!key) throw new Error("OPENROUTER_API_KEY not set")
    const system =
      "You are a strict but fair grader. Grade the student's handwritten work (image) against the rubric. " +
      "Award integer points per criterion, never exceeding its max. Respond ONLY with JSON: " +
      `{"score": number, "maxPoints": ${job.rubric.maxPoints}, "perCriterion": [{"label": string, "awarded": number, "max": number, "reasoning": string}]}.`
    const rubricText = job.rubric.criteria.map((c) => `- ${c.label} (max ${c.points}): ${c.descriptor}`).join("\n")

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
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
    })
    if (!res.ok) throw new Error(`openrouter ${res.status}`)
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim()
    const out = parseModelGrade(content, job.rubric.maxPoints)
    const grade: Grade = { ...out, model, latencyMs: Date.now() - start }

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO grade (submission_id, score, max_points, per_criterion, model, latency_ms)
        VALUES (${job.submissionId}, ${grade.score}, ${grade.maxPoints}, ${tx.json(grade.perCriterion as unknown as Parameters<typeof tx.json>[0])}, ${grade.model}, ${grade.latencyMs})
        ON CONFLICT (submission_id) DO UPDATE SET
          score = EXCLUDED.score, max_points = EXCLUDED.max_points, per_criterion = EXCLUDED.per_criterion
      `
      await tx`UPDATE submission SET status = 'graded' WHERE id = ${job.submissionId}`
    })
  } catch (e) {
    await sql`UPDATE submission SET status = 'error' WHERE id = ${job.submissionId}`
    throw e
  }
}

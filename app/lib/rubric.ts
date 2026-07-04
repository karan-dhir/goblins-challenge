import type { Rubric } from "@goblins/shared"

// Auto-generate a rubric for a problem via the cheap grading model. Falls back
// to a sane default if the model/key is unavailable, so assignment creation
// never hard-fails (teacher can still edit — stretch).
export async function generateRubric(prompt: string, referenceAnswer?: string): Promise<Rubric> {
  const key = process.env.OPENROUTER_API_KEY
  const model = process.env.GRADER_MODEL ?? "google/gemini-2.5-flash"
  const fallback: Rubric = {
    criteria: [
      { label: "Method", points: 5, descriptor: "Shows correct approach and working." },
      { label: "Answer", points: 3, descriptor: "Reaches the correct final answer." },
      { label: "Clarity", points: 2, descriptor: "Work is legible and well-organized." },
    ],
    maxPoints: 10,
    editedByTeacher: false,
  }
  if (!key) return fallback

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Create a concise grading rubric for a single student problem. Respond ONLY with JSON: " +
              '{"criteria":[{"label":string,"points":integer,"descriptor":string}],"maxPoints":integer}. ' +
              "Use 2-4 criteria; points should sum to maxPoints (typically 10).",
          },
          {
            role: "user",
            content: `Problem: ${prompt}${referenceAnswer ? `\nReference answer: ${referenceAnswer}` : ""}`,
          },
        ],
      }),
    })
    if (!res.ok) return fallback
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?/, "").replace(/```$/, "")
    const parsed = JSON.parse(text) as { criteria: Rubric["criteria"]; maxPoints: number }
    if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) return fallback
    return { criteria: parsed.criteria, maxPoints: parsed.maxPoints, editedByTeacher: false }
  } catch {
    return fallback
  }
}

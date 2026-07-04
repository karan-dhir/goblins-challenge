import { NextResponse } from "next/server"
import { sql } from "../../../lib/db"
import { generateRubric } from "../../../lib/rubric"
import { generateAccessCode, generateToken } from "../../../lib/utils"

export const runtime = "nodejs"
export const maxDuration = 60 // rubric generation calls the model

type ProblemInput = { prompt: string; referenceAnswer?: string }

export async function POST(req: Request) {
  const body = (await req.json()) as { title?: string; problems?: ProblemInput[] }
  const title = (body.title ?? "").trim() || "Untitled assignment"
  const problems = (body.problems ?? []).filter((p) => p.prompt?.trim())
  if (problems.length === 0) {
    return NextResponse.json({ error: "at least one problem is required" }, { status: 400 })
  }

  const teacherToken = generateToken()
  const accessCode = generateAccessCode()

  const [assignment] = await sql<{ id: string }[]>`
    INSERT INTO assignment (title, teacher_token, access_code)
    VALUES (${title}, ${teacherToken}, ${accessCode})
    RETURNING id
  `

  // Insert problems + auto-generate a rubric for each (in parallel).
  await Promise.all(
    problems.map(async (p, i) => {
      const [problem] = await sql<{ id: string }[]>`
        INSERT INTO problem (assignment_id, ordinal, prompt, reference_answer)
        VALUES (${assignment!.id}, ${i}, ${p.prompt.trim()}, ${p.referenceAnswer?.trim() ?? null})
        RETURNING id
      `
      const rubric = await generateRubric(p.prompt, p.referenceAnswer)
      await sql`
        INSERT INTO rubric (problem_id, criteria, max_points, edited_by_teacher)
        VALUES (${problem!.id}, ${sql.json(rubric.criteria as unknown as Parameters<typeof sql.json>[0])}, ${rubric.maxPoints}, false)
      `
    }),
  )

  return NextResponse.json({ teacherToken, accessCode })
}

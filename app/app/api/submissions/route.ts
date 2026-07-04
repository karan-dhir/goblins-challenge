import { NextResponse } from "next/server"
import { sql } from "../../../lib/db"
import { submitForGrading } from "../../../lib/grading-client"
import { gradeInProcess } from "../../../lib/grade"
import type { RubricCriterion } from "@goblins/shared"

export const runtime = "nodejs"
export const maxDuration = 60 // serverless in-process grading awaits the model call (~2.6s)

export async function POST(req: Request) {
  const { studentId, problemId, imageDataUrl } = (await req.json()) as {
    studentId?: string; problemId?: string; imageDataUrl?: string
  }
  if (!studentId || !problemId || !imageDataUrl) {
    return NextResponse.json({ error: "studentId, problemId, imageDataUrl required" }, { status: 400 })
  }

  const [problem] = await sql<
    { prompt: string; criteria: RubricCriterion[]; max_points: number }[]
  >`
    SELECT p.prompt, r.criteria, r.max_points
    FROM problem p LEFT JOIN rubric r ON r.problem_id = p.id
    WHERE p.id = ${problemId}
  `
  if (!problem) return NextResponse.json({ error: "problem not found" }, { status: 404 })

  const [submission] = await sql<{ id: string }[]>`
    INSERT INTO submission (student_id, problem_id, image_data, status)
    VALUES (${studentId}, ${problemId}, ${imageDataUrl}, 'pending')
    RETURNING id
  `

  const job = {
    submissionId: submission!.id,
    rubric: { criteria: problem.criteria ?? [], maxPoints: problem.max_points ?? 10, editedByTeacher: false },
    imageDataUrl,
    problemPrompt: problem.prompt,
  }

  if (process.env.GRADING_SERVICE_URL) {
    // Local/production two-service topology: enqueue on the standalone Effect
    // grading service (the queue absorbs the spike); the client polls for the score.
    await submitForGrading(job)
  } else {
    // Serverless (Vercel) path: grade in-process and persist before responding.
    await gradeInProcess(job).catch(() => {}) // failures are reflected in submission.status
  }

  return NextResponse.json({ submissionId: submission!.id })
}

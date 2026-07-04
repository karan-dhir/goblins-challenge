import { NextResponse } from "next/server"
import { sql } from "../../../../lib/db"
import type { CriterionGrade, SubmissionStatus } from "@goblins/shared"

export const runtime = "nodejs"

// The student polls this. Reads status + grade atomically (single join) — the
// grading service writes both in one transaction, so 'graded' always has a grade.
export async function GET(_req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params
  const [row] = await sql<
    { status: SubmissionStatus; score: number | null; max_points: number | null; per_criterion: CriterionGrade[] | null }[]
  >`
    SELECT s.status, g.score, g.max_points, g.per_criterion
    FROM submission s LEFT JOIN grade g ON g.submission_id = s.id
    WHERE s.id = ${submissionId}
  `
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })
  const grade =
    row.status === "graded" && row.score != null
      ? { score: row.score, maxPoints: row.max_points!, perCriterion: row.per_criterion ?? [] }
      : null
  return NextResponse.json({ submissionId, status: row.status, grade })
}

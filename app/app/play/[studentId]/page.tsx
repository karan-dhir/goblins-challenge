import { sql } from "../../../lib/db"
import { Play } from "../../components/Play"

export const dynamic = "force-dynamic"

export default async function PlayPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params
  const [student] = await sql<{ id: string; display_name: string; assignment_id: string }[]>`
    SELECT id, display_name, assignment_id FROM student WHERE id = ${studentId}
  `
  if (!student) return <div className="wrap"><h1>Student session not found</h1></div>

  const [assignment] = await sql<{ title: string }[]>`SELECT title FROM assignment WHERE id = ${student.assignment_id}`
  const problems = await sql<{ id: string; ordinal: number; prompt: string }[]>`
    SELECT id, ordinal, prompt FROM problem WHERE assignment_id = ${student.assignment_id} ORDER BY ordinal
  `
  // Resume support: which problems already have a graded/pending submission.
  const subs = await sql<{ problem_id: string; status: string; score: number | null; max_points: number | null }[]>`
    SELECT s.problem_id, s.status, g.score, g.max_points
    FROM submission s LEFT JOIN grade g ON g.submission_id = s.id
    WHERE s.student_id = ${studentId}
  `
  const done: Record<string, { score: number; maxPoints: number }> = {}
  for (const s of subs) if (s.status === "graded" && s.score != null) done[s.problem_id] = { score: s.score, maxPoints: s.max_points! }

  return (
    <Play
      studentName={student.display_name}
      assignmentTitle={assignment?.title ?? "Assignment"}
      studentId={studentId}
      problems={problems.map((p) => ({ id: p.id, ordinal: p.ordinal, prompt: p.prompt }))}
      initialDone={done}
    />
  )
}

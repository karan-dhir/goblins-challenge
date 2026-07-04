import { sql } from "../../../lib/db"
import { Refresher } from "../../components/Refresher"

export const dynamic = "force-dynamic"

export default async function Report({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [assignment] = await sql<{ id: string; title: string; access_code: string }[]>`
    SELECT id, title, access_code FROM assignment WHERE teacher_token = ${token}
  `
  if (!assignment) return <div className="wrap"><h1>Report not found</h1></div>

  const problems = await sql<{ id: string; ordinal: number }[]>`
    SELECT id, ordinal FROM problem WHERE assignment_id = ${assignment.id} ORDER BY ordinal
  `
  const students = await sql<{ id: string; display_name: string }[]>`
    SELECT id, display_name FROM student WHERE assignment_id = ${assignment.id} ORDER BY created_at
  `
  const cells = await sql<{ student_id: string; problem_id: string; status: string; score: number | null; max_points: number | null }[]>`
    SELECT s.student_id, s.problem_id, s.status, g.score, g.max_points
    FROM submission s
    JOIN student st ON st.id = s.student_id
    LEFT JOIN grade g ON g.submission_id = s.id
    WHERE st.assignment_id = ${assignment.id}
  `
  const key = (sid: string, pid: string) => `${sid}:${pid}`
  const map = new Map(cells.map((c) => [key(c.student_id, c.problem_id), c]))

  return (
    <div className="wrap">
      <Refresher />
      <h1>{assignment.title} — report</h1>
      <p className="muted">Code <span className="code">{assignment.access_code}</span> · {students.length} student(s) · live (refreshes every 5s)</p>
      {students.length === 0 ? (
        <div className="card muted">No students have joined yet. Share the access code to get started.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Student</th>
                {problems.map((p) => <th key={p.id}>P{p.ordinal + 1}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {students.map((st) => {
                let total = 0, max = 0
                return (
                  <tr key={st.id}>
                    <td>{st.display_name}</td>
                    {problems.map((p) => {
                      const c = map.get(key(st.id, p.id))
                      let content: React.ReactNode = <span className="muted">—</span>
                      if (c?.status === "graded" && c.score != null) {
                        total += c.score; max += c.max_points!
                        content = <span className="score-pill">{c.score}/{c.max_points}</span>
                      } else if (c?.status === "grading" || c?.status === "pending") {
                        content = <span className="grading">…</span>
                      } else if (c?.status === "error") {
                        content = <span style={{ color: "var(--warn)" }}>err</span>
                      }
                      return <td key={p.id}>{content}</td>
                    })}
                    <td><b>{max > 0 ? `${total}/${max}` : "—"}</b></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

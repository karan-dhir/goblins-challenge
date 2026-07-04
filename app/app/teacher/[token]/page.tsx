import Link from "next/link"
import { sql } from "../../../lib/db"
import type { RubricCriterion } from "@goblins/shared"

export const dynamic = "force-dynamic"

export default async function TeacherDashboard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [assignment] = await sql<{ id: string; title: string; access_code: string }[]>`
    SELECT id, title, access_code FROM assignment WHERE teacher_token = ${token}
  `
  if (!assignment) return <div className="wrap"><h1>Assignment not found</h1></div>

  const problems = await sql<{ id: string; ordinal: number; prompt: string; criteria: RubricCriterion[]; max_points: number }[]>`
    SELECT p.id, p.ordinal, p.prompt, r.criteria, r.max_points
    FROM problem p LEFT JOIN rubric r ON r.problem_id = p.id
    WHERE p.assignment_id = ${assignment.id} ORDER BY p.ordinal
  `

  return (
    <div className="wrap">
      <h1>{assignment.title}</h1>
      <div className="card center">
        <label>Share this code with students</label>
        <div className="access-code">{assignment.access_code}</div>
        <p className="muted">Students join at <span className="code">/join</span> with this code.</p>
        <Link className="btn green" href={`/report/${token}`}>View live report →</Link>
      </div>

      {problems.map((p) => (
        <div className="card" key={p.id}>
          <div className="pill">Problem {p.ordinal + 1}</div>
          <p style={{ fontWeight: 600 }}>{p.prompt}</p>
          <label>Auto-generated rubric ({p.max_points} pts)</label>
          <table>
            <thead><tr><th>Criterion</th><th>Points</th><th>What earns it</th></tr></thead>
            <tbody>
              {(p.criteria ?? []).map((c, i) => (
                <tr key={i}><td>{c.label}</td><td>{c.points}</td><td className="muted">{c.descriptor}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

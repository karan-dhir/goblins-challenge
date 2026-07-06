"use client"
import { useMemo, useRef, useState } from "react"
import { Whiteboard, type WhiteboardHandle } from "./Whiteboard"
import type { CriterionGrade } from "../../lib/shared-types"

type Problem = { id: string; ordinal: number; prompt: string }
type Result = { score: number; maxPoints: number; perCriterion?: CriterionGrade[] }

export function Play(props: {
  studentName: string
  assignmentTitle: string
  studentId: string
  problems: Problem[]
  initialDone: Record<string, Result>
}) {
  const { problems, studentId } = props
  const [done, setDone] = useState<Record<string, Result>>(props.initialDone)
  const firstUndone = useMemo(() => problems.findIndex((p) => !done[p.id]), [problems, done])
  const [idx, setIdx] = useState(firstUndone === -1 ? problems.length : firstUndone)
  const [phase, setPhase] = useState<"draw" | "grading" | "scored">("draw")
  const [current, setCurrent] = useState<Result | null>(null)
  const [err, setErr] = useState("")
  const board = useRef<WhiteboardHandle>(null)

  const allDone = idx >= problems.length
  const problem = problems[idx]

  async function submit() {
    if (!problem || board.current?.isBlank()) { setErr("Draw your work first ✏️"); return }
    setErr(""); setPhase("grading")
    try {
      const png = board.current!.toPNG()
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, problemId: problem.id, imageDataUrl: png }),
      })
      const { submissionId, error } = await res.json()
      if (!res.ok) throw new Error(error ?? "submit failed")

      // Poll until graded (feedback is OFF — we only reveal the score).
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const g = await fetch(`/api/grade/${submissionId}`, { cache: "no-store" }).then((r) => r.json())
        if (g.status === "graded" && g.grade) {
          const result = { score: g.grade.score, maxPoints: g.grade.maxPoints, perCriterion: g.grade.perCriterion }
          setCurrent(result); setDone((d) => ({ ...d, [problem.id]: result })); setPhase("scored")
          return
        }
        if (g.status === "error") throw new Error("grading failed — try resubmitting")
      }
      throw new Error("grading timed out")
    } catch (e) { setErr(String(e)); setPhase("draw") }
  }

  function next() {
    setCurrent(null); setPhase("draw"); board.current?.clear()
    setIdx((i) => i + 1)
  }

  if (allDone) {
    const total = Object.values(done).reduce((s, r) => s + r.score, 0)
    const max = Object.values(done).reduce((s, r) => s + r.maxPoints, 0)
    return (
      <div className="wrap center">
        <h1>🎉 All done, {props.studentName}!</h1>
        <div className="card">
          <div className="big-score">{total}/{max}</div>
          <p className="muted">You finished “{props.assignmentTitle}”. Your work is saved.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wrap">
      <div className="toolbar">
        <span className="pill">Problem {idx + 1} of {problems.length}</span>
        <span className="pill">{props.studentName}</span>
      </div>
      <h2>{problem!.prompt}</h2>

      {phase === "scored" && current ? (
        <div className="card">
          <div className="big-score">{current.score}/{current.maxPoints}</div>
          {current.perCriterion && current.perCriterion.length > 0 && (
            <table style={{ margin: "10px 0 16px" }}>
              <thead><tr><th>Rubric</th><th style={{ width: 70, textAlign: "right" }}>Points</th></tr></thead>
              <tbody>
                {current.perCriterion.map((c, i) => (
                  <tr key={i}>
                    <td>{c.label}<div className="muted" style={{ fontSize: 12 }}>{c.reasoning}</div></td>
                    <td style={{ textAlign: "right" }}><span className="score-pill">{c.awarded}/{c.max}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="center">
            <button className="btn green" onClick={next}>
              {idx + 1 < problems.length ? "Next problem →" : "Finish 🎉"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <Whiteboard ref={board} />
          <div className="toolbar">
            <button className="btn secondary" onClick={() => board.current?.clear()} disabled={phase === "grading"}>Clear</button>
            <button className="btn" onClick={submit} disabled={phase === "grading"}>
              {phase === "grading" ? "Grading…" : "Submit my work"}
            </button>
            {phase === "grading" && <span className="grading">✦ grading your work…</span>}
          </div>
        </>
      )}
      {err && <p style={{ color: "var(--warn)" }}>{err}</p>}
    </div>
  )
}

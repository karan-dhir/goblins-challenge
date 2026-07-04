"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

export default function NewAssignment() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [prompt, setPrompt] = useState("")
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  async function create() {
    setBusy(true)
    setErr("")
    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, problems: [{ prompt, referenceAnswer: reference }] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "failed")
      router.push(`/teacher/${data.teacherToken}`)
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="wrap">
      <h1>Create an assignment</h1>
      <p className="muted">We&apos;ll auto-write a grading rubric for your problem (you can tweak it next).</p>
      <div className="card">
        <label>Assignment title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Solving linear equations" />
        <label>Problem</label>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Solve for x: 2x + 3 = 11. Show your work." />
        <label>Reference answer (optional — helps grading)</label>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. x = 4" />
        <button className="btn" onClick={create} disabled={busy || !prompt.trim()}>
          {busy ? "Creating & writing rubric…" : "Create assignment"}
        </button>
        {err && <p style={{ color: "var(--warn)" }}>{err}</p>}
      </div>
    </div>
  )
}

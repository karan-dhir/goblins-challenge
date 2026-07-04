"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

export default function Join() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  async function join() {
    setBusy(true); setErr("")
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code, displayName: name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "failed")
      // Remember so a refresh / new tab resumes the same student.
      localStorage.setItem(`goblins:student:${code.toUpperCase()}`, data.studentId)
      router.push(`/play/${data.studentId}`)
    } catch (e) { setErr(String(e)); setBusy(false) }
  }

  return (
    <div className="wrap">
      <h1>Join an assignment</h1>
      <div className="card">
        <label>Access code</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" className="code" maxLength={6} />
        <label>Your name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" />
        <button className="btn green" onClick={join} disabled={busy || code.length < 4 || !name.trim()}>
          {busy ? "Joining…" : "Start →"}
        </button>
        {err && <p style={{ color: "var(--warn)" }}>{err}</p>}
      </div>
    </div>
  )
}

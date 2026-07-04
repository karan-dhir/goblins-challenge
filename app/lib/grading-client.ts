import type { GradingJob, GradeResult } from "@goblins/shared"

const BASE = process.env.GRADING_SERVICE_URL ?? "http://localhost:3001"

// Fire-and-forget enqueue; the service returns 202 immediately (queue absorbs spikes).
export async function submitForGrading(job: GradingJob): Promise<void> {
  const res = await fetch(`${BASE}/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  })
  if (!res.ok && res.status !== 202) throw new Error(`grading service ${res.status}`)
}

export async function pollGrade(submissionId: string): Promise<GradeResult> {
  const res = await fetch(`${BASE}/grade/${submissionId}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`grading service ${res.status}`)
  return res.json()
}

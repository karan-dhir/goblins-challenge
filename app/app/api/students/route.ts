import { NextResponse } from "next/server"
import { sql } from "../../../lib/db"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { accessCode, displayName } = (await req.json()) as { accessCode?: string; displayName?: string }
  const code = (accessCode ?? "").trim().toUpperCase()
  const name = (displayName ?? "").trim()
  if (!code || !name) return NextResponse.json({ error: "code and name required" }, { status: 400 })

  const [assignment] = await sql<{ id: string }[]>`SELECT id FROM assignment WHERE access_code = ${code}`
  if (!assignment) return NextResponse.json({ error: "no assignment with that code" }, { status: 404 })

  const [student] = await sql<{ id: string }[]>`
    INSERT INTO student (assignment_id, display_name) VALUES (${assignment.id}, ${name}) RETURNING id
  `
  return NextResponse.json({ studentId: student!.id })
}

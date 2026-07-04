import postgres from "postgres"

// Singleton pooled client (cached across Next dev hot-reloads). Uses the Neon
// POOLED connection string. The app writes assignment/problem/rubric/student/
// submission; the grading service writes grade + flips submission.status.
const g = globalThis as unknown as { _sql?: postgres.Sql }
const url = process.env.DATABASE_URL!
const ssl = /neon\.tech|sslmode=require/.test(url ?? "") ? "require" : false
export const sql = g._sql ?? (g._sql = postgres(url, { max: 10, ssl }))

/**
 * Runs schema.sql against the database. Use the UNPOOLED connection string for
 * DDL (migrations) when available; fall back to DATABASE_URL.
 *   DATABASE_URL_UNPOOLED=... tsx migrate.ts
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import postgres from "postgres"

const __dirname = dirname(fileURLToPath(import.meta.url))
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) {
  console.error("FATAL: set DATABASE_URL_UNPOOLED or DATABASE_URL")
  process.exit(1)
}

const ssl = /neon\.tech|sslmode=require/.test(url) ? "require" : false
const sql = postgres(url, { max: 1, ssl })
const ddl = readFileSync(join(__dirname, "schema.sql"), "utf8")

try {
  await sql.unsafe(ddl)
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `
  console.log("migrated. tables:", tables.map((t) => t.tablename).join(", "))
} catch (e) {
  console.error("migration failed:", e)
  process.exit(1)
} finally {
  await sql.end()
}

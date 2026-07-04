/** Thin node:http server wrapping the Effect grading core (no @effect/platform — keeps API surface small). */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { Effect } from "effect"
import { decodeGradeRequest } from "@goblins/shared"
import { config } from "./config.js"
import { Grading } from "./grading.js"

type Run = <A>(e: Effect.Effect<A, unknown, Grading>) => Promise<A>

const MAX_BODY = 12 * 1024 * 1024 // 12MB (whiteboard PNG data URLs)

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error("payload too large"))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

export function startServer(run: Run) {
  const cors = (res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin)
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  }
  const json = (res: ServerResponse, code: number, body: unknown) => {
    cors(res)
    res.writeHead(code, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${config.port}`)
      const path = url.pathname

      if (req.method === "OPTIONS") return json(res, 204, {})
      if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true })
      if (req.method === "GET" && path === "/metrics") {
        const m = await run(Grading.pipe(Effect.flatMap((g) => g.metrics())))
        return json(res, 200, m)
      }
      if (req.method === "POST" && path === "/grade") {
        const raw = await readBody(req)
        const parsed = JSON.parse(raw)
        const job = await run(
          decodeGradeRequest(parsed).pipe(Effect.mapError((e) => new Error(`bad GradeRequest: ${e}`))),
        )
        const { accepted } = await run(Grading.pipe(Effect.flatMap((g) => g.enqueue(job))))
        return json(res, 202, { submissionId: job.submissionId, status: "pending", accepted })
      }
      const gradeMatch = path.match(/^\/grade\/(.+)$/)
      if (req.method === "GET" && gradeMatch) {
        const result = await run(Grading.pipe(Effect.flatMap((g) => g.result(gradeMatch[1]!))))
        return json(res, 200, result)
      }
      return json(res, 404, { error: "not found" })
    } catch (e) {
      return json(res, 400, { error: String(e) })
    }
  })

  server.listen(config.port, () => {
    console.log(`grading-service listening on :${config.port} (mode=${config.mode})`)
  })
  return server
}

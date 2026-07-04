/** Entrypoint: build the grading runtime (forks workers), then start the HTTP server. */
import { Effect, Layer, Logger, ManagedRuntime } from "effect"
import { Grading, GradingLive } from "./grading.js"
import { startServer } from "./server.js"

const AppLayer = Layer.provideMerge(GradingLive, Logger.pretty)
const runtime = ManagedRuntime.make(AppLayer)

// Force layer construction so worker fibers start before we accept traffic.
await runtime.runPromise(Grading)

startServer((effect) => runtime.runPromise(effect as Effect.Effect<unknown, unknown, Grading>) as Promise<never>)

const shutdown = () => {
  runtime.dispose().finally(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

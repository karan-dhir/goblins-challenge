/**
 * In-memory metrics. Separates grade latency (queue + model) from db-write
 * latency so a load-test plateau can be attributed to queue saturation (the
 * intended story) vs. Neon connection-pool stall (an artifact) — per the
 * consensus M5 requirement.
 */
const RING = 5000

class Ring {
  private buf: number[] = []
  add(v: number) {
    this.buf.push(v)
    if (this.buf.length > RING) this.buf.shift()
  }
  pct(p: number): number {
    if (this.buf.length === 0) return 0
    const s = [...this.buf].sort((a, b) => a - b)
    const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length))
    return Math.round(s[i]!)
  }
}

export class Metrics {
  queueDepth = 0
  inFlight = 0
  totalGraded = 0
  totalErrors = 0
  private gradeLatency = new Ring()
  private dbLatency = new Ring()
  private completions: number[] = [] // timestamps (ms) for rolling throughput

  recordGrade(latencyMs: number) {
    this.gradeLatency.add(latencyMs)
    this.totalGraded++
    this.completions.push(Date.now())
  }
  recordError() {
    this.totalErrors++
  }
  recordDbWrite(latencyMs: number) {
    this.dbLatency.add(latencyMs)
  }

  private throughputRps(): number {
    const cutoff = Date.now() - 5000
    this.completions = this.completions.filter((t) => t >= cutoff)
    return Math.round((this.completions.length / 5) * 10) / 10
  }

  snapshot(workerConcurrency: number, mode: string) {
    return {
      mode,
      queueDepth: this.queueDepth,
      inFlight: this.inFlight,
      workerConcurrency,
      totalGraded: this.totalGraded,
      totalErrors: this.totalErrors,
      gradeLatencyP50: this.gradeLatency.pct(50),
      gradeLatencyP95: this.gradeLatency.pct(95),
      gradeLatencyP99: this.gradeLatency.pct(99),
      dbWriteLatencyP95: this.dbLatency.pct(95),
      throughputRps: this.throughputRps(),
    }
  }
}

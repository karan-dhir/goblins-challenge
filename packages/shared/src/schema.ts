/**
 * Shared Effect Schema types — the single source of truth for wire contracts
 * between the Next.js app and the standalone grading service. Both sides decode
 * at the boundary, so a malformed payload fails loudly with a typed error.
 *
 * Effect 3.x ships Schema from the core `effect` package (no separate
 * `@effect/schema` dependency).
 */
import { Schema } from "effect"

// ---- enums ----------------------------------------------------------------
export const GraderMode = Schema.Literal("real", "stub")
export type GraderMode = typeof GraderMode.Type

export const SubmissionStatus = Schema.Literal("pending", "grading", "graded", "error")
export type SubmissionStatus = typeof SubmissionStatus.Type

// ---- rubric ---------------------------------------------------------------
export const RubricCriterion = Schema.Struct({
  label: Schema.String,
  points: Schema.Number,
  descriptor: Schema.String,
})
export type RubricCriterion = typeof RubricCriterion.Type

export const Rubric = Schema.Struct({
  criteria: Schema.Array(RubricCriterion),
  maxPoints: Schema.Number,
  editedByTeacher: Schema.Boolean,
})
export type Rubric = typeof Rubric.Type

// ---- grade (the model's structured output, validated on the way out) ------
export const CriterionGrade = Schema.Struct({
  label: Schema.String,
  awarded: Schema.Number,
  max: Schema.Number,
  reasoning: Schema.String,
})
export type CriterionGrade = typeof CriterionGrade.Type

export const Grade = Schema.Struct({
  score: Schema.Number,
  maxPoints: Schema.Number,
  perCriterion: Schema.Array(CriterionGrade),
  model: Schema.String,
  latencyMs: Schema.Number,
})
export type Grade = typeof Grade.Type

// What the LLM is asked to return (no model/latency — the service stamps those).
export const ModelGradeOutput = Schema.Struct({
  score: Schema.Number,
  maxPoints: Schema.Number,
  perCriterion: Schema.Array(CriterionGrade),
})
export type ModelGradeOutput = typeof ModelGradeOutput.Type

// ---- grading job + wire types ---------------------------------------------
export const GradingJob = Schema.Struct({
  submissionId: Schema.String,
  rubric: Rubric,
  imageDataUrl: Schema.String, // data:image/png;base64,...
  problemPrompt: Schema.String,
})
export type GradingJob = typeof GradingJob.Type

// POST /grade body
export const GradeRequest = GradingJob
export type GradeRequest = GradingJob

// POST /grade response (202)
export const GradeAccepted = Schema.Struct({
  submissionId: Schema.String,
  status: SubmissionStatus,
})
export type GradeAccepted = typeof GradeAccepted.Type

// GET /grade/:submissionId response
export const GradeResult = Schema.Struct({
  submissionId: Schema.String,
  status: SubmissionStatus,
  grade: Schema.NullOr(Grade),
})
export type GradeResult = typeof GradeResult.Type

// GET /metrics response
export const Metrics = Schema.Struct({
  mode: GraderMode,
  queueDepth: Schema.Number,
  inFlight: Schema.Number,
  workerConcurrency: Schema.Number,
  totalGraded: Schema.Number,
  totalErrors: Schema.Number,
  gradeLatencyP50: Schema.Number,
  gradeLatencyP95: Schema.Number,
  gradeLatencyP99: Schema.Number,
  dbWriteLatencyP95: Schema.Number, // distinguishes queue saturation from Neon-pool stall
  throughputRps: Schema.Number,
})
export type Metrics = typeof Metrics.Type

// ---- codecs ---------------------------------------------------------------
export const decodeGradeRequest = Schema.decodeUnknown(GradeRequest)
export const decodeModelGradeOutput = Schema.decodeUnknown(ModelGradeOutput)
export const encodeGradeResult = Schema.encode(GradeResult)

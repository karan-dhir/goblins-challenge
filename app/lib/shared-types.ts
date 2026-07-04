/**
 * Wire types for the app, mirroring the Effect Schema in `packages/shared`
 * (which remains the source of truth — the grading service decodes with it).
 * Vendored here as plain types so the Next app deploys standalone (no workspace
 * dependency); all app imports of these are `import type` and erase at build.
 */
export type GraderMode = "real" | "stub"
export type SubmissionStatus = "pending" | "grading" | "graded" | "error"

export interface RubricCriterion {
  label: string
  points: number
  descriptor: string
}
export interface Rubric {
  criteria: RubricCriterion[]
  maxPoints: number
  editedByTeacher: boolean
}
export interface CriterionGrade {
  label: string
  awarded: number
  max: number
  reasoning: string
}
export interface Grade {
  score: number
  maxPoints: number
  perCriterion: CriterionGrade[]
  model: string
  latencyMs: number
}
export interface ModelGradeOutput {
  score: number
  maxPoints: number
  perCriterion: CriterionGrade[]
}
export interface GradingJob {
  submissionId: string
  rubric: Rubric
  imageDataUrl: string
  problemPrompt: string
}
export interface GradeResult {
  submissionId: string
  status: SubmissionStatus
  grade: Grade | null
}

-- Goblins auto-grader schema. Two non-overlapping writers:
--   app   -> assignment, problem, rubric, student, submission (insert)
--   service -> grade (insert) + submission.status (update) — in ONE transaction
-- Neon is the durable rendezvous; both connect via the POOLED connection string.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS assignment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  teacher_token text NOT NULL UNIQUE,
  access_code   text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problem (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id    uuid NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  ordinal          int  NOT NULL,
  prompt           text NOT NULL,
  reference_answer text
);

CREATE TABLE IF NOT EXISTS rubric (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id       uuid NOT NULL UNIQUE REFERENCES problem(id) ON DELETE CASCADE,
  criteria         jsonb NOT NULL,
  max_points       int  NOT NULL,
  edited_by_teacher boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS student (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submission (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  problem_id  uuid NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  image_data  text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','grading','graded','error')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grade (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL UNIQUE REFERENCES submission(id) ON DELETE CASCADE,
  score         int  NOT NULL,
  max_points    int  NOT NULL,
  per_criterion jsonb NOT NULL,
  model         text NOT NULL,
  latency_ms    int  NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignment_access_code ON assignment(access_code);
CREATE INDEX IF NOT EXISTS idx_assignment_teacher_token ON assignment(teacher_token);
CREATE INDEX IF NOT EXISTS idx_problem_assignment ON problem(assignment_id);
CREATE INDEX IF NOT EXISTS idx_student_assignment ON student(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submission_student_problem ON submission(student_id, problem_id);

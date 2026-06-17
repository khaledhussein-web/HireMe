BEGIN;

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'archived';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'hired';

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS featured_paid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS job_views (
  id BIGSERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  viewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_views_job
  ON job_views(job_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS employer_candidate_evaluations (
  id BIGSERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL
    REFERENCES applications(id) ON DELETE CASCADE,
  employer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  score SMALLINT CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  private_notes TEXT,
  skills_score SMALLINT CHECK (skills_score IS NULL OR skills_score BETWEEN 1 AND 5),
  experience_score SMALLINT CHECK (experience_score IS NULL OR experience_score BETWEEN 1 AND 5),
  culture_score SMALLINT CHECK (culture_score IS NULL OR culture_score BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, employer_user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_employer_candidate_evaluations_updated_at'
  ) THEN
    CREATE TRIGGER set_employer_candidate_evaluations_updated_at
    BEFORE UPDATE ON employer_candidate_evaluations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_application_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'submitted' AND NEW.status IN (
      'in_review',
      'rejected',
      'withdrawn'
    ))
    OR (OLD.status = 'in_review' AND NEW.status IN (
      'shortlisted',
      'rejected',
      'withdrawn'
    ))
    OR (OLD.status = 'shortlisted' AND NEW.status IN (
      'interview',
      'rejected',
      'withdrawn'
    ))
    OR (OLD.status = 'interview' AND NEW.status IN (
      'offered',
      'rejected',
      'withdrawn'
    ))
    OR (OLD.status = 'offered' AND NEW.status IN (
      'hired',
      'rejected',
      'withdrawn'
    ))
  ) THEN
    RAISE EXCEPTION
      'Invalid application status transition from % to %.',
      OLD.status,
      NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

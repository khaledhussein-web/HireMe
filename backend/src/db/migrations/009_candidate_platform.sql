BEGIN;

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS salary_min INTEGER CHECK (
    salary_min IS NULL OR salary_min >= 0
  ),
  ADD COLUMN IF NOT EXISTS salary_max INTEGER CHECK (
    salary_max IS NULL OR salary_max >= 0
  ),
  ADD COLUMN IF NOT EXISTS salary_currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS availability_notes TEXT,
  ADD COLUMN IF NOT EXISTS notice_period_days SMALLINT CHECK (
    notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 365
  ),
  ADD COLUMN IF NOT EXISTS open_to_relocation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) NOT NULL DEFAULT 'employers'
    CHECK (profile_visibility IN ('private', 'employers', 'public')),
  ADD CONSTRAINT candidate_salary_range CHECK (
    salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min
  );

CREATE TABLE IF NOT EXISTS candidate_certifications (
  id SERIAL PRIMARY KEY,
  candidate_profile_id INTEGER NOT NULL
    REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  issuer VARCHAR(180),
  issued_on DATE,
  expires_on DATE,
  credential_url VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT candidate_certification_date_order CHECK (
    expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on
  )
);

CREATE INDEX IF NOT EXISTS idx_candidate_certifications_candidate
  ON candidate_certifications(candidate_profile_id)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_candidate_certifications_updated_at'
  ) THEN
    CREATE TRIGGER set_candidate_certifications_updated_at
    BEFORE UPDATE ON candidate_certifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS candidate_profile_views (
  id BIGSERIAL PRIMARY KEY,
  candidate_profile_id INTEGER NOT NULL
    REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  viewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  viewer_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_profile_views_candidate
  ON candidate_profile_views(candidate_profile_id, viewed_at DESC);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS resume_id BIGINT
    REFERENCES candidate_resumes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;

COMMIT;

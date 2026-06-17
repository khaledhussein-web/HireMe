BEGIN;

ALTER TABLE candidate_profiles
  ADD COLUMN desired_roles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN preferred_workplace workplace_type;

ALTER TABLE jobs
  ADD COLUMN experience_level VARCHAR(30) NOT NULL DEFAULT 'entry_level'
    CHECK (
      experience_level IN (
        'internship',
        'entry_level',
        'mid_level',
        'senior_level'
      )
    );

CREATE INDEX idx_jobs_experience_level
  ON jobs(experience_level, status)
  WHERE deleted_at IS NULL;

-- Remove untouched demo listings. Employer-owned jobs and jobs with real
-- applications are intentionally preserved.
DELETE FROM jobs
WHERE created_by_user_id IS NULL
  AND company_id IN (
    SELECT id
    FROM companies
    WHERE owner_user_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM applications
    WHERE applications.job_id = jobs.id
  );

DELETE FROM companies
WHERE owner_user_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jobs
    WHERE jobs.company_id = companies.id
  );

COMMIT;

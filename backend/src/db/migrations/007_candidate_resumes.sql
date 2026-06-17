BEGIN;

CREATE TABLE candidate_resumes (
  id BIGSERIAL PRIMARY KEY,
  candidate_profile_id INTEGER NOT NULL UNIQUE
    REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  uploaded_by_user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(120) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_candidate_resumes_created
  ON candidate_resumes(created_at DESC);

CREATE TRIGGER set_candidate_resumes_updated_at
BEFORE UPDATE ON candidate_resumes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

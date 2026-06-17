BEGIN;

INSERT INTO roles (id, name, description)
VALUES (
  4,
  'tech_community',
  'Can manage a technology community profile and community opportunities.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (code, description)
VALUES
  ('communities.manage_own', 'Manage a community owned by the signed-in user.'),
  (
    'community_opportunities.manage_own',
    'Manage opportunities belonging to the signed-in community.'
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN (
  'profile.manage_own',
  'jobs.read',
  'communities.manage_own',
  'community_opportunities.manage_own'
)
WHERE roles.name = 'tech_community'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN (
  'communities.manage_own',
  'community_opportunities.manage_own'
)
WHERE roles.name = 'admin'
ON CONFLICT DO NOTHING;

ALTER TABLE users
  ADD COLUMN account_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending', 'active', 'suspended'));

UPDATE users
SET account_status = CASE
  WHEN is_active = FALSE THEN 'suspended'
  WHEN email_verified_at IS NULL THEN 'pending'
  ELSE 'active'
END;

ALTER TABLE candidate_profiles
  ADD COLUMN country VARCHAR(120),
  ADD COLUMN city VARCHAR(120),
  ADD COLUMN education_level VARCHAR(80),
  ADD COLUMN experience_level VARCHAR(30)
    CHECK (
      experience_level IS NULL
      OR experience_level IN (
        'student',
        'internship',
        'entry_level',
        'mid_level',
        'senior_level'
      )
    ),
  ADD COLUMN preferred_work_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN preferred_job_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN preferred_locations TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN github_url VARCHAR(500),
  ADD COLUMN profile_completion_percentage SMALLINT NOT NULL DEFAULT 0
    CHECK (profile_completion_percentage BETWEEN 0 AND 100),
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN onboarding_step SMALLINT NOT NULL DEFAULT 1
    CHECK (onboarding_step BETWEEN 1 AND 5);

UPDATE candidate_profiles
SET
  city = COALESCE(city, location),
  country = COALESCE(country, location);

ALTER TABLE companies
  ADD COLUMN country VARCHAR(120),
  ADD COLUMN city VARCHAR(120),
  ADD COLUMN profile_completion_percentage SMALLINT NOT NULL DEFAULT 0
    CHECK (profile_completion_percentage BETWEEN 0 AND 100),
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN onboarding_step SMALLINT NOT NULL DEFAULT 1
    CHECK (onboarding_step BETWEEN 1 AND 4);

UPDATE companies
SET
  city = COALESCE(city, headquarters_location),
  country = COALESCE(country, headquarters_location);

CREATE TABLE community_profiles (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL UNIQUE
    REFERENCES users(id) ON DELETE RESTRICT,
  community_name VARCHAR(200),
  description TEXT,
  category VARCHAR(120),
  university_name VARCHAR(200),
  website_url VARCHAR(500),
  country VARCHAR(120),
  city VARCHAR(120),
  technical_tracks TEXT[] NOT NULL DEFAULT '{}',
  contact_email VARCHAR(320),
  verification_status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (
      verification_status IN ('draft', 'pending', 'approved', 'rejected')
    ),
  profile_completion_percentage SMALLINT NOT NULL DEFAULT 0
    CHECK (profile_completion_percentage BETWEEN 0 AND 100),
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_step SMALLINT NOT NULL DEFAULT 1
    CHECK (onboarding_step BETWEEN 1 AND 4),
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_community_profiles_verification
  ON community_profiles(verification_status, submitted_at)
  WHERE deleted_at IS NULL;

CREATE TABLE profile_assets (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_type VARCHAR(30) NOT NULL
    CHECK (
      asset_type IN (
        'candidate_photo',
        'company_logo',
        'community_logo'
      )
    ),
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 3145728),
  sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_type)
);

CREATE INDEX idx_profile_assets_user ON profile_assets(user_id);

CREATE TABLE community_verification_reviews (
  id BIGSERIAL PRIMARY KEY,
  community_profile_id INTEGER NOT NULL
    REFERENCES community_profiles(id) ON DELETE RESTRICT,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision VARCHAR(20) NOT NULL
    CHECK (decision IN ('approved', 'rejected')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_community_profiles_updated_at
BEFORE UPDATE ON community_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_profile_assets_updated_at
BEFORE UPDATE ON profile_assets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

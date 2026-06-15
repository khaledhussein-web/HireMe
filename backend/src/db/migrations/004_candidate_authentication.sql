BEGIN;

-- Verification applies to registrations created after this migration. Existing
-- active accounts retain access and can verify again later if required.
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at)
WHERE deleted_at IS NULL;

INSERT INTO candidate_profiles (user_id)
SELECT users.id
FROM users
JOIN roles ON roles.id = users.role_id
WHERE roles.name = 'candidate'
  AND users.deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE email_verification_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_verification_tokens_user
  ON email_verification_tokens(user_id, created_at DESC);
CREATE INDEX idx_email_verification_tokens_active
  ON email_verification_tokens(expires_at)
  WHERE used_at IS NULL;

CREATE TABLE password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_tokens_user
  ON password_reset_tokens(user_id, created_at DESC);
CREATE INDEX idx_password_reset_tokens_active
  ON password_reset_tokens(expires_at)
  WHERE used_at IS NULL;

CREATE TABLE refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by_ip INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user
  ON refresh_tokens(user_id, created_at DESC);
CREATE INDEX idx_refresh_tokens_active
  ON refresh_tokens(expires_at)
  WHERE revoked_at IS NULL;

COMMIT;

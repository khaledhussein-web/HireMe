BEGIN;

CREATE TYPE auth_provider AS ENUM ('google', 'apple', 'microsoft');

ALTER TABLE users
  ADD COLUMN full_name VARCHAR(150),
  ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE user_auth_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider auth_provider NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_auth_provider_user UNIQUE (provider, provider_user_id),
  CONSTRAINT uq_user_auth_provider UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_auth_accounts_user_id
  ON user_auth_accounts(user_id);

COMMIT;

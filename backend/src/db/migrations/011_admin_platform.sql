BEGIN;

CREATE TABLE IF NOT EXISTS content_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reported_entity_type VARCHAR(60) NOT NULL
    CHECK (
      reported_entity_type IN (
        'job',
        'company',
        'candidate',
        'community',
        'application',
        'user',
        'other'
      )
    ),
  reported_entity_id INTEGER,
  reason VARCHAR(180) NOT NULL,
  details TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_notes TEXT,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status
  ON content_reports(status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS platform_categories (
  id SERIAL PRIMARY KEY,
  category_type VARCHAR(40) NOT NULL
    CHECK (category_type IN ('industry', 'location', 'skill', 'job_category')),
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (category_type, slug)
);

CREATE INDEX IF NOT EXISTS idx_platform_categories_type
  ON platform_categories(category_type, is_active)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_content_reports_updated_at'
  ) THEN
    CREATE TRIGGER set_content_reports_updated_at
    BEFORE UPDATE ON content_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_platform_categories_updated_at'
  ) THEN
    CREATE TRIGGER set_platform_categories_updated_at
    BEFORE UPDATE ON platform_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;

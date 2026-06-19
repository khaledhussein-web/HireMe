BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS action_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS deduplication_key VARCHAR(180),
  ADD COLUMN IF NOT EXISTS in_app_visible BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_status VARCHAR(20) NOT NULL DEFAULT 'skipped',
  ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_email_status_check'
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_email_status_check
      CHECK (email_status IN ('skipped', 'pending', 'sent', 'failed'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_deduplication
  ON notifications(user_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_feed
  ON notifications(user_id, created_at DESC)
  WHERE in_app_visible = TRUE AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  phone_e164 VARCHAR(30),
  whatsapp_number VARCHAR(30),
  event_preferences JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_notification_preferences_updated_at'
  ) THEN
    CREATE TRIGGER set_notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;

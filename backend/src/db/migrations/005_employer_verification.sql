BEGIN;

ALTER TABLE companies
  ADD COLUMN registration_number VARCHAR(120),
  ADD COLUMN tax_identifier VARCHAR(120),
  ADD COLUMN contact_email VARCHAR(320),
  ADD COLUMN contact_phone VARCHAR(40),
  ADD COLUMN verification_status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (
      verification_status IN (
        'draft',
        'pending',
        'approved',
        'rejected'
      )
    ),
  ADD COLUMN submitted_at TIMESTAMPTZ,
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by_user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN rejection_reason TEXT;

CREATE UNIQUE INDEX uq_companies_owner
  ON companies(owner_user_id)
  WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_companies_verification_queue
  ON companies(verification_status, submitted_at)
  WHERE deleted_at IS NULL;

CREATE TABLE company_documents (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_type VARCHAR(40) NOT NULL
    CHECK (
      document_type IN (
        'business_registration',
        'tax_certificate',
        'owner_identification',
        'address_proof',
        'other'
      )
    ),
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_company_documents_company
  ON company_documents(company_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE company_verification_reviews (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision VARCHAR(20) NOT NULL
    CHECK (decision IN ('approved', 'rejected')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_company_verification_reviews_company
  ON company_verification_reviews(company_id, created_at DESC);

COMMIT;

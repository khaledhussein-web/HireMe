BEGIN;

CREATE TABLE roles (
  id SMALLINT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

INSERT INTO roles (id, name, description)
VALUES
  (1, 'candidate', 'Can maintain a profile and apply for opportunities.'),
  (2, 'employer', 'Can manage a company, jobs, and candidate workflows.'),
  (3, 'admin', 'Can administer the platform and review audit history.');

INSERT INTO permissions (code, description)
VALUES
  ('profile.manage_own', 'Manage the signed-in user profile.'),
  ('jobs.read', 'Browse published jobs.'),
  ('jobs.save', 'Save jobs for later.'),
  ('applications.create', 'Submit applications.'),
  ('applications.read_own', 'Read the signed-in candidate applications.'),
  ('companies.manage_own', 'Manage a company owned by the signed-in employer.'),
  ('jobs.manage_own', 'Manage jobs belonging to the employer company.'),
  ('applications.manage_company', 'Manage applications for company jobs.'),
  ('interviews.manage_company', 'Schedule and manage company interviews.'),
  ('reports.read_company', 'Read reports for the employer company.'),
  ('platform.manage', 'Manage platform-wide records and configuration.'),
  ('audit_logs.read', 'Read platform audit logs.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN (
  'profile.manage_own',
  'jobs.read',
  'jobs.save',
  'applications.create',
  'applications.read_own'
)
WHERE roles.name = 'candidate';

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code IN (
  'profile.manage_own',
  'jobs.read',
  'companies.manage_own',
  'jobs.manage_own',
  'applications.manage_company',
  'interviews.manage_company',
  'reports.read_company'
)
WHERE roles.name = 'employer';

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
CROSS JOIN permissions
WHERE roles.name = 'admin';

ALTER TABLE users
  ADD COLUMN role_id SMALLINT REFERENCES roles(id) ON DELETE RESTRICT,
  ADD COLUMN deleted_at TIMESTAMPTZ;

UPDATE users
SET role_id = roles.id
FROM roles
WHERE roles.name = users.role::TEXT;

ALTER TABLE users
  ALTER COLUMN role_id SET DEFAULT 1,
  ALTER COLUMN role_id SET NOT NULL,
  DROP COLUMN role;

DROP TYPE user_role;

CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_active ON users(is_active) WHERE deleted_at IS NULL;

CREATE TABLE candidate_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  phone VARCHAR(30),
  location VARCHAR(150),
  date_of_birth DATE,
  headline VARCHAR(180),
  bio TEXT,
  years_experience SMALLINT CHECK (years_experience BETWEEN 0 AND 80),
  linkedin_url VARCHAR(500),
  portfolio_url VARCHAR(500),
  resume_url VARCHAR(500),
  availability_status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (availability_status IN ('open', 'interviewing', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE companies
  ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN industry VARCHAR(120),
  ADD COLUMN company_size VARCHAR(40),
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX idx_companies_owner ON companies(owner_user_id);
CREATE INDEX idx_companies_active_slug ON companies(slug) WHERE deleted_at IS NULL;

ALTER TABLE jobs
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE applications
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE jobs
  DROP CONSTRAINT jobs_company_id_fkey,
  ADD CONSTRAINT jobs_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;

ALTER TABLE applications
  DROP CONSTRAINT applications_job_id_fkey,
  ADD CONSTRAINT applications_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_applications_candidate_job
  ON applications(candidate_user_id, job_id)
  WHERE candidate_user_id IS NOT NULL;

CREATE TABLE skills (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  category VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_skills_active_name
  ON skills(LOWER(name))
  WHERE deleted_at IS NULL;

CREATE TABLE candidate_skills (
  candidate_profile_id INTEGER NOT NULL
    REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  proficiency_level VARCHAR(20) NOT NULL DEFAULT 'intermediate'
    CHECK (
      proficiency_level IN (
        'beginner',
        'intermediate',
        'advanced',
        'expert'
      )
    ),
  years_experience NUMERIC(4, 1) CHECK (
    years_experience IS NULL OR years_experience BETWEEN 0 AND 80
  ),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (candidate_profile_id, skill_id)
);

CREATE TABLE job_skills (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  required_level VARCHAR(20) NOT NULL DEFAULT 'intermediate'
    CHECK (
      required_level IN (
        'beginner',
        'intermediate',
        'advanced',
        'expert'
      )
    ),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_years_experience NUMERIC(4, 1) CHECK (
    minimum_years_experience IS NULL
    OR minimum_years_experience BETWEEN 0 AND 80
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, skill_id)
);

CREATE TABLE universities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  website_url VARCHAR(500),
  city VARCHAR(120),
  country VARCHAR(120),
  contact_email VARCHAR(255),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE education (
  id SERIAL PRIMARY KEY,
  candidate_profile_id INTEGER NOT NULL
    REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  university_id INTEGER REFERENCES universities(id) ON DELETE SET NULL,
  institution_name VARCHAR(200) NOT NULL,
  degree VARCHAR(150),
  field_of_study VARCHAR(150),
  start_date DATE,
  end_date DATE,
  grade VARCHAR(50),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT education_date_order CHECK (
    end_date IS NULL OR start_date IS NULL OR end_date >= start_date
  )
);

CREATE INDEX idx_education_candidate
  ON education(candidate_profile_id)
  WHERE deleted_at IS NULL;

CREATE TABLE work_experience (
  id SERIAL PRIMARY KEY,
  candidate_profile_id INTEGER NOT NULL
    REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  company_name VARCHAR(200) NOT NULL,
  job_title VARCHAR(180) NOT NULL,
  employment_type employment_type,
  location VARCHAR(150),
  start_date DATE NOT NULL,
  end_date DATE,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT work_experience_date_order CHECK (
    end_date IS NULL OR end_date >= start_date
  ),
  CONSTRAINT current_work_has_no_end_date CHECK (
    NOT is_current OR end_date IS NULL
  )
);

CREATE INDEX idx_work_experience_candidate
  ON work_experience(candidate_profile_id)
  WHERE deleted_at IS NULL;

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  candidate_profile_id INTEGER NOT NULL
    REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  project_url VARCHAR(500),
  repository_url VARCHAR(500),
  started_at DATE,
  completed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT project_date_order CHECK (
    completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at
  )
);

CREATE INDEX idx_projects_candidate
  ON projects(candidate_profile_id)
  WHERE deleted_at IS NULL;

CREATE TABLE saved_jobs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, job_id)
);

CREATE INDEX idx_saved_jobs_job ON saved_jobs(job_id);

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body TEXT,
  related_entity_type VARCHAR(60),
  related_entity_id INTEGER,
  delivery_channel VARCHAR(20) NOT NULL DEFAULT 'in_app'
    CHECK (delivery_channel IN ('in_app', 'email', 'sms', 'push')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE TABLE interviews (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL
    REFERENCES applications(id) ON DELETE RESTRICT,
  scheduled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  interviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  interview_type VARCHAR(30) NOT NULL
    CHECK (
      interview_type IN (
        'phone',
        'video',
        'on_site',
        'technical',
        'panel'
      )
    ),
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
    CHECK (
      status IN (
        'scheduled',
        'confirmed',
        'completed',
        'canceled',
        'no_show'
      )
    ),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  location_or_url VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT interview_time_order CHECK (ends_at > starts_at)
);

CREATE INDEX idx_interviews_application ON interviews(application_id);
CREATE INDEX idx_interviews_interviewer_time
  ON interviews(interviewer_user_id, starts_at)
  WHERE deleted_at IS NULL;

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  subject VARCHAR(180),
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT message_participants_differ CHECK (
    sender_user_id <> recipient_user_id
  )
);

CREATE INDEX idx_messages_recipient
  ON messages(recipient_user_id, sent_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_application ON messages(application_id);

CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  plan_code VARCHAR(50) NOT NULL,
  plan_name VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'trial'
    CHECK (
      status IN ('trial', 'active', 'past_due', 'canceled', 'expired')
    ),
  billing_period VARCHAR(20) NOT NULL
    CHECK (billing_period IN ('monthly', 'yearly', 'per_job', 'custom')),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  starts_at TIMESTAMPTZ NOT NULL,
  current_period_ends_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  provider VARCHAR(40),
  provider_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT subscription_period_order CHECK (
    current_period_ends_at IS NULL OR current_period_ends_at >= starts_at
  )
);

CREATE UNIQUE INDEX uq_subscriptions_provider_reference
  ON subscriptions(provider, provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;
CREATE INDEX idx_subscriptions_company_status
  ON subscriptions(company_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'processing',
        'paid',
        'failed',
        'refunded',
        'partially_refunded'
      )
    ),
  provider VARCHAR(40),
  provider_payment_id VARCHAR(255),
  paid_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_payments_provider_reference
  ON payments(provider, provider_payment_id)
  WHERE provider IS NOT NULL AND provider_payment_id IS NOT NULL;
CREATE INDEX idx_payments_company_created
  ON payments(company_id, created_at DESC);

CREATE TABLE internships (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  university_id INTEGER REFERENCES universities(id) ON DELETE SET NULL,
  candidate_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supervisor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'planned'
    CHECK (
      status IN (
        'planned',
        'active',
        'completed',
        'canceled',
        'terminated'
      )
    ),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  goals TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT internship_date_order CHECK (ends_on >= starts_on)
);

CREATE INDEX idx_internships_candidate
  ON internships(candidate_user_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_internships_company
  ON internships(company_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE weekly_reports (
  id SERIAL PRIMARY KEY,
  internship_id INTEGER NOT NULL REFERENCES internships(id) ON DELETE RESTRICT,
  submitted_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  accomplishments TEXT NOT NULL,
  challenges TEXT,
  next_week_plan TEXT,
  hours_worked NUMERIC(5, 2) CHECK (
    hours_worked IS NULL OR hours_worked BETWEEN 0 AND 168
  ),
  supervisor_feedback TEXT,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT weekly_report_date_order CHECK (week_end >= week_start),
  CONSTRAINT weekly_report_max_span CHECK (week_end - week_start <= 6)
);

CREATE UNIQUE INDEX uq_weekly_reports_internship_week
  ON weekly_reports(internship_id, week_start)
  WHERE deleted_at IS NULL;

CREATE TABLE evaluations (
  id SERIAL PRIMARY KEY,
  internship_id INTEGER NOT NULL REFERENCES internships(id) ON DELETE RESTRICT,
  evaluator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evaluation_type VARCHAR(30) NOT NULL
    CHECK (evaluation_type IN ('midterm', 'final', 'ad_hoc')),
  period_start DATE,
  period_end DATE,
  overall_rating NUMERIC(2, 1) NOT NULL CHECK (
    overall_rating BETWEEN 1 AND 5
  ),
  competency_scores JSONB NOT NULL DEFAULT '{}'::JSONB,
  strengths TEXT,
  improvement_areas TEXT,
  recommendation VARCHAR(30)
    CHECK (
      recommendation IS NULL
      OR recommendation IN (
        'strongly_recommend',
        'recommend',
        'neutral',
        'do_not_recommend'
      )
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT evaluation_period_order CHECK (
    period_end IS NULL OR period_start IS NULL OR period_end >= period_start
  )
);

CREATE INDEX idx_evaluations_internship
  ON evaluations(internship_id)
  WHERE deleted_at IS NULL;

CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  report_type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  parameters JSONB NOT NULL DEFAULT '{}'::JSONB,
  result_data JSONB,
  file_url VARCHAR(500),
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_reports_company_created
  ON reports(company_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(100),
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor
  ON audit_logs(actor_user_id, created_at DESC);

CREATE TABLE application_status_history (
  id BIGSERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL
    REFERENCES applications(id) ON DELETE RESTRICT,
  old_status application_status,
  new_status application_status NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes VARCHAR(500),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_application_status_history_application
  ON application_status_history(application_id, changed_at DESC);

INSERT INTO application_status_history (
  application_id,
  old_status,
  new_status,
  changed_at
)
SELECT id, NULL, status, submitted_at
FROM applications;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_roles_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_permissions_updated_at
BEFORE UPDATE ON permissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_candidate_profiles_updated_at
BEFORE UPDATE ON candidate_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_companies_updated_at
BEFORE UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_applications_updated_at
BEFORE UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_skills_updated_at
BEFORE UPDATE ON skills
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_candidate_skills_updated_at
BEFORE UPDATE ON candidate_skills
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_job_skills_updated_at
BEFORE UPDATE ON job_skills
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_universities_updated_at
BEFORE UPDATE ON universities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_education_updated_at
BEFORE UPDATE ON education
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_work_experience_updated_at
BEFORE UPDATE ON work_experience
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_interviews_updated_at
BEFORE UPDATE ON interviews
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_internships_updated_at
BEFORE UPDATE ON internships
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_weekly_reports_updated_at
BEFORE UPDATE ON weekly_reports
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_evaluations_updated_at
BEFORE UPDATE ON evaluations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_reports_updated_at
BEFORE UPDATE ON reports
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION validate_company_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_role VARCHAR(50);
BEGIN
  IF NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'A company must be linked to an owner account.';
  END IF;

  SELECT roles.name
  INTO owner_role
  FROM users
  JOIN roles ON roles.id = users.role_id
  WHERE users.id = NEW.owner_user_id
    AND users.is_active = TRUE
    AND users.deleted_at IS NULL;

  IF owner_role IS DISTINCT FROM 'employer' THEN
    RAISE EXCEPTION 'Company owner must be an active employer account.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_company_owner_on_insert
BEFORE INSERT ON companies
FOR EACH ROW EXECUTE FUNCTION validate_company_owner();

CREATE TRIGGER validate_company_owner_on_change
BEFORE UPDATE OF owner_user_id ON companies
FOR EACH ROW EXECUTE FUNCTION validate_company_owner();

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
    OR (OLD.status = 'offered' AND NEW.status = 'withdrawn')
  ) THEN
    RAISE EXCEPTION
      'Invalid application status transition from % to %.',
      OLD.status,
      NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_application_status
BEFORE UPDATE OF status ON applications
FOR EACH ROW EXECUTE FUNCTION validate_application_status_transition();

CREATE OR REPLACE FUNCTION record_application_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO application_status_history (
      application_id,
      old_status,
      new_status
    )
    VALUES (NEW.id, NULL, NEW.status);
  ELSIF NEW.status <> OLD.status THEN
    INSERT INTO application_status_history (
      application_id,
      old_status,
      new_status
    )
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER record_initial_application_status
AFTER INSERT ON applications
FOR EACH ROW EXECUTE FUNCTION record_application_status_change();

CREATE TRIGGER record_application_status
AFTER UPDATE OF status ON applications
FOR EACH ROW EXECUTE FUNCTION record_application_status_change();

COMMIT;

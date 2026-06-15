BEGIN;

CREATE TYPE user_role AS ENUM ('candidate', 'employer', 'admin');
CREATE TYPE employment_type AS ENUM (
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary'
);
CREATE TYPE workplace_type AS ENUM ('remote', 'hybrid', 'on_site');
CREATE TYPE job_status AS ENUM ('draft', 'published', 'closed');
CREATE TYPE application_status AS ENUM (
  'submitted',
  'in_review',
  'shortlisted',
  'interview',
  'offered',
  'rejected',
  'withdrawn'
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'candidate'::user_role,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  website_url VARCHAR(500),
  logo_url VARCHAR(500),
  description TEXT,
  headquarters_location VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE jobs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  slug VARCHAR(220) NOT NULL UNIQUE,
  employment_type employment_type NOT NULL,
  workplace_type workplace_type NOT NULL,
  city VARCHAR(120),
  country VARCHAR(120),
  salary_min INTEGER CHECK (salary_min >= 0),
  salary_max INTEGER CHECK (salary_max >= 0),
  salary_currency CHAR(3) NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  requirements TEXT,
  responsibilities TEXT,
  status job_status NOT NULL DEFAULT 'published'::job_status,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_salary_range CHECK (
    salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min
  )
);

CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_jobs_status_workplace ON jobs(status, workplace_type);
CREATE INDEX idx_jobs_published_at ON jobs(published_at DESC);

CREATE TABLE applications (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  location VARCHAR(150) NOT NULL,
  years_experience SMALLINT NOT NULL CHECK (
    years_experience BETWEEN 0 AND 50
  ),
  linkedin_url VARCHAR(500),
  portfolio_url VARCHAR(500),
  cover_letter TEXT NOT NULL,
  role_answers JSONB NOT NULL DEFAULT '{}'::JSONB,
  status application_status NOT NULL DEFAULT 'submitted'::application_status,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_applications_job ON applications(job_id);
CREATE INDEX idx_applications_candidate ON applications(candidate_user_id);
CREATE INDEX idx_applications_status ON applications(status);

INSERT INTO companies (name, slug, headquarters_location)
VALUES
  ('TechCorp Inc.', 'techcorp-inc', 'Remote'),
  ('InnovateLabs', 'innovatelabs', 'New York, USA'),
  ('DesignStudio', 'designstudio', 'London, UK'),
  ('DataCo Analytics', 'dataco-analytics', 'Remote'),
  ('CloudSystems', 'cloudsystems', 'Berlin, Germany'),
  ('AppMakers Inc.', 'appmakers-inc', 'Remote');

INSERT INTO jobs (
  company_id,
  title,
  slug,
  employment_type,
  workplace_type,
  salary_min,
  salary_max,
  description,
  status,
  published_at,
  featured
)
SELECT
  companies.id,
  seed.title,
  seed.slug,
  CAST(seed.employment_type AS employment_type),
  CAST(seed.workplace_type AS workplace_type),
  seed.salary_min,
  seed.salary_max,
  seed.description,
  'published'::job_status,
  NOW(),
  TRUE
FROM (
  VALUES
    ('TechCorp Inc.', 'Senior Frontend Developer', 'senior-frontend-developer', 'full_time', 'remote', 80000, 120000, 'Build accessible, high-quality web experiences with a growing product team.'),
    ('InnovateLabs', 'Product Manager', 'product-manager', 'full_time', 'hybrid', 90000, 140000, 'Lead product strategy and execution for a flagship SaaS platform.'),
    ('DesignStudio', 'UX/UI Designer', 'ux-ui-designer', 'contract', 'on_site', 70000, 100000, 'Create intuitive user experiences for web and mobile products.'),
    ('DataCo Analytics', 'Data Scientist', 'data-scientist', 'full_time', 'remote', 100000, 150000, 'Analyze complex datasets and build models that drive useful insights.'),
    ('CloudSystems', 'DevOps Engineer', 'devops-engineer', 'full_time', 'hybrid', 85000, 130000, 'Improve cloud infrastructure, observability, and delivery pipelines.'),
    ('AppMakers Inc.', 'Mobile App Developer', 'mobile-app-developer', 'full_time', 'remote', 75000, 115000, 'Develop modern mobile applications for iOS and Android.')
) AS seed (
  company_name,
  title,
  slug,
  employment_type,
  workplace_type,
  salary_min,
  salary_max,
  description
)
JOIN companies ON companies.name = seed.company_name;

COMMIT;

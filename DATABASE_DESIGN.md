# Phase 2 Database Design

The PostgreSQL schema is defined by the ordered migrations in
`backend/src/db/migrations`.

## Core relationships

- Each `users` row has exactly one `role_id`.
- Roles receive permissions through `role_permissions`.
- Each new `companies` row must reference an active employer through
  `owner_user_id`.
- A candidate profile belongs to one user.
- Jobs belong to companies and may reference the user who created them.
- Applications connect candidates to jobs.
- Candidate and job skills share the normalized `skills` catalog.
- Education, work experience, and projects belong to candidate profiles.
- Internships connect a candidate, company, optional university, optional job,
  and supervisor.
- Weekly reports and evaluations belong to internships.
- Subscriptions and payments belong to companies.

## Enforced business rules

### One role per user

`users.role_id` is a non-null foreign key to `roles`. The previous PostgreSQL
role enum is migrated into the normalized table by migration `003`.

### Company ownership

New companies must have an `owner_user_id`. A database trigger verifies that
the owner is an active, non-deleted employer account. Companies seeded before
Phase 2 remain ownerless until an employer claims them.

### Duplicate applications

The partial unique index `uq_applications_candidate_job` prevents an active
candidate account from applying to the same job more than once. Soft deletion
does not remove that historical uniqueness guarantee.

### Controlled application transitions

The database allows these transitions:

| From | To |
| --- | --- |
| `submitted` | `in_review`, `rejected`, `withdrawn` |
| `in_review` | `shortlisted`, `rejected`, `withdrawn` |
| `shortlisted` | `interview`, `rejected`, `withdrawn` |
| `interview` | `offered`, `rejected`, `withdrawn` |
| `offered` | `withdrawn` |

`rejected` and `withdrawn` are terminal. Every successful status change is
recorded in `application_status_history`.

### Soft deletion

Business records that may be needed for history use `deleted_at`. API reads for
users, companies, jobs, and applications exclude deleted records. Financial
transactions and audit logs are immutable history and are not soft deleted.

## Supporting tables

The design adds two supporting tables beyond the requested core list:

- `role_permissions` normalizes the many-to-many role permission relationship.
- `application_status_history` preserves the application workflow audit trail.

## Applying the schema

For a new Docker database, the SQL files run in filename order. For an existing
database, apply `003_phase2_database_design.sql` after migrations `001` and
`002`, followed by `004_candidate_authentication.sql` and
`005_employer_verification.sql`.

## Employer verification

Migration `005` adds company registration details, verification state,
private document metadata, and immutable review history. Company submissions
move from `draft` to `pending`; only an admin can move a pending submission to
`approved` or `rejected`. Each decision creates an in-app notification and an
audit log entry.

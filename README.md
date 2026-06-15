
# HireMe

HireMe is built with:

- React 19 with Vite
- Node.js and Express
- PostgreSQL

## First-time setup

```powershell
npm run install:all
Copy-Item backend/.env.example backend/.env
```

Configure `backend/.env` with your PostgreSQL connection. The current local
development database is:

```text
postgresql://postgres:1234@localhost:5432/hireme_db
```

`docker compose up -d` is available only as an alternative when a local
PostgreSQL server is not already using port `5432`.

## Run the application

```powershell
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000/api
- API health check: http://localhost:5000/api/health

## Authentication

Email/password registration and login are available at:

- http://localhost:5173/signup
- http://localhost:5173/login

Candidate authentication includes email verification, login/logout, rotating
refresh tokens, forgot/reset password, and profile completion. Access and
refresh tokens use separate HTTP-only cookies.

No email provider is configured yet. In development, verification and password
reset responses include a local action link so the complete flow can be tested.
Production responses never expose these tokens; connect an email delivery
provider before deploying registration or password recovery.

Social sign-in buttons are prepared for:

- Google
- Apple
- Microsoft/Outlook

Add the matching OAuth credentials to `backend/.env` to configure a provider.
Apple Sign In also requires an Apple Developer account, Services ID, Team ID,
Key ID, private key, HTTPS, and a registered callback URL.

## Employer onboarding

Employer onboarding is available at:

- `http://localhost:5173/for-employers` for employer registration
- `http://localhost:5173/employer/company` for company submission and documents
- `http://localhost:5173/admin/verifications` for admin review

To grant an existing verified account the admin role in PostgreSQL:

```sql
UPDATE users
SET role_id = (SELECT id FROM roles WHERE name = 'admin')
WHERE email = 'admin@example.com';
```

Employer verification documents are stored privately in
`backend/private-uploads/company-documents` and are available only through an
authenticated admin endpoint.

## Build the frontend

```powershell
npm run build
```

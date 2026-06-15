import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const applicationsRouter = Router()

applicationsRouter.use(requireAuth, requireRole('candidate'))

applicationsRouter.get('/', async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          applications.id,
          applications.status,
          applications.submitted_at AS "submittedAt",
          jobs.title AS "jobTitle",
          jobs.slug AS "jobSlug",
          companies.name AS company
        FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        JOIN companies ON companies.id = jobs.company_id
        WHERE applications.candidate_user_id = $1
          AND applications.deleted_at IS NULL
          AND jobs.deleted_at IS NULL
          AND companies.deleted_at IS NULL
        ORDER BY applications.submitted_at DESC
      `,
      [Number(request.auth.sub)],
    )

    response.json({ applications: rows })
  } catch (error) {
    next(error)
  }
})

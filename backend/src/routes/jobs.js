import { Router } from 'express'
import { pool } from '../db/pool.js'

export const jobsRouter = Router()

jobsRouter.get('/', async (request, response, next) => {
  const keyword = String(request.query.keyword ?? '').trim()
  const location = String(request.query.location ?? '').trim()

  try {
    const { rows } = await pool.query(
      `
        SELECT
          jobs.id,
          jobs.title,
          jobs.slug,
          jobs.employment_type AS "employmentType",
          jobs.workplace_type AS "workplaceType",
          jobs.salary_min AS "salaryMin",
          jobs.salary_max AS "salaryMax",
          jobs.salary_currency AS "salaryCurrency",
          jobs.description,
          companies.name AS company
        FROM jobs
        JOIN companies ON companies.id = jobs.company_id
        WHERE jobs.status = 'published'
          AND jobs.deleted_at IS NULL
          AND companies.deleted_at IS NULL
          AND (
            $1 = ''
            OR jobs.title ILIKE '%' || $1 || '%'
            OR companies.name ILIKE '%' || $1 || '%'
            OR jobs.description ILIKE '%' || $1 || '%'
          )
          AND (
            $2 = ''
            OR REPLACE(jobs.workplace_type::TEXT, '_', ' ') ILIKE '%' || $2 || '%'
            OR jobs.city ILIKE '%' || $2 || '%'
            OR jobs.country ILIKE '%' || $2 || '%'
          )
        ORDER BY jobs.featured DESC, jobs.published_at DESC
      `,
      [keyword, location],
    )

    response.json({ jobs: rows })
  } catch (error) {
    next(error)
  }
})

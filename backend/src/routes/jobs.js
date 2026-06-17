import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const jobsRouter = Router()

jobsRouter.get('/', async (request, response, next) => {
  const keyword = String(request.query.keyword ?? '').trim()
  const location = String(request.query.location ?? '').trim()
  const workplaceType = String(request.query.workplaceType ?? '').trim()
  const employmentType = String(request.query.employmentType ?? '').trim()
  const experienceLevel = String(request.query.experienceLevel ?? '').trim()
  const industry = String(request.query.industry ?? '').trim()
  const salaryMin = Number(request.query.salaryMin)
  const salaryMax = Number(request.query.salaryMax)
  const datePublished = Number(request.query.datePublished)
  const requiredSkills = String(request.query.skills ?? '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 20)

  try {
    const { rows } = await pool.query(
      `
        SELECT
          jobs.id,
          jobs.title,
          jobs.slug,
          jobs.employment_type AS "employmentType",
          jobs.workplace_type AS "workplaceType",
          jobs.experience_level AS "experienceLevel",
          jobs.city,
          jobs.country,
          jobs.salary_min AS "salaryMin",
          jobs.salary_max AS "salaryMax",
          jobs.salary_currency AS "salaryCurrency",
          jobs.description,
          jobs.requirements,
          jobs.responsibilities,
          jobs.published_at AS "publishedAt",
          jobs.expires_at AS "expiresAt",
          companies.name AS company,
          companies.industry,
          COALESCE(job_skill_names.names, '{}') AS "requiredSkills"
        FROM jobs
        JOIN companies ON companies.id = jobs.company_id
        LEFT JOIN LATERAL (
          SELECT ARRAY_AGG(skills.name ORDER BY skills.name) AS names
          FROM job_skills
          JOIN skills ON skills.id = job_skills.skill_id
          WHERE job_skills.job_id = jobs.id
            AND job_skills.is_required = TRUE
            AND skills.deleted_at IS NULL
        ) AS job_skill_names ON TRUE
        WHERE jobs.status = 'published'
          AND jobs.deleted_at IS NULL
          AND companies.deleted_at IS NULL
          AND companies.verification_status = 'approved'
          AND (jobs.expires_at IS NULL OR jobs.expires_at >= NOW())
          AND (
            $1 = ''
            OR jobs.title ILIKE '%' || $1 || '%'
            OR companies.name ILIKE '%' || $1 || '%'
            OR jobs.description ILIKE '%' || $1 || '%'
            OR jobs.requirements ILIKE '%' || $1 || '%'
          )
          AND (
            $2 = ''
            OR REPLACE(jobs.workplace_type::TEXT, '_', ' ') ILIKE '%' || $2 || '%'
            OR jobs.city ILIKE '%' || $2 || '%'
            OR jobs.country ILIKE '%' || $2 || '%'
          )
          AND ($3 = '' OR jobs.workplace_type::TEXT = $3)
          AND ($4 = '' OR jobs.employment_type::TEXT = $4)
          AND ($5 = '' OR jobs.experience_level = $5)
          AND (
            $6 = ''
            OR companies.industry ILIKE '%' || $6 || '%'
          )
          AND (
            $7::INTEGER IS NULL
            OR jobs.salary_max >= $7::INTEGER
            OR jobs.salary_min >= $7::INTEGER
          )
          AND (
            $8::INTEGER IS NULL
            OR jobs.salary_min <= $8::INTEGER
            OR jobs.salary_max <= $8::INTEGER
          )
          AND (
            CARDINALITY($9::TEXT[]) = 0
            OR NOT EXISTS (
              SELECT 1
              FROM UNNEST($9::TEXT[]) AS required_skill
              WHERE CONCAT_WS(
                ' ',
                jobs.title,
                jobs.description,
                jobs.requirements,
                jobs.responsibilities,
                ARRAY_TO_STRING(COALESCE(job_skill_names.names, '{}'), ' ')
              ) NOT ILIKE '%' || required_skill || '%'
            )
          )
          AND (
            $10::INTEGER IS NULL
            OR jobs.published_at >= NOW() - ($10::INTEGER * INTERVAL '1 day')
          )
        ORDER BY jobs.featured DESC, jobs.published_at DESC
      `,
      [
        keyword,
        location,
        workplaceType,
        employmentType,
        experienceLevel,
        industry,
        Number.isFinite(salaryMin) ? salaryMin : null,
        Number.isFinite(salaryMax) ? salaryMax : null,
        requiredSkills,
        Number.isInteger(datePublished) && datePublished > 0
          ? datePublished
          : null,
      ],
    )

    response.json({ jobs: rows })
  } catch (error) {
    next(error)
  }
})

jobsRouter.get(
  '/recommendations',
  requireAuth,
  requireRole('candidate'),
  async (request, response, next) => {
    try {
      const { rows } = await pool.query(
        `
          WITH candidate AS (
            SELECT
              candidate_profiles.id,
              candidate_profiles.headline,
              candidate_profiles.bio,
              candidate_profiles.years_experience,
              candidate_profiles.desired_roles,
              candidate_profiles.preferred_workplace
            FROM candidate_profiles
            WHERE candidate_profiles.user_id = $1
              AND candidate_profiles.deleted_at IS NULL
          ),
          skill_matches AS (
            SELECT
              jobs.id AS job_id,
              COUNT(DISTINCT skills.id)::INTEGER AS matched_skill_count,
              ARRAY_AGG(skills.name ORDER BY skills.name) AS matched_skills
            FROM candidate
            JOIN candidate_skills
              ON candidate_skills.candidate_profile_id = candidate.id
            JOIN skills ON skills.id = candidate_skills.skill_id
            JOIN jobs
              ON CONCAT_WS(
                ' ',
                jobs.title,
                jobs.description,
                jobs.requirements,
                jobs.responsibilities
              ) ILIKE '%' || skills.name || '%'
            GROUP BY jobs.id
          )
          SELECT
            jobs.id,
            jobs.title,
            jobs.slug,
            jobs.employment_type AS "employmentType",
            jobs.workplace_type AS "workplaceType",
            jobs.experience_level AS "experienceLevel",
            jobs.city,
            jobs.country,
            jobs.salary_min AS "salaryMin",
            jobs.salary_max AS "salaryMax",
            jobs.salary_currency AS "salaryCurrency",
            jobs.description,
            jobs.requirements,
            companies.name AS company,
            COALESCE(skill_matches.matched_skills, '{}') AS "matchedSkills",
            EXISTS (
              SELECT 1
              FROM saved_jobs
              WHERE saved_jobs.user_id = $1
                AND saved_jobs.job_id = jobs.id
            ) AS "isSaved",
            LEAST(
              100,
              35
              + COALESCE(skill_matches.matched_skill_count, 0) * 15
              + CASE
                  WHEN candidate.preferred_workplace = jobs.workplace_type
                    THEN 15
                  ELSE 0
                END
              + CASE
                  WHEN candidate.years_experience <= 2
                    AND jobs.experience_level IN ('internship', 'entry_level')
                    THEN 15
                  WHEN candidate.years_experience BETWEEN 3 AND 5
                    AND jobs.experience_level = 'mid_level'
                    THEN 15
                  WHEN candidate.years_experience >= 6
                    AND jobs.experience_level = 'senior_level'
                    THEN 15
                  ELSE 0
                END
              + CASE
                  WHEN EXISTS (
                    SELECT 1
                    FROM UNNEST(candidate.desired_roles) AS desired_role
                    WHERE jobs.title ILIKE '%' || desired_role || '%'
                  )
                    THEN 20
                  WHEN jobs.title ILIKE '%' || COALESCE(candidate.headline, '') || '%'
                    THEN 10
                  ELSE 0
                END
            )::INTEGER AS "matchScore"
          FROM jobs
          JOIN companies ON companies.id = jobs.company_id
          CROSS JOIN candidate
          LEFT JOIN skill_matches ON skill_matches.job_id = jobs.id
          WHERE jobs.status = 'published'
            AND jobs.deleted_at IS NULL
            AND companies.deleted_at IS NULL
            AND companies.verification_status = 'approved'
            AND (jobs.expires_at IS NULL OR jobs.expires_at >= NOW())
            AND NOT EXISTS (
              SELECT 1
              FROM applications
              WHERE applications.job_id = jobs.id
                AND applications.candidate_user_id = $1
                AND applications.deleted_at IS NULL
            )
          ORDER BY "matchScore" DESC, jobs.published_at DESC
          LIMIT 20
        `,
        [Number(request.auth.sub)],
      )

      return response.json({ jobs: rows })
    } catch (error) {
      return next(error)
    }
  },
)

jobsRouter.get('/:slug', async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          jobs.id,
          jobs.title,
          jobs.slug,
          jobs.employment_type AS "employmentType",
          jobs.workplace_type AS "workplaceType",
          jobs.experience_level AS "experienceLevel",
          jobs.city,
          jobs.country,
          jobs.salary_min AS "salaryMin",
          jobs.salary_max AS "salaryMax",
          jobs.salary_currency AS "salaryCurrency",
          jobs.description,
          jobs.requirements,
          jobs.responsibilities,
          jobs.published_at AS "publishedAt",
          jobs.expires_at AS "expiresAt",
          companies.name AS company,
          companies.industry,
          COALESCE(job_skill_names.names, '{}') AS "requiredSkills"
        FROM jobs
        JOIN companies ON companies.id = jobs.company_id
        LEFT JOIN LATERAL (
          SELECT ARRAY_AGG(skills.name ORDER BY skills.name) AS names
          FROM job_skills
          JOIN skills ON skills.id = job_skills.skill_id
          WHERE job_skills.job_id = jobs.id
            AND job_skills.is_required = TRUE
            AND skills.deleted_at IS NULL
        ) AS job_skill_names ON TRUE
        WHERE jobs.slug = $1
          AND jobs.status = 'published'
          AND jobs.deleted_at IS NULL
          AND companies.deleted_at IS NULL
          AND companies.verification_status = 'approved'
          AND (jobs.expires_at IS NULL OR jobs.expires_at >= NOW())
        LIMIT 1
      `,
      [request.params.slug],
    )

    if (!rows[0]) {
      return response.status(404).json({ message: 'Job not found.' })
    }

    await pool.query('INSERT INTO job_views (job_id) VALUES ($1)', [
      rows[0].id,
    ]).catch(() => {})

    return response.json({ job: rows[0] })
  } catch (error) {
    return next(error)
  }
})

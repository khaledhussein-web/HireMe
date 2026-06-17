import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { pool } from '../db/pool.js'
import {
  requireAuth,
  requirePermission,
  requireRole,
} from '../middleware/auth.js'
import { writeAuditLog } from '../services/audit.js'

const EMPLOYMENT_TYPES = new Set([
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
])
const WORKPLACE_TYPES = new Set(['remote', 'hybrid', 'on_site'])
const EXPERIENCE_LEVELS = new Set([
  'internship',
  'entry_level',
  'mid_level',
  'senior_level',
])
const JOB_STATUSES = new Set([
  'draft',
  'published',
  'paused',
  'closed',
  'archived',
])
const APPLICATION_STATUSES = new Set([
  'in_review',
  'shortlisted',
  'interview',
  'offered',
  'hired',
  'rejected',
])

export const employerWorkspaceRouter = Router()
const resumeUploadDirectory = path.resolve(
  'private-uploads',
  'candidate-resumes',
)

employerWorkspaceRouter.use(
  requireAuth,
  requireRole('employer'),
  requirePermission('applications.manage_company'),
)

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function optionalText(value, maxLength = 500) {
  const text = cleanText(value, maxLength)
  return text || null
}

function optionalInteger(value, { min = 0, max = 10000000 } = {}) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) return null
  return number
}

function optionalDate(value) {
  const text = cleanText(value, 30)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function makeSlug(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 170)

  return `${base || 'job'}-${randomUUID().slice(0, 8)}`
}

function csvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

async function approvedCompany(client, userId) {
  const { rows } = await client.query(
    `
      SELECT id, name, verification_status
      FROM companies
      WHERE owner_user_id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )
  return rows[0] ?? null
}

async function requireCompany(request, response, next) {
  try {
    const company = await approvedCompany(pool, Number(request.auth.sub))
    if (!company) {
      return response.status(403).json({
        message: 'Complete your company profile first.',
      })
    }
    request.company = company
    return next()
  } catch (error) {
    return next(error)
  }
}

employerWorkspaceRouter.use(requireCompany)

function requireApprovedCompany(request, response, next) {
  if (request.company.verification_status !== 'approved') {
    return response.status(403).json({
      message: 'Company approval is required for this action.',
    })
  }
  return next()
}

function validateJobPayload(body, { partial = false } = {}) {
  const payload = {
    title: cleanText(body.title, 180),
    employmentType: cleanText(body.employmentType, 30),
    workplaceType: cleanText(body.workplaceType, 30),
    experienceLevel: cleanText(body.experienceLevel, 30),
    city: optionalText(body.city, 120),
    country: optionalText(body.country, 120),
    description: cleanText(body.description, 10000),
    requirements: optionalText(body.requirements, 10000),
    responsibilities: optionalText(body.responsibilities, 10000),
    salaryMin: optionalInteger(body.salaryMin),
    salaryMax: optionalInteger(body.salaryMax),
    expiresAt: optionalDate(body.expiresAt),
    status: cleanText(body.status || 'draft', 30),
  }

  if (
    (!partial || body.title !== undefined) &&
    payload.title.length < 3
  ) {
    return { error: 'Enter a job title.' }
  }
  if (
    (!partial || body.description !== undefined) &&
    payload.description.length < 20
  ) {
    return { error: 'Enter a role description of at least 20 characters.' }
  }
  if (
    (!partial || body.employmentType !== undefined) &&
    !EMPLOYMENT_TYPES.has(payload.employmentType)
  ) {
    return { error: 'Select a valid employment type.' }
  }
  if (
    (!partial || body.workplaceType !== undefined) &&
    !WORKPLACE_TYPES.has(payload.workplaceType)
  ) {
    return { error: 'Select a valid workplace type.' }
  }
  if (
    (!partial || body.experienceLevel !== undefined) &&
    !EXPERIENCE_LEVELS.has(payload.experienceLevel)
  ) {
    return { error: 'Select a valid experience level.' }
  }
  if (
    payload.salaryMin !== null &&
    payload.salaryMax !== null &&
    payload.salaryMax < payload.salaryMin
  ) {
    return { error: 'Enter a valid salary range.' }
  }
  if (!JOB_STATUSES.has(payload.status)) {
    return { error: 'Select a valid job status.' }
  }

  return { payload }
}

employerWorkspaceRouter.get('/jobs', async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          jobs.id,
          jobs.title,
          jobs.slug,
          jobs.status,
          jobs.employment_type AS "employmentType",
          jobs.workplace_type AS "workplaceType",
          jobs.experience_level AS "experienceLevel",
          jobs.city,
          jobs.country,
          jobs.salary_min AS "salaryMin",
          jobs.salary_max AS "salaryMax",
          jobs.description,
          jobs.requirements,
          jobs.responsibilities,
          jobs.featured,
          jobs.featured_paid_until AS "featuredPaidUntil",
          jobs.published_at AS "publishedAt",
          jobs.expires_at AS "expiresAt",
          COUNT(DISTINCT applications.id)::INTEGER AS "applicationCount",
          COUNT(DISTINCT job_views.id)::INTEGER AS "viewCount"
        FROM jobs
        LEFT JOIN applications
          ON applications.job_id = jobs.id
          AND applications.deleted_at IS NULL
        LEFT JOIN job_views ON job_views.job_id = jobs.id
        WHERE jobs.company_id = $1
          AND jobs.deleted_at IS NULL
        GROUP BY jobs.id
        ORDER BY jobs.created_at DESC
      `,
      [request.company.id],
    )
    return response.json({ jobs: rows })
  } catch (error) {
    return next(error)
  }
})

employerWorkspaceRouter.post(
  '/jobs',
  requireApprovedCompany,
  async (request, response, next) => {
    const result = validateJobPayload(request.body)
    if (result.error) {
      return response.status(400).json({ message: result.error })
    }
    const job = result.payload
    const publishedAt = job.status === 'published' ? new Date() : null

    try {
      const { rows } = await pool.query(
        `
          INSERT INTO jobs (
            company_id,
            title,
            slug,
            employment_type,
            workplace_type,
            experience_level,
            city,
            country,
            salary_min,
            salary_max,
            description,
            requirements,
            responsibilities,
            status,
            published_at,
            expires_at,
            created_by_user_id
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17
          )
          RETURNING id, title, slug, status
        `,
        [
          request.company.id,
          job.title,
          makeSlug(job.title),
          job.employmentType,
          job.workplaceType,
          job.experienceLevel,
          job.city,
          job.country,
          job.salaryMin,
          job.salaryMax,
          job.description,
          job.requirements,
          job.responsibilities,
          job.status,
          publishedAt,
          job.expiresAt,
          Number(request.auth.sub),
        ],
      )
      return response.status(201).json({
        message:
          job.status === 'published' ? 'Job published.' : 'Job draft created.',
        job: rows[0],
      })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.patch(
  '/jobs/:jobId',
  requireApprovedCompany,
  async (request, response, next) => {
    const jobId = Number(request.params.jobId)
    const result = validateJobPayload(request.body, { partial: true })
    if (!Number.isInteger(jobId) || jobId < 1) {
      return response.status(400).json({ message: 'Invalid job ID.' })
    }
    if (result.error) return response.status(400).json({ message: result.error })

    try {
      const currentResult = await pool.query(
        `
          SELECT *
          FROM jobs
          WHERE id = $1
            AND company_id = $2
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [jobId, request.company.id],
      )
      const current = currentResult.rows[0]
      if (!current) {
        return response.status(404).json({ message: 'Job not found.' })
      }
      const incoming = result.payload
      const job = {
        title: request.body.title === undefined ? current.title : incoming.title,
        employmentType:
          request.body.employmentType === undefined
            ? current.employment_type
            : incoming.employmentType,
        workplaceType:
          request.body.workplaceType === undefined
            ? current.workplace_type
            : incoming.workplaceType,
        experienceLevel:
          request.body.experienceLevel === undefined
            ? current.experience_level
            : incoming.experienceLevel,
        city: request.body.city === undefined ? current.city : incoming.city,
        country:
          request.body.country === undefined ? current.country : incoming.country,
        salaryMin:
          request.body.salaryMin === undefined
            ? current.salary_min
            : incoming.salaryMin,
        salaryMax:
          request.body.salaryMax === undefined
            ? current.salary_max
            : incoming.salaryMax,
        description:
          request.body.description === undefined
            ? current.description
            : incoming.description,
        requirements:
          request.body.requirements === undefined
            ? current.requirements
            : incoming.requirements,
        responsibilities:
          request.body.responsibilities === undefined
            ? current.responsibilities
            : incoming.responsibilities,
        expiresAt:
          request.body.expiresAt === undefined ? current.expires_at : incoming.expiresAt,
      }
      const { rows } = await pool.query(
        `
          UPDATE jobs
          SET
            title = $3,
            employment_type = $4,
            workplace_type = $5,
            experience_level = $6,
            city = $7,
            country = $8,
            salary_min = $9,
            salary_max = $10,
            description = $11,
            requirements = $12,
            responsibilities = $13,
            expires_at = $14
          WHERE id = $1
            AND company_id = $2
            AND deleted_at IS NULL
          RETURNING id, title, slug, status
        `,
        [
          jobId,
          request.company.id,
          job.title,
          job.employmentType,
          job.workplaceType,
          job.experienceLevel,
          job.city,
          job.country,
          job.salaryMin,
          job.salaryMax,
          job.description,
          job.requirements,
          job.responsibilities,
          job.expiresAt,
        ],
      )
      return response.json({ message: 'Job updated.', job: rows[0] })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.patch(
  '/jobs/:jobId/status',
  requireApprovedCompany,
  async (request, response, next) => {
    const jobId = Number(request.params.jobId)
    const status = cleanText(request.body.status, 30)
    if (!Number.isInteger(jobId) || jobId < 1 || !JOB_STATUSES.has(status)) {
      return response.status(400).json({ message: 'Select a valid job status.' })
    }

    try {
      const { rows } = await pool.query(
        `
          UPDATE jobs
          SET
            status = $3,
            published_at = CASE
              WHEN $3 = 'published' AND published_at IS NULL THEN NOW()
              ELSE published_at
            END,
            closed_at = CASE WHEN $3 = 'closed' THEN NOW() ELSE closed_at END,
            archived_at = CASE WHEN $3 = 'archived' THEN NOW() ELSE archived_at END
          WHERE id = $1
            AND company_id = $2
            AND deleted_at IS NULL
          RETURNING id, title, status
        `,
        [jobId, request.company.id, status],
      )
      if (!rows[0]) {
        return response.status(404).json({ message: 'Job not found.' })
      }
      return response.json({
        message: `Job moved to ${status.replaceAll('_', ' ')}.`,
        job: rows[0],
      })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.post(
  '/jobs/:jobId/duplicate',
  requireApprovedCompany,
  async (request, response, next) => {
    const jobId = Number(request.params.jobId)
    if (!Number.isInteger(jobId) || jobId < 1) {
      return response.status(400).json({ message: 'Invalid job ID.' })
    }
    try {
      const { rows } = await pool.query(
        `
          INSERT INTO jobs (
            company_id,
            title,
            slug,
            employment_type,
            workplace_type,
            experience_level,
            city,
            country,
            salary_min,
            salary_max,
            salary_currency,
            description,
            requirements,
            responsibilities,
            status,
            created_by_user_id
          )
          SELECT
            company_id,
            title || ' copy',
            $3,
            employment_type,
            workplace_type,
            experience_level,
            city,
            country,
            salary_min,
            salary_max,
            salary_currency,
            description,
            requirements,
            responsibilities,
            'draft',
            $4
          FROM jobs
          WHERE id = $1
            AND company_id = $2
            AND deleted_at IS NULL
          RETURNING id, title, slug, status
        `,
        [
          jobId,
          request.company.id,
          makeSlug('job-copy'),
          Number(request.auth.sub),
        ],
      )
      if (!rows[0]) {
        return response.status(404).json({ message: 'Job not found.' })
      }
      return response.status(201).json({ message: 'Job duplicated as a draft.', job: rows[0] })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.post(
  '/jobs/:jobId/feature',
  requireApprovedCompany,
  async (request, response, next) => {
    const jobId = Number(request.params.jobId)
    const days = optionalInteger(request.body.days, { min: 1, max: 90 }) ?? 30
    if (!Number.isInteger(jobId) || jobId < 1) {
      return response.status(400).json({ message: 'Invalid job ID.' })
    }
    try {
      const { rows } = await pool.query(
        `
          UPDATE jobs
          SET
            featured = TRUE,
            featured_paid_until = NOW() + ($3 * INTERVAL '1 day')
          WHERE id = $1
            AND company_id = $2
            AND deleted_at IS NULL
            AND status = 'published'
          RETURNING id, title, featured, featured_paid_until AS "featuredPaidUntil"
        `,
        [jobId, request.company.id, days],
      )
      if (!rows[0]) {
        return response.status(404).json({
          message: 'Only published jobs can be featured.',
        })
      }
      return response.json({ message: 'Job featured as a paid listing.', job: rows[0] })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.delete(
  '/jobs/:jobId',
  requireApprovedCompany,
  async (request, response, next) => {
    const jobId = Number(request.params.jobId)
    if (!Number.isInteger(jobId) || jobId < 1) {
      return response.status(400).json({ message: 'Invalid job ID.' })
    }
    try {
      const { rowCount } = await pool.query(
        `
          UPDATE jobs
          SET deleted_at = NOW(), status = 'archived', archived_at = NOW()
          WHERE id = $1
            AND company_id = $2
            AND deleted_at IS NULL
        `,
        [jobId, request.company.id],
      )
      if (rowCount === 0) {
        return response.status(404).json({ message: 'Job not found.' })
      }
      return response.status(204).end()
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.get('/dashboard', async (request, response, next) => {
  try {
    const statsResult = await pool.query(
      `
        WITH company_jobs AS (
          SELECT *
          FROM jobs
          WHERE company_id = $1 AND deleted_at IS NULL
        ),
        app_stats AS (
          SELECT
            COUNT(applications.id)::INTEGER AS total_applications,
            COUNT(applications.id)
              FILTER (WHERE applications.status = 'submitted')::INTEGER
              AS new_applicants,
            COUNT(applications.id)
              FILTER (WHERE applications.status = 'shortlisted')::INTEGER
              AS shortlisted_candidates,
            COUNT(applications.id)
              FILTER (WHERE applications.status = 'hired')::INTEGER
              AS hired_candidates
          FROM company_jobs
          LEFT JOIN applications
            ON applications.job_id = company_jobs.id
            AND applications.deleted_at IS NULL
        ),
        view_stats AS (
          SELECT COUNT(job_views.id)::INTEGER AS job_views
          FROM company_jobs
          LEFT JOIN job_views ON job_views.job_id = company_jobs.id
        ),
        interview_stats AS (
          SELECT COUNT(interviews.id)::INTEGER AS upcoming_interviews
          FROM company_jobs
          JOIN applications
            ON applications.job_id = company_jobs.id
            AND applications.deleted_at IS NULL
          JOIN interviews
            ON interviews.application_id = applications.id
            AND interviews.deleted_at IS NULL
            AND interviews.status IN ('scheduled', 'confirmed')
            AND interviews.starts_at >= NOW()
        )
        SELECT
          COUNT(company_jobs.id)
            FILTER (WHERE company_jobs.status = 'published')::INTEGER
            AS "activeJobs",
          app_stats.total_applications AS "totalApplications",
          app_stats.new_applicants AS "newApplicants",
          app_stats.shortlisted_candidates AS "shortlistedCandidates",
          interview_stats.upcoming_interviews AS "upcomingInterviews",
          view_stats.job_views AS "jobViews",
          CASE
            WHEN view_stats.job_views = 0 THEN 0
            ELSE ROUND(
              (app_stats.total_applications::NUMERIC / view_stats.job_views) * 100,
              1
            )
          END AS "conversionRate"
        FROM company_jobs
        CROSS JOIN app_stats
        CROSS JOIN view_stats
        CROSS JOIN interview_stats
        GROUP BY
          app_stats.total_applications,
          app_stats.new_applicants,
          app_stats.shortlisted_candidates,
          interview_stats.upcoming_interviews,
          view_stats.job_views
      `,
      [request.company.id],
    )
    const applicationsResult = await pool.query(
      `
        SELECT
          applications.id,
          applications.status,
          applications.submitted_at AS "submittedAt",
          applications.cover_letter AS "coverLetter",
          applications.full_name AS "fullName",
          applications.email,
          applications.candidate_user_id AS "candidateUserId",
          applications.phone,
          applications.location,
          applications.years_experience AS "yearsExperience",
          applications.linkedin_url AS "linkedinUrl",
          applications.portfolio_url AS "portfolioUrl",
          jobs.title AS "jobTitle",
          jobs.slug AS "jobSlug",
          candidate_resumes.id AS "resumeId",
          employer_candidate_evaluations.score,
          employer_candidate_evaluations.private_notes AS "privateNotes",
          employer_candidate_evaluations.skills_score AS "skillsScore",
          employer_candidate_evaluations.experience_score AS "experienceScore",
          employer_candidate_evaluations.culture_score AS "cultureScore",
          interviews.id AS "interviewId",
          interviews.starts_at AS "interviewStartsAt",
          interviews.location_or_url AS "interviewLocationOrUrl",
          COALESCE(
            ARRAY_AGG(skills.name ORDER BY skills.name)
              FILTER (WHERE skills.id IS NOT NULL),
            '{}'
          ) AS skills
        FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        LEFT JOIN candidate_profiles
          ON candidate_profiles.user_id = applications.candidate_user_id
          AND candidate_profiles.deleted_at IS NULL
        LEFT JOIN candidate_resumes
          ON candidate_resumes.candidate_profile_id = candidate_profiles.id
        LEFT JOIN candidate_skills
          ON candidate_skills.candidate_profile_id = candidate_profiles.id
        LEFT JOIN skills ON skills.id = candidate_skills.skill_id
        LEFT JOIN employer_candidate_evaluations
          ON employer_candidate_evaluations.application_id = applications.id
          AND employer_candidate_evaluations.employer_user_id = $2
        LEFT JOIN LATERAL (
          SELECT id, starts_at, location_or_url
          FROM interviews
          WHERE interviews.application_id = applications.id
            AND interviews.deleted_at IS NULL
            AND interviews.status IN ('scheduled', 'confirmed')
          ORDER BY starts_at ASC
          LIMIT 1
        ) AS interviews ON TRUE
        WHERE jobs.company_id = $1
          AND jobs.deleted_at IS NULL
          AND applications.deleted_at IS NULL
        GROUP BY
          applications.id,
          jobs.id,
          candidate_resumes.id,
          employer_candidate_evaluations.id,
          interviews.id,
          interviews.starts_at,
          interviews.location_or_url
        ORDER BY applications.submitted_at DESC
      `,
      [request.company.id, Number(request.auth.sub)],
    )

    return response.json({
      company: request.company,
      stats: statsResult.rows[0] ?? {
        activeJobs: 0,
        totalApplications: 0,
        newApplicants: 0,
        shortlistedCandidates: 0,
        upcomingInterviews: 0,
        jobViews: 0,
        conversionRate: 0,
      },
      applications: applicationsResult.rows,
    })
  } catch (error) {
    return next(error)
  }
})

employerWorkspaceRouter.patch(
  '/applications/:applicationId/status',
  async (request, response, next) => {
    const applicationId = Number(request.params.applicationId)
    const status = cleanText(request.body.status, 30)

    if (
      !Number.isInteger(applicationId) ||
      applicationId < 1 ||
      !APPLICATION_STATUSES.has(status)
    ) {
      return response.status(400).json({
        message: 'Select a valid application status.',
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `
          SELECT
            applications.id,
            applications.status,
            applications.candidate_user_id,
            jobs.title
          FROM applications
          JOIN jobs ON jobs.id = applications.job_id
          WHERE applications.id = $1
            AND jobs.company_id = $2
            AND applications.deleted_at IS NULL
          FOR UPDATE OF applications
        `,
        [applicationId, request.company.id],
      )
      const application = rows[0]
      if (!application) {
        await client.query('ROLLBACK')
        return response.status(404).json({ message: 'Application not found.' })
      }

      await client.query('UPDATE applications SET status = $1 WHERE id = $2', [
        status,
        applicationId,
      ])
      if (application.candidate_user_id) {
        await client.query(
          `
            INSERT INTO notifications (
              user_id,
              notification_type,
              title,
              body,
              related_entity_type,
              related_entity_id
            )
            VALUES ($1, 'application_status_changed', $2, $3, 'application', $4)
          `,
          [
            application.candidate_user_id,
            'Application status updated',
            `${application.title}: ${status.replaceAll('_', ' ')}`,
            applicationId,
          ],
        )
      }
      await writeAuditLog(client, request, {
        action: 'employer.application_status_changed',
        entityType: 'application',
        entityId: applicationId,
        oldValues: { status: application.status },
        newValues: { status },
      })
      await client.query('COMMIT')
      return response.json({
        message: 'Application stage updated.',
        status,
      })
    } catch (error) {
      await client.query('ROLLBACK')
      if (error.code === 'P0001') {
        return response.status(409).json({ message: error.message })
      }
      return next(error)
    } finally {
      client.release()
    }
  },
)

employerWorkspaceRouter.patch(
  '/applications/:applicationId/evaluation',
  async (request, response, next) => {
    const applicationId = Number(request.params.applicationId)
    if (!Number.isInteger(applicationId) || applicationId < 1) {
      return response.status(400).json({ message: 'Invalid application ID.' })
    }
    const scores = {
      score: optionalInteger(request.body.score, { min: 1, max: 5 }),
      skillsScore: optionalInteger(request.body.skillsScore, { min: 1, max: 5 }),
      experienceScore: optionalInteger(request.body.experienceScore, {
        min: 1,
        max: 5,
      }),
      cultureScore: optionalInteger(request.body.cultureScore, {
        min: 1,
        max: 5,
      }),
    }
    const privateNotes = optionalText(request.body.privateNotes, 5000)

    try {
      const ownerResult = await pool.query(
        `
          SELECT applications.id
          FROM applications
          JOIN jobs ON jobs.id = applications.job_id
          WHERE applications.id = $1
            AND jobs.company_id = $2
            AND applications.deleted_at IS NULL
          LIMIT 1
        `,
        [applicationId, request.company.id],
      )
      if (!ownerResult.rows[0]) {
        return response.status(404).json({ message: 'Application not found.' })
      }

      const { rows } = await pool.query(
        `
          INSERT INTO employer_candidate_evaluations (
            application_id,
            employer_user_id,
            score,
            private_notes,
            skills_score,
            experience_score,
            culture_score
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (application_id, employer_user_id) DO UPDATE SET
            score = EXCLUDED.score,
            private_notes = EXCLUDED.private_notes,
            skills_score = EXCLUDED.skills_score,
            experience_score = EXCLUDED.experience_score,
            culture_score = EXCLUDED.culture_score
          RETURNING
            score,
            private_notes AS "privateNotes",
            skills_score AS "skillsScore",
            experience_score AS "experienceScore",
            culture_score AS "cultureScore"
        `,
        [
          applicationId,
          Number(request.auth.sub),
          scores.score,
          privateNotes,
          scores.skillsScore,
          scores.experienceScore,
          scores.cultureScore,
        ],
      )
      return response.json({
        message: 'Candidate evaluation saved.',
        evaluation: rows[0],
      })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.post(
  '/applications/:applicationId/interviews',
  async (request, response, next) => {
    const applicationId = Number(request.params.applicationId)
    const interviewType = cleanText(request.body.interviewType, 30)
    const startsAt = optionalDate(request.body.startsAt)
    const endsAt = optionalDate(request.body.endsAt)
    const locationOrUrl = optionalText(request.body.locationOrUrl, 500)
    const notes = optionalText(request.body.notes, 2000)

    if (
      !Number.isInteger(applicationId) ||
      applicationId < 1 ||
      !['phone', 'video', 'on_site', 'technical', 'panel'].includes(
        interviewType,
      ) ||
      !startsAt ||
      !endsAt ||
      endsAt <= startsAt
    ) {
      return response.status(400).json({
        message: 'Enter a valid interview type, start time, and end time.',
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const ownerResult = await client.query(
        `
          SELECT applications.id, applications.candidate_user_id, jobs.title
          FROM applications
          JOIN jobs ON jobs.id = applications.job_id
          WHERE applications.id = $1
            AND jobs.company_id = $2
            AND applications.deleted_at IS NULL
          LIMIT 1
        `,
        [applicationId, request.company.id],
      )
      const application = ownerResult.rows[0]
      if (!application) {
        await client.query('ROLLBACK')
        return response.status(404).json({ message: 'Application not found.' })
      }
      const { rows } = await client.query(
        `
          INSERT INTO interviews (
            application_id,
            scheduled_by_user_id,
            interview_type,
            starts_at,
            ends_at,
            location_or_url,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, starts_at AS "startsAt", location_or_url AS "locationOrUrl"
        `,
        [
          applicationId,
          Number(request.auth.sub),
          interviewType,
          startsAt,
          endsAt,
          locationOrUrl,
          notes,
        ],
      )
      await client.query(
        `
          UPDATE applications
          SET status = CASE
            WHEN status = 'shortlisted' THEN 'interview'
            ELSE status
          END
          WHERE id = $1
        `,
        [applicationId],
      )
      if (application.candidate_user_id) {
        await client.query(
          `
            INSERT INTO notifications (
              user_id,
              notification_type,
              title,
              body,
              related_entity_type,
              related_entity_id
            )
            VALUES ($1, 'interview_scheduled', $2, $3, 'application', $4)
          `,
          [
            application.candidate_user_id,
            'Interview scheduled',
            `${application.title}: ${startsAt.toLocaleString()}`,
            applicationId,
          ],
        )
      }
      await client.query('COMMIT')
      return response.status(201).json({
        message: 'Interview scheduled.',
        interview: rows[0],
      })
    } catch (error) {
      await client.query('ROLLBACK')
      return next(error)
    } finally {
      client.release()
    }
  },
)

employerWorkspaceRouter.get(
  '/applications/:applicationId/export',
  requireApprovedCompany,
  async (request, response, next) => {
    const applicationId = Number(request.params.applicationId)
    if (!Number.isInteger(applicationId) || applicationId < 1) {
      return response.status(400).json({ message: 'Invalid application ID.' })
    }
    try {
      const { rows } = await pool.query(
        `
          SELECT
            applications.id,
            applications.full_name AS "fullName",
            applications.email,
            applications.phone,
            applications.location,
            applications.years_experience AS "yearsExperience",
            applications.linkedin_url AS "linkedinUrl",
            applications.portfolio_url AS "portfolioUrl",
            applications.cover_letter AS "coverLetter",
            applications.status,
            applications.submitted_at AS "submittedAt",
            jobs.title AS "jobTitle",
            companies.name AS company,
            employer_candidate_evaluations.score,
            employer_candidate_evaluations.private_notes AS "privateNotes"
          FROM applications
          JOIN jobs ON jobs.id = applications.job_id
          JOIN companies ON companies.id = jobs.company_id
          LEFT JOIN employer_candidate_evaluations
            ON employer_candidate_evaluations.application_id = applications.id
            AND employer_candidate_evaluations.employer_user_id = $3
          WHERE applications.id = $1
            AND jobs.company_id = $2
            AND applications.deleted_at IS NULL
          LIMIT 1
        `,
        [applicationId, request.company.id, Number(request.auth.sub)],
      )
      const application = rows[0]
      if (!application) {
        return response.status(404).json({ message: 'Application not found.' })
      }
      const headers = Object.keys(application)
      const csv = [
        headers.map(csvValue).join(','),
        headers.map((header) => csvValue(application[header])).join(','),
      ].join('\n')
      response.type('text/csv')
      response.set(
        'Content-Disposition',
        `attachment; filename="application-${application.id}.csv"`,
      )
      return response.send(csv)
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.get(
  '/candidate-pool',
  requireApprovedCompany,
  async (request, response, next) => {
    const query = cleanText(request.query.query, 100)
    try {
      const { rows } = await pool.query(
        `
          SELECT
            users.id,
            users.full_name AS "fullName",
            candidate_profiles.headline,
            candidate_profiles.bio,
            candidate_profiles.location,
            candidate_profiles.years_experience AS "yearsExperience",
            candidate_profiles.linkedin_url AS "linkedinUrl",
            candidate_profiles.portfolio_url AS "portfolioUrl",
            (candidate_resumes.id IS NOT NULL) AS "hasResume",
            candidate_profiles.availability_status AS "availabilityStatus",
            candidate_profiles.desired_roles AS "desiredRoles",
            COALESCE(
              ARRAY_AGG(skills.name ORDER BY skills.name)
                FILTER (WHERE skills.id IS NOT NULL),
              '{}'
            ) AS skills
          FROM users
          JOIN roles ON roles.id = users.role_id
          JOIN candidate_profiles
            ON candidate_profiles.user_id = users.id
            AND candidate_profiles.deleted_at IS NULL
          LEFT JOIN candidate_skills
            ON candidate_skills.candidate_profile_id = candidate_profiles.id
          LEFT JOIN skills ON skills.id = candidate_skills.skill_id
          LEFT JOIN candidate_resumes
            ON candidate_resumes.candidate_profile_id = candidate_profiles.id
          WHERE roles.name = 'candidate'
            AND users.is_active = TRUE
            AND users.deleted_at IS NULL
            AND candidate_profiles.phone IS NOT NULL
            AND candidate_profiles.headline IS NOT NULL
            AND candidate_profiles.availability_status <> 'unavailable'
            AND candidate_profiles.profile_visibility <> 'private'
            AND (
              $1 = ''
              OR users.full_name ILIKE '%' || $1 || '%'
              OR candidate_profiles.headline ILIKE '%' || $1 || '%'
              OR candidate_profiles.location ILIKE '%' || $1 || '%'
              OR skills.name ILIKE '%' || $1 || '%'
            )
          GROUP BY users.id, candidate_profiles.id, candidate_resumes.id
          ORDER BY candidate_profiles.years_experience ASC, users.full_name ASC
          LIMIT 100
        `,
        [query],
      )
      return response.json({ candidates: rows })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.post(
  '/candidate-comparison',
  requireApprovedCompany,
  async (request, response, next) => {
    const candidateIds = Array.isArray(request.body.candidateIds)
      ? [...new Set(request.body.candidateIds.map(Number))].filter(
          (id) => Number.isInteger(id) && id > 0,
        )
      : []

    if (candidateIds.length < 2 || candidateIds.length > 4) {
      return response.status(400).json({
        message: 'Select between two and four candidates.',
      })
    }

    try {
      const { rows } = await pool.query(
        `
          SELECT
            users.id,
            users.full_name AS "fullName",
            candidate_profiles.headline,
            candidate_profiles.location,
            candidate_profiles.years_experience AS "yearsExperience",
            candidate_profiles.desired_roles AS "desiredRoles",
            candidate_profiles.linkedin_url AS "linkedinUrl",
            candidate_profiles.portfolio_url AS "portfolioUrl",
            (candidate_resumes.id IS NOT NULL) AS "hasResume",
            COALESCE(
              ARRAY_AGG(DISTINCT skills.name ORDER BY skills.name)
                FILTER (WHERE skills.id IS NOT NULL),
              '{}'
            ) AS skills,
            COUNT(DISTINCT applications.id)::INTEGER AS "applicationCount",
            COUNT(DISTINCT applications.id)
              FILTER (
                WHERE applications.status IN (
                  'shortlisted',
                  'interview',
                  'offered',
                  'hired'
                )
              )::INTEGER AS "advancedApplicationCount"
          FROM users
          JOIN candidate_profiles
            ON candidate_profiles.user_id = users.id
            AND candidate_profiles.deleted_at IS NULL
          LEFT JOIN candidate_skills
            ON candidate_skills.candidate_profile_id = candidate_profiles.id
          LEFT JOIN skills ON skills.id = candidate_skills.skill_id
          LEFT JOIN candidate_resumes
            ON candidate_resumes.candidate_profile_id = candidate_profiles.id
          LEFT JOIN applications
            ON applications.candidate_user_id = users.id
            AND applications.deleted_at IS NULL
          WHERE users.id = ANY($1::INTEGER[])
            AND users.deleted_at IS NULL
            AND candidate_profiles.profile_visibility <> 'private'
          GROUP BY users.id, candidate_profiles.id, candidate_resumes.id
          ORDER BY users.full_name
        `,
        [candidateIds],
      )
      return response.json({ candidates: rows })
    } catch (error) {
      return next(error)
    }
  },
)

employerWorkspaceRouter.get(
  '/candidates/:candidateUserId/resume',
  requireApprovedCompany,
  async (request, response, next) => {
    const candidateUserId = Number(request.params.candidateUserId)
    if (!Number.isInteger(candidateUserId) || candidateUserId < 1) {
      return response.status(400).json({ message: 'Invalid candidate ID.' })
    }

    try {
      const { rows } = await pool.query(
        `
          SELECT
            candidate_resumes.original_filename,
            candidate_resumes.stored_filename,
            candidate_resumes.mime_type
          FROM candidate_resumes
          JOIN candidate_profiles
            ON candidate_profiles.id = candidate_resumes.candidate_profile_id
          JOIN users ON users.id = candidate_profiles.user_id
          WHERE users.id = $1
            AND users.is_active = TRUE
            AND users.deleted_at IS NULL
            AND candidate_profiles.deleted_at IS NULL
            AND candidate_profiles.phone IS NOT NULL
            AND candidate_profiles.headline IS NOT NULL
            AND candidate_profiles.availability_status <> 'unavailable'
            AND candidate_profiles.profile_visibility <> 'private'
          LIMIT 1
        `,
        [candidateUserId],
      )
      const resume = rows[0]
      if (!resume) {
        return response.status(404).json({ message: 'Resume not found.' })
      }

      const filePath = path.join(
        resumeUploadDirectory,
        path.basename(resume.stored_filename),
      )
      response.type(resume.mime_type)
      response.set(
        'Content-Disposition',
        `attachment; filename="${resume.original_filename.replace(/["\r\n]/g, '_')}"`,
      )
      const stream = createReadStream(filePath)
      stream.on('error', next)
      return stream.pipe(response)
    } catch (error) {
      return next(error)
    }
  },
)

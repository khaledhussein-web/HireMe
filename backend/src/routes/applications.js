import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { notifyUser } from '../services/notifications.js'

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
          applications.withdrawn_at AS "withdrawnAt",
          applications.withdrawal_reason AS "withdrawalReason",
          applications.resume_id AS "resumeId",
          jobs.title AS "jobTitle",
          jobs.slug AS "jobSlug",
          jobs.description AS "jobDescription",
          jobs.requirements,
          companies.name AS company,
          interviews.id AS "interviewId",
          interviews.starts_at AS "interviewStartsAt",
          interviews.location_or_url AS "interviewLocationOrUrl",
          applications.status IN (
            'submitted',
            'in_review',
            'shortlisted',
            'interview',
            'offered'
          ) AS "canWithdraw"
        FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        JOIN companies ON companies.id = jobs.company_id
        LEFT JOIN LATERAL (
          SELECT id, starts_at, location_or_url
          FROM interviews
          WHERE interviews.application_id = applications.id
            AND interviews.deleted_at IS NULL
            AND interviews.status IN ('scheduled', 'confirmed')
          ORDER BY interviews.starts_at ASC
          LIMIT 1
        ) AS interviews ON TRUE
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

applicationsRouter.post('/', async (request, response, next) => {
  const jobSlug = String(request.body.jobSlug ?? '').trim()
  const coverLetter = String(request.body.coverLetter ?? '').trim()
  const resumeId = Number(request.body.resumeId)
  const roleAnswers =
    request.body.roleAnswers && typeof request.body.roleAnswers === 'object'
      ? request.body.roleAnswers
      : {}

  if (!jobSlug || coverLetter.length < 40 || coverLetter.length > 5000) {
    return response.status(400).json({
      message: 'Select a job and provide a cover letter of at least 40 characters.',
    })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        SELECT
          jobs.id AS job_id,
          jobs.title,
          jobs.slug,
          companies.owner_user_id,
          users.full_name,
          users.email,
          candidate_profiles.phone,
          candidate_profiles.location,
          candidate_profiles.years_experience,
          candidate_profiles.linkedin_url,
          candidate_profiles.portfolio_url,
          candidate_resumes.id AS resume_id
        FROM jobs
        JOIN companies ON companies.id = jobs.company_id
        JOIN users ON users.id = $1
        JOIN candidate_profiles
          ON candidate_profiles.user_id = users.id
          AND candidate_profiles.deleted_at IS NULL
        LEFT JOIN candidate_resumes
          ON candidate_resumes.candidate_profile_id = candidate_profiles.id
        WHERE jobs.slug = $2
          AND jobs.status = 'published'
          AND jobs.deleted_at IS NULL
          AND companies.deleted_at IS NULL
          AND companies.verification_status = 'approved'
          AND (jobs.expires_at IS NULL OR jobs.expires_at >= NOW())
        LIMIT 1
      `,
      [Number(request.auth.sub), jobSlug],
    )
    const applicationData = rows[0]

    if (!applicationData) {
      await client.query('ROLLBACK')
      return response.status(404).json({
        message: 'This job is not available for applications.',
      })
    }

    if (
      !applicationData.full_name ||
      !applicationData.phone ||
      !applicationData.location ||
      !applicationData.resume_id
    ) {
      await client.query('ROLLBACK')
      return response.status(400).json({
        message:
          'Complete the required profile information and upload your CV before applying.',
      })
    }
    if (
      Number.isInteger(resumeId) &&
      resumeId > 0 &&
      Number(applicationData.resume_id) !== resumeId
    ) {
      await client.query('ROLLBACK')
      return response.status(400).json({
        message: 'Select a CV that belongs to your candidate profile.',
      })
    }

    const result = await client.query(
      `
        INSERT INTO applications (
          job_id,
          candidate_user_id,
          full_name,
          email,
          phone,
          location,
          years_experience,
          linkedin_url,
          portfolio_url,
          resume_id,
          cover_letter,
          role_answers
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, status, submitted_at AS "submittedAt"
      `,
      [
        applicationData.job_id,
        Number(request.auth.sub),
        applicationData.full_name,
        applicationData.email,
        applicationData.phone,
        applicationData.location,
        applicationData.years_experience ?? 0,
        applicationData.linkedin_url,
        applicationData.portfolio_url,
        applicationData.resume_id,
        coverLetter,
        roleAnswers,
      ],
    )
    await notifyUser(client, {
      userId: Number(request.auth.sub),
      type: 'application_submitted',
      title: 'Application submitted',
      body: `Your application for ${applicationData.title} was submitted successfully.`,
      entityType: 'application',
      entityId: result.rows[0].id,
      actionUrl: '/applications',
      deduplicationKey: `application-submitted:${result.rows[0].id}:candidate`,
    })
    if (applicationData.owner_user_id) {
      await notifyUser(client, {
        userId: applicationData.owner_user_id,
        type: 'application_submitted',
        title: 'New application received',
        body: `${applicationData.full_name} applied for ${applicationData.title}.`,
        entityType: 'application',
        entityId: result.rows[0].id,
        actionUrl: '/employer/dashboard',
        deduplicationKey: `application-submitted:${result.rows[0].id}:employer`,
      })
    }
    await client.query('COMMIT')

    return response.status(201).json({
      message: `Application submitted for ${applicationData.title}.`,
      application: result.rows[0],
    })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') {
      return response.status(409).json({
        message: 'You already applied for this job.',
      })
    }
    return next(error)
  } finally {
    client.release()
  }
})

applicationsRouter.get(
  '/:applicationId/interview-prep',
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
            applications.status,
            jobs.title AS "jobTitle",
            jobs.description,
            jobs.requirements,
            jobs.responsibilities,
            companies.name AS company,
            candidate_profiles.headline,
            candidate_profiles.bio,
            interviews.starts_at AS "interviewStartsAt",
            interviews.ends_at AS "interviewEndsAt",
            interviews.interview_type AS "interviewType",
            interviews.location_or_url AS "interviewLocationOrUrl"
          FROM applications
          JOIN jobs ON jobs.id = applications.job_id
          JOIN companies ON companies.id = jobs.company_id
          LEFT JOIN candidate_profiles
            ON candidate_profiles.user_id = applications.candidate_user_id
            AND candidate_profiles.deleted_at IS NULL
          LEFT JOIN LATERAL (
            SELECT *
            FROM interviews
            WHERE interviews.application_id = applications.id
              AND interviews.deleted_at IS NULL
              AND interviews.status IN ('scheduled', 'confirmed')
            ORDER BY interviews.starts_at ASC
            LIMIT 1
          ) AS interviews ON TRUE
          WHERE applications.id = $1
            AND applications.candidate_user_id = $2
            AND applications.deleted_at IS NULL
          LIMIT 1
        `,
        [applicationId, Number(request.auth.sub)],
      )
      const application = rows[0]

      if (!application) {
        return response.status(404).json({ message: 'Application not found.' })
      }

      const requirementTopics = String(application.requirements ?? '')
        .split(/[\n,.;]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 3)
        .slice(0, 3)
      const questions = [
        `Why do you want to join ${application.company} as a ${application.jobTitle}?`,
        `Which part of your experience best demonstrates that you can succeed in this role?`,
        `Tell us about a difficult problem you solved and how you measured the result.`,
        ...requirementTopics.map(
          (topic) => `Describe a practical example of your experience with ${topic}.`,
        ),
      ]

      return response.json({
        application,
        preparation: {
          questions,
          checklist: [
            `Review ${application.company}'s product, customers, and recent work.`,
            `Prepare two examples that connect your background to the job requirements.`,
            'Practice a concise introduction and prepare questions for the interviewer.',
            'Confirm the interview time, location or meeting link, and required equipment.',
          ],
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

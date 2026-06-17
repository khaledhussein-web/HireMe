import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { pool } from '../db/pool.js'
import {
  requireAuth,
  requirePermission,
  requireRole,
} from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { writeAuditLog } from '../services/audit.js'

const uploadDirectory = path.resolve('private-uploads', 'company-documents')
const resumeUploadDirectory = path.resolve(
  'private-uploads',
  'candidate-resumes',
)
const CATEGORY_TYPES = new Set([
  'industry',
  'location',
  'skill',
  'job_category',
])

export const adminRouter = Router()

adminRouter.use(
  requireAuth,
  requireRole('admin'),
  requirePermission('platform.manage'),
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
)

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function slugFor(value) {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180)
}

adminRouter.get('/dashboard', async (_request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          COUNT(*)::INTEGER AS "userCount",
          COUNT(*) FILTER (WHERE roles.name = 'candidate')::INTEGER
            AS "candidateCount",
          COUNT(*) FILTER (WHERE roles.name = 'employer')::INTEGER
            AS "employerCount",
          COUNT(*) FILTER (WHERE roles.name = 'tech_community')::INTEGER
            AS "communityCount",
          COUNT(*) FILTER (WHERE users.account_status = 'suspended')::INTEGER
            AS "suspendedCount",
          COUNT(*) FILTER (WHERE users.email_verified_at IS NULL)::INTEGER
            AS "unverifiedCount"
        FROM users
        JOIN roles ON roles.id = users.role_id
        WHERE users.deleted_at IS NULL
      `,
    )
    const companyResult = await pool.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM companies
        WHERE verification_status = 'pending' AND deleted_at IS NULL
      `,
    )
    const communityResult = await pool.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM community_profiles
        WHERE verification_status = 'pending' AND deleted_at IS NULL
      `,
    )
    const jobResult = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'published')::INTEGER AS "publishedJobs",
          COUNT(*) FILTER (WHERE status = 'draft')::INTEGER AS "draftJobs",
          COUNT(*) FILTER (WHERE status IN ('closed', 'archived'))::INTEGER
            AS "closedJobs"
        FROM jobs
        WHERE deleted_at IS NULL
      `,
    )
    const reportResult = await pool.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM content_reports
        WHERE status IN ('open', 'reviewing') AND deleted_at IS NULL
      `,
    )
    const billingResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::INTEGER
            AS "paidAmountCents",
          COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::INTEGER
            AS "pendingPayments"
        FROM payments
      `,
    )
    return response.json({
      stats: {
        ...rows[0],
        pendingCompanies: companyResult.rows[0].count,
        pendingCommunities: communityResult.rows[0].count,
        ...jobResult.rows[0],
        openReports: reportResult.rows[0].count,
        ...billingResult.rows[0],
      },
    })
  } catch (error) {
    return next(error)
  }
})

adminRouter.get('/community-verifications', async (request, response, next) => {
  const status = String(request.query.status ?? 'pending')
  if (!['draft', 'pending', 'approved', 'rejected'].includes(status)) {
    return response.status(400).json({ message: 'Invalid verification status.' })
  }
  try {
    const { rows } = await pool.query(
      `
        SELECT
          community_profiles.id,
          community_profiles.community_name AS "communityName",
          community_profiles.description,
          community_profiles.category,
          community_profiles.university_name AS "universityName",
          community_profiles.website_url AS "websiteUrl",
          community_profiles.country,
          community_profiles.city,
          community_profiles.technical_tracks AS "technicalTracks",
          community_profiles.contact_email AS "contactEmail",
          community_profiles.verification_status AS "verificationStatus",
          community_profiles.submitted_at AS "submittedAt",
          users.full_name AS "ownerName",
          users.email AS "ownerEmail",
          profile_assets.id AS "logoAssetId"
        FROM community_profiles
        JOIN users ON users.id = community_profiles.owner_user_id
        LEFT JOIN profile_assets
          ON profile_assets.user_id = community_profiles.owner_user_id
          AND profile_assets.asset_type = 'community_logo'
        WHERE community_profiles.verification_status = $1
          AND community_profiles.deleted_at IS NULL
        ORDER BY community_profiles.submitted_at ASC NULLS LAST
      `,
      [status],
    )
    return response.json({ communities: rows })
  } catch (error) {
    return next(error)
  }
})

adminRouter.post(
  '/community-verifications/:communityId/decision',
  async (request, response, next) => {
    const communityId = Number(request.params.communityId)
    const decision = String(request.body.decision ?? '')
    const reason = String(request.body.reason ?? '').trim().slice(0, 2000)
    if (!Number.isInteger(communityId) || communityId < 1) {
      return response.status(400).json({ message: 'Invalid community ID.' })
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return response.status(400).json({
        message: 'Decision must be approved or rejected.',
      })
    }
    if (decision === 'rejected' && reason.length < 5) {
      return response.status(400).json({
        message: 'Provide a clear rejection reason.',
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `
          SELECT id, owner_user_id, community_name, verification_status
          FROM community_profiles
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE
        `,
        [communityId],
      )
      const community = rows[0]
      if (!community) {
        await client.query('ROLLBACK')
        return response.status(404).json({ message: 'Community not found.' })
      }
      if (community.verification_status !== 'pending') {
        await client.query('ROLLBACK')
        return response.status(409).json({
          message: 'Only pending community profiles can be reviewed.',
        })
      }

      await client.query(
        `
          UPDATE community_profiles
          SET
            verification_status = $1,
            reviewed_at = NOW(),
            reviewed_by_user_id = $2,
            rejection_reason = $3
          WHERE id = $4
        `,
        [
          decision,
          Number(request.auth.sub),
          decision === 'rejected' ? reason : null,
          communityId,
        ],
      )
      await client.query(
        `
          INSERT INTO community_verification_reviews (
            community_profile_id,
            reviewer_user_id,
            decision,
            reason
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          communityId,
          Number(request.auth.sub),
          decision,
          decision === 'rejected' ? reason : null,
        ],
      )
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
          VALUES ($1, $2, $3, $4, 'community_profile', $5)
        `,
        [
          community.owner_user_id,
          `community_verification_${decision}`,
          decision === 'approved'
            ? 'Community verification approved'
            : 'Community verification rejected',
          decision === 'approved'
            ? `${community.community_name} is now verified.`
            : reason,
          communityId,
        ],
      )
      await client.query('COMMIT')
      return response.json({
        message:
          decision === 'approved'
            ? 'Community verification approved.'
            : 'Community verification rejected.',
      })
    } catch (error) {
      await client.query('ROLLBACK')
      return next(error)
    } finally {
      client.release()
    }
  },
)

adminRouter.get('/employer-verifications', async (request, response, next) => {
  const status = String(request.query.status ?? 'pending')
  const allowedStatuses = new Set(['draft', 'pending', 'approved', 'rejected'])

  if (!allowedStatuses.has(status)) {
    return response.status(400).json({ message: 'Invalid verification status.' })
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          companies.id,
          companies.name,
          companies.industry,
          companies.headquarters_location AS "headquartersLocation",
          companies.verification_status AS "verificationStatus",
          companies.submitted_at AS "submittedAt",
          companies.reviewed_at AS "reviewedAt",
          users.id AS "ownerUserId",
          users.full_name AS "ownerName",
          users.email AS "ownerEmail",
          COUNT(company_documents.id)::INTEGER AS "documentCount"
        FROM companies
        JOIN users ON users.id = companies.owner_user_id
        LEFT JOIN company_documents
          ON company_documents.company_id = companies.id
          AND company_documents.deleted_at IS NULL
        WHERE companies.verification_status = $1
          AND companies.deleted_at IS NULL
        GROUP BY companies.id, users.id
        ORDER BY companies.submitted_at ASC NULLS LAST, companies.created_at ASC
      `,
      [status],
    )

    return response.json({ companies: rows })
  } catch (error) {
    return next(error)
  }
})

adminRouter.get(
  '/employer-verifications/:companyId',
  async (request, response, next) => {
    const companyId = Number(request.params.companyId)
    if (!Number.isInteger(companyId) || companyId < 1) {
      return response.status(400).json({ message: 'Invalid company ID.' })
    }

    try {
      const { rows } = await pool.query(
        `
          SELECT
            companies.*,
            users.full_name AS "ownerName",
            users.email AS "ownerEmail"
          FROM companies
          JOIN users ON users.id = companies.owner_user_id
          WHERE companies.id = $1
            AND companies.deleted_at IS NULL
          LIMIT 1
        `,
        [companyId],
      )

      if (!rows[0]) {
        return response.status(404).json({ message: 'Company not found.' })
      }

      const { rows: documents } = await pool.query(
        `
          SELECT
            id,
            document_type AS "documentType",
            original_filename AS "originalFilename",
            mime_type AS "mimeType",
            file_size AS "fileSize",
            sha256,
            created_at AS "createdAt"
          FROM company_documents
          WHERE company_id = $1
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `,
        [companyId],
      )

      return response.json({ company: rows[0], documents })
    } catch (error) {
      return next(error)
    }
  },
)

adminRouter.get('/company-documents/:documentId', async (request, response, next) => {
  const documentId = Number(request.params.documentId)
  if (!Number.isInteger(documentId) || documentId < 1) {
    return response.status(400).json({ message: 'Invalid document ID.' })
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT original_filename, stored_filename, mime_type
        FROM company_documents
        WHERE id = $1 AND deleted_at IS NULL
        LIMIT 1
      `,
      [documentId],
    )
    const document = rows[0]

    if (!document) {
      return response.status(404).json({ message: 'Document not found.' })
    }

    const filePath = path.join(uploadDirectory, path.basename(document.stored_filename))
    response.type(document.mime_type)
    response.set(
      'Content-Disposition',
      `attachment; filename="${document.original_filename.replace(/["\r\n]/g, '_')}"`,
    )

    const stream = createReadStream(filePath)
    stream.on('error', next)
    return stream.pipe(response)
  } catch (error) {
    return next(error)
  }
})

adminRouter.get('/candidate-resumes', async (_request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          candidate_resumes.id,
          candidate_resumes.original_filename AS "resumeFilename",
          candidate_resumes.file_size AS "resumeFileSize",
          candidate_resumes.updated_at AS "resumeUpdatedAt",
          users.id AS "candidateUserId",
          users.full_name AS "candidateName",
          users.email AS "candidateEmail",
          candidate_profiles.headline,
          candidate_profiles.location
        FROM candidate_resumes
        JOIN candidate_profiles
          ON candidate_profiles.id = candidate_resumes.candidate_profile_id
        JOIN users ON users.id = candidate_profiles.user_id
        WHERE users.deleted_at IS NULL
          AND candidate_profiles.deleted_at IS NULL
        ORDER BY candidate_resumes.updated_at DESC
      `,
    )
    return response.json({ resumes: rows })
  } catch (error) {
    return next(error)
  }
})

adminRouter.get(
  '/candidate-resumes/:resumeId/download',
  async (request, response, next) => {
    const resumeId = Number(request.params.resumeId)
    if (!Number.isInteger(resumeId) || resumeId < 1) {
      return response.status(400).json({ message: 'Invalid resume ID.' })
    }

    try {
      const { rows } = await pool.query(
        `
          SELECT original_filename, stored_filename, mime_type
          FROM candidate_resumes
          WHERE id = $1
          LIMIT 1
        `,
        [resumeId],
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

adminRouter.post(
  '/employer-verifications/:companyId/decision',
  async (request, response, next) => {
    const companyId = Number(request.params.companyId)
    const decision = String(request.body.decision ?? '')
    const reason = String(request.body.reason ?? '').trim().slice(0, 2000)

    if (!Number.isInteger(companyId) || companyId < 1) {
      return response.status(400).json({ message: 'Invalid company ID.' })
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return response.status(400).json({
        message: 'Decision must be approved or rejected.',
      })
    }
    if (decision === 'rejected' && reason.length < 5) {
      return response.status(400).json({
        message: 'Provide a clear rejection reason.',
      })
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `
          SELECT id, owner_user_id, name, verification_status
          FROM companies
          WHERE id = $1
            AND deleted_at IS NULL
          FOR UPDATE
        `,
        [companyId],
      )
      const company = rows[0]

      if (!company) {
        await client.query('ROLLBACK')
        return response.status(404).json({ message: 'Company not found.' })
      }
      if (company.verification_status !== 'pending') {
        await client.query('ROLLBACK')
        return response.status(409).json({
          message: 'Only pending company submissions can be reviewed.',
        })
      }

      const documentResult = await client.query(
        `
          SELECT 1
          FROM company_documents
          WHERE company_id = $1 AND deleted_at IS NULL
          LIMIT 1
        `,
        [companyId],
      )
      if (!documentResult.rows[0]) {
        await client.query('ROLLBACK')
        return response.status(409).json({
          message: 'The company has no verification documents.',
        })
      }

      await client.query(
        `
          UPDATE companies
          SET
            verification_status = $1,
            reviewed_at = NOW(),
            reviewed_by_user_id = $2,
            rejection_reason = $3
          WHERE id = $4
        `,
        [
          decision,
          Number(request.auth.sub),
          decision === 'rejected' ? reason : null,
          companyId,
        ],
      )
      await client.query(
        `
          INSERT INTO company_verification_reviews (
            company_id,
            reviewer_user_id,
            decision,
            reason
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          companyId,
          Number(request.auth.sub),
          decision,
          decision === 'rejected' ? reason : null,
        ],
      )
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
          VALUES ($1, $2, $3, $4, 'company', $5)
        `,
        [
          company.owner_user_id,
          `company_verification_${decision}`,
          decision === 'approved'
            ? 'Company verification approved'
            : 'Company verification rejected',
          decision === 'approved'
            ? `${company.name} is now verified.`
            : reason,
          companyId,
        ],
      )
      await writeAuditLog(client, request, {
        action: `company.verification_${decision}`,
        entityType: 'company',
        entityId: companyId,
        oldValues: { verificationStatus: company.verification_status },
        newValues: {
          verificationStatus: decision,
          reason: decision === 'rejected' ? reason : null,
        },
      })
      await client.query('COMMIT')

      return response.json({
        message:
          decision === 'approved'
            ? 'Company verification approved.'
            : 'Company verification rejected.',
      })
    } catch (error) {
      await client.query('ROLLBACK')
      return next(error)
    } finally {
      client.release()
    }
  },
)

adminRouter.get('/users', async (request, response, next) => {
  const role = cleanText(request.query.role, 50)
  const status = cleanText(request.query.status, 20)
  const query = cleanText(request.query.query, 120)

  try {
    const { rows } = await pool.query(
      `
        SELECT
          users.id,
          users.full_name AS "fullName",
          users.email,
          users.account_status AS "accountStatus",
          users.is_active AS "isActive",
          users.email_verified_at AS "emailVerifiedAt",
          users.created_at AS "createdAt",
          users.last_login_at AS "lastLoginAt",
          roles.name AS role
        FROM users
        JOIN roles ON roles.id = users.role_id
        WHERE users.deleted_at IS NULL
          AND ($1 = '' OR roles.name = $1)
          AND ($2 = '' OR users.account_status = $2)
          AND (
            $3 = ''
            OR users.full_name ILIKE '%' || $3 || '%'
            OR users.email ILIKE '%' || $3 || '%'
          )
        ORDER BY users.created_at DESC
        LIMIT 200
      `,
      [role, status, query],
    )
    return response.json({ users: rows })
  } catch (error) {
    return next(error)
  }
})

adminRouter.patch('/users/:userId/status', async (request, response, next) => {
  const userId = Number(request.params.userId)
  const status = cleanText(request.body.status, 20)
  const reason = cleanText(request.body.reason, 1000)

  if (!Number.isInteger(userId) || userId < 1) {
    return response.status(400).json({ message: 'Invalid user ID.' })
  }
  if (!['active', 'suspended'].includes(status)) {
    return response.status(400).json({ message: 'Select active or suspended.' })
  }
  if (status === 'suspended' && reason.length < 5) {
    return response.status(400).json({
      message: 'Provide a reason before suspending a user.',
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query(
      `
        SELECT id, account_status
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE
      `,
      [userId],
    )
    const user = currentResult.rows[0]
    if (!user) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'User not found.' })
    }
    await client.query(
      `
        UPDATE users
        SET account_status = $1, is_active = ($1 <> 'suspended')
        WHERE id = $2
      `,
      [status, userId],
    )
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
        VALUES ($1, $2, $3, $4, 'user', $1)
      `,
      [
        userId,
        status === 'suspended' ? 'account_suspended' : 'account_restored',
        status === 'suspended' ? 'Account suspended' : 'Account restored',
        status === 'suspended'
          ? reason
          : 'Your account access has been restored.',
      ],
    )
    await writeAuditLog(client, request, {
      action: status === 'suspended' ? 'user.suspended' : 'user.restored',
      entityType: 'user',
      entityId: userId,
      oldValues: { accountStatus: user.account_status },
      newValues: { accountStatus: status, reason },
    })
    await client.query('COMMIT')
    return response.json({
      message:
        status === 'suspended'
          ? 'User suspended.'
          : 'User restored.',
      status,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

adminRouter.get('/jobs', async (request, response, next) => {
  const status = cleanText(request.query.status, 30)
  const query = cleanText(request.query.query, 120)

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
          jobs.featured,
          jobs.published_at AS "publishedAt",
          jobs.created_at AS "createdAt",
          companies.name AS company,
          companies.verification_status AS "companyVerificationStatus",
          COUNT(applications.id)::INTEGER AS "applicationCount"
        FROM jobs
        JOIN companies ON companies.id = jobs.company_id
        LEFT JOIN applications
          ON applications.job_id = jobs.id
          AND applications.deleted_at IS NULL
        WHERE jobs.deleted_at IS NULL
          AND ($1 = '' OR jobs.status::TEXT = $1)
          AND (
            $2 = ''
            OR jobs.title ILIKE '%' || $2 || '%'
            OR companies.name ILIKE '%' || $2 || '%'
          )
        GROUP BY jobs.id, companies.id
        ORDER BY jobs.created_at DESC
        LIMIT 200
      `,
      [status, query],
    )
    return response.json({ jobs: rows })
  } catch (error) {
    return next(error)
  }
})

adminRouter.patch('/jobs/:jobId/moderation', async (request, response, next) => {
  const jobId = Number(request.params.jobId)
  const action = cleanText(request.body.action, 30)
  const reason = cleanText(request.body.reason, 1000)
  const allowed = new Set(['remove', 'archive', 'restore', 'feature', 'unfeature'])

  if (!Number.isInteger(jobId) || jobId < 1) {
    return response.status(400).json({ message: 'Invalid job ID.' })
  }
  if (!allowed.has(action)) {
    return response.status(400).json({ message: 'Select a valid moderation action.' })
  }
  if (['remove', 'archive'].includes(action) && reason.length < 5) {
    return response.status(400).json({
      message: 'Provide a moderation reason.',
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query(
      `
        SELECT jobs.id, jobs.status, jobs.title, companies.owner_user_id
        FROM jobs
        JOIN companies ON companies.id = jobs.company_id
        WHERE jobs.id = $1 AND jobs.deleted_at IS NULL
        FOR UPDATE OF jobs
      `,
      [jobId],
    )
    const job = currentResult.rows[0]
    if (!job) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Job not found.' })
    }

    if (action === 'remove') {
      await client.query(
        `
          UPDATE jobs
          SET deleted_at = NOW(), status = 'archived', archived_at = NOW()
          WHERE id = $1
        `,
        [jobId],
      )
    } else if (action === 'archive') {
      await client.query(
        `UPDATE jobs SET status = 'archived', archived_at = NOW() WHERE id = $1`,
        [jobId],
      )
    } else if (action === 'restore') {
      await client.query(`UPDATE jobs SET status = 'draft' WHERE id = $1`, [
        jobId,
      ])
    } else if (action === 'feature') {
      await client.query(`UPDATE jobs SET featured = TRUE WHERE id = $1`, [jobId])
    } else if (action === 'unfeature') {
      await client.query(`UPDATE jobs SET featured = FALSE WHERE id = $1`, [jobId])
    }

    if (job.owner_user_id) {
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
          VALUES ($1, 'job_moderated', $2, $3, 'job', $4)
        `,
        [
          job.owner_user_id,
          'Job moderation update',
          `${job.title}: ${action}${reason ? `. ${reason}` : ''}`,
          jobId,
        ],
      )
    }
    await writeAuditLog(client, request, {
      action: `job.${action}`,
      entityType: 'job',
      entityId: jobId,
      oldValues: { status: job.status },
      newValues: { action, reason },
    })
    await client.query('COMMIT')
    return response.json({ message: 'Job moderation action completed.' })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

adminRouter.get('/reports', async (request, response, next) => {
  const status = cleanText(request.query.status, 30)
  try {
    const { rows } = await pool.query(
      `
        SELECT
          content_reports.id,
          content_reports.reported_entity_type AS "entityType",
          content_reports.reported_entity_id AS "entityId",
          content_reports.reason,
          content_reports.details,
          content_reports.status,
          content_reports.resolution_notes AS "resolutionNotes",
          content_reports.created_at AS "createdAt",
          reporter.full_name AS "reporterName",
          reviewer.full_name AS "reviewerName"
        FROM content_reports
        LEFT JOIN users AS reporter
          ON reporter.id = content_reports.reporter_user_id
        LEFT JOIN users AS reviewer
          ON reviewer.id = content_reports.reviewed_by_user_id
        WHERE content_reports.deleted_at IS NULL
          AND ($1 = '' OR content_reports.status = $1)
        ORDER BY content_reports.created_at DESC
        LIMIT 200
      `,
      [status],
    )
    return response.json({ reports: rows })
  } catch (error) {
    return next(error)
  }
})

adminRouter.post('/reports', async (request, response, next) => {
  const entityType = cleanText(request.body.entityType, 60)
  const entityId = Number(request.body.entityId)
  const reason = cleanText(request.body.reason, 180)
  const details = cleanText(request.body.details, 5000)

  if (
    ![
      'job',
      'company',
      'candidate',
      'community',
      'application',
      'user',
      'other',
    ].includes(entityType) ||
    reason.length < 3
  ) {
    return response.status(400).json({
      message: 'Select a reported entity type and reason.',
    })
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO content_reports (
          reporter_user_id,
          reported_entity_type,
          reported_entity_id,
          reason,
          details
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, status
      `,
      [
        Number(request.auth.sub),
        entityType,
        Number.isInteger(entityId) && entityId > 0 ? entityId : null,
        reason,
        details || null,
      ],
    )
    return response.status(201).json({
      message: 'Report created.',
      report: rows[0],
    })
  } catch (error) {
    return next(error)
  }
})

adminRouter.patch('/reports/:reportId', async (request, response, next) => {
  const reportId = Number(request.params.reportId)
  const status = cleanText(request.body.status, 30)
  const resolutionNotes = cleanText(request.body.resolutionNotes, 2000)

  if (!Number.isInteger(reportId) || reportId < 1) {
    return response.status(400).json({ message: 'Invalid report ID.' })
  }
  if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
    return response.status(400).json({ message: 'Select a valid report status.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        UPDATE content_reports
        SET
          status = $1,
          resolution_notes = $2,
          reviewed_by_user_id = $3,
          reviewed_at = CASE
            WHEN $1 IN ('resolved', 'dismissed') THEN NOW()
            ELSE reviewed_at
          END
        WHERE id = $4 AND deleted_at IS NULL
        RETURNING id, status
      `,
      [status, resolutionNotes || null, Number(request.auth.sub), reportId],
    )
    if (!rows[0]) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Report not found.' })
    }
    await writeAuditLog(client, request, {
      action: 'report.reviewed',
      entityType: 'content_report',
      entityId: reportId,
      newValues: { status, resolutionNotes },
    })
    await client.query('COMMIT')
    return response.json({ message: 'Report updated.', report: rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

adminRouter.get('/roles-permissions', async (_request, response, next) => {
  try {
    const [rolesResult, permissionsResult] = await Promise.all([
      pool.query(
        `
          SELECT
            roles.id,
            roles.name,
            roles.description,
            COALESCE(
              ARRAY_AGG(permissions.code ORDER BY permissions.code)
                FILTER (WHERE permissions.id IS NOT NULL),
              '{}'
            ) AS permissions
          FROM roles
          LEFT JOIN role_permissions
            ON role_permissions.role_id = roles.id
          LEFT JOIN permissions
            ON permissions.id = role_permissions.permission_id
          GROUP BY roles.id
          ORDER BY roles.id
        `,
      ),
      pool.query(
        `
          SELECT id, code, description
          FROM permissions
          ORDER BY code
        `,
      ),
    ])
    return response.json({
      roles: rolesResult.rows,
      permissions: permissionsResult.rows,
    })
  } catch (error) {
    return next(error)
  }
})

adminRouter.post('/roles/:roleId/permissions', async (request, response, next) => {
  const roleId = Number(request.params.roleId)
  const permissionCode = cleanText(request.body.permissionCode, 100)
  const grant = request.body.grant !== false

  if (!Number.isInteger(roleId) || roleId < 1 || !permissionCode) {
    return response.status(400).json({ message: 'Invalid role or permission.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const permissionResult = await client.query(
      'SELECT id FROM permissions WHERE code = $1 LIMIT 1',
      [permissionCode],
    )
    const permissionId = permissionResult.rows[0]?.id
    if (!permissionId) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Permission not found.' })
    }
    if (grant) {
      await client.query(
        `
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [roleId, permissionId],
      )
    } else {
      await client.query(
        `
          DELETE FROM role_permissions
          WHERE role_id = $1 AND permission_id = $2
        `,
        [roleId, permissionId],
      )
    }
    await writeAuditLog(client, request, {
      action: grant ? 'role.permission_granted' : 'role.permission_revoked',
      entityType: 'role',
      entityId: roleId,
      newValues: { permissionCode },
    })
    await client.query('COMMIT')
    return response.json({
      message: grant ? 'Permission granted.' : 'Permission revoked.',
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

adminRouter.get('/billing', async (_request, response, next) => {
  try {
    const [subscriptionsResult, paymentsResult] = await Promise.all([
      pool.query(
        `
          SELECT
            subscriptions.id,
            subscriptions.plan_code AS "planCode",
            subscriptions.plan_name AS "planName",
            subscriptions.status,
            subscriptions.billing_period AS "billingPeriod",
            subscriptions.amount_cents AS "amountCents",
            subscriptions.currency,
            subscriptions.starts_at AS "startsAt",
            subscriptions.current_period_ends_at AS "currentPeriodEndsAt",
            companies.name AS company
          FROM subscriptions
          JOIN companies ON companies.id = subscriptions.company_id
          WHERE subscriptions.deleted_at IS NULL
          ORDER BY subscriptions.created_at DESC
          LIMIT 100
        `,
      ),
      pool.query(
        `
          SELECT
            payments.id,
            payments.amount_cents AS "amountCents",
            payments.currency,
            payments.status,
            payments.provider,
            payments.paid_at AS "paidAt",
            payments.created_at AS "createdAt",
            companies.name AS company
          FROM payments
          JOIN companies ON companies.id = payments.company_id
          ORDER BY payments.created_at DESC
          LIMIT 100
        `,
      ),
    ])
    return response.json({
      subscriptions: subscriptionsResult.rows,
      payments: paymentsResult.rows,
    })
  } catch (error) {
    return next(error)
  }
})

adminRouter.get('/analytics', async (_request, response, next) => {
  try {
    const [usersResult, jobsResult, applicationsResult, billingResult] =
      await Promise.all([
        pool.query(
          `
            SELECT roles.name AS role, COUNT(*)::INTEGER AS count
            FROM users
            JOIN roles ON roles.id = users.role_id
            WHERE users.deleted_at IS NULL
            GROUP BY roles.name
            ORDER BY roles.name
          `,
        ),
        pool.query(
          `
            SELECT status::TEXT, COUNT(*)::INTEGER AS count
            FROM jobs
            WHERE deleted_at IS NULL
            GROUP BY status
            ORDER BY status
          `,
        ),
        pool.query(
          `
            SELECT status::TEXT, COUNT(*)::INTEGER AS count
            FROM applications
            WHERE deleted_at IS NULL
            GROUP BY status
            ORDER BY status
          `,
        ),
        pool.query(
          `
            SELECT
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::INTEGER
                AS "paidAmountCents",
              COUNT(*)::INTEGER AS "paymentCount"
            FROM payments
          `,
        ),
      ])

    return response.json({
      usersByRole: usersResult.rows,
      jobsByStatus: jobsResult.rows,
      applicationsByStatus: applicationsResult.rows,
      billing: billingResult.rows[0],
    })
  } catch (error) {
    return next(error)
  }
})

adminRouter.get('/categories', async (request, response, next) => {
  const type = cleanText(request.query.type, 40)
  try {
    const { rows } = await pool.query(
      `
        SELECT id, category_type AS "categoryType", name, slug, is_active AS "isActive"
        FROM platform_categories
        WHERE deleted_at IS NULL
          AND ($1 = '' OR category_type = $1)
        ORDER BY category_type, name
      `,
      [type],
    )
    return response.json({ categories: rows })
  } catch (error) {
    return next(error)
  }
})

adminRouter.post('/categories', async (request, response, next) => {
  const categoryType = cleanText(request.body.categoryType, 40)
  const name = cleanText(request.body.name, 160)
  const slug = slugFor(request.body.slug || name)

  if (!CATEGORY_TYPES.has(categoryType) || name.length < 2 || !slug) {
    return response.status(400).json({
      message: 'Select a category type and name.',
    })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        INSERT INTO platform_categories (category_type, name, slug)
        VALUES ($1, $2, $3)
        ON CONFLICT (category_type, slug) DO UPDATE SET
          name = EXCLUDED.name,
          is_active = TRUE,
          deleted_at = NULL
        RETURNING id, category_type AS "categoryType", name, slug, is_active AS "isActive"
      `,
      [categoryType, name, slug],
    )
    if (categoryType === 'skill') {
      await client.query(
        `
          INSERT INTO skills (name, slug, category)
          VALUES ($1, $2, 'technical')
          ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, deleted_at = NULL
        `,
        [name, slug],
      )
    }
    await writeAuditLog(client, request, {
      action: 'category.saved',
      entityType: 'platform_category',
      entityId: rows[0].id,
      newValues: { categoryType, name, slug },
    })
    await client.query('COMMIT')
    return response.status(201).json({
      message: 'Category saved.',
      category: rows[0],
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

adminRouter.patch('/categories/:categoryId', async (request, response, next) => {
  const categoryId = Number(request.params.categoryId)
  const isActive = Boolean(request.body.isActive)
  if (!Number.isInteger(categoryId) || categoryId < 1) {
    return response.status(400).json({ message: 'Invalid category ID.' })
  }
  try {
    const { rows } = await pool.query(
      `
        UPDATE platform_categories
        SET is_active = $1
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING id, is_active AS "isActive"
      `,
      [isActive, categoryId],
    )
    if (!rows[0]) {
      return response.status(404).json({ message: 'Category not found.' })
    }
    return response.json({ message: 'Category updated.', category: rows[0] })
  } catch (error) {
    return next(error)
  }
})

adminRouter.get(
  '/audit-logs',
  requirePermission('audit_logs.read'),
  async (request, response, next) => {
    try {
      const { rows } = await pool.query(
        `
          SELECT
            audit_logs.id,
            audit_logs.action,
            audit_logs.entity_type AS "entityType",
            audit_logs.entity_id AS "entityId",
            audit_logs.old_values AS "oldValues",
            audit_logs.new_values AS "newValues",
            audit_logs.ip_address AS "ipAddress",
            audit_logs.created_at AS "createdAt",
            users.full_name AS "actorName",
            users.email AS "actorEmail"
          FROM audit_logs
          LEFT JOIN users ON users.id = audit_logs.actor_user_id
          ORDER BY audit_logs.created_at DESC
          LIMIT 200
        `,
      )

      return response.json({ auditLogs: rows })
    } catch (error) {
      return next(error)
    }
  },
)

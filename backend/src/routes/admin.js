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

export const adminRouter = Router()

adminRouter.use(
  requireAuth,
  requireRole('admin'),
  requirePermission('platform.manage'),
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
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

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../config/env.js'
import { pool } from '../db/pool.js'
import {
  requireAuth,
  requirePermission,
  requireRole,
} from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { writeAuditLog } from '../services/audit.js'
import {
  EMAIL_VERIFICATION_DURATION_MS,
  createOpaqueToken,
  hashToken,
} from '../services/auth.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_HASH_ROUNDS = 12
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/
const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024
const DOCUMENT_TYPES = new Set([
  'business_registration',
  'tax_certificate',
  'owner_identification',
  'address_proof',
  'other',
])
const ALLOWED_MIME_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
])
const uploadDirectory = path.resolve('private-uploads', 'company-documents')

await fs.mkdir(uploadDirectory, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => {
      const extension = ALLOWED_MIME_TYPES.get(file.mimetype) ?? ''
      callback(null, `${randomUUID()}${extension}`)
    },
  }),
  limits: {
    files: 1,
    fileSize: MAX_DOCUMENT_SIZE,
    fields: 10,
  },
  fileFilter: (_request, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(
        new multer.MulterError(
          'LIMIT_UNEXPECTED_FILE',
          'Only PDF, JPEG, and PNG documents are accepted.',
        ),
      )
    }
    return callback(null, true)
  },
})
const documentUploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many document uploads. Try again later.',
})

export const employersRouter = Router()

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function companySlug(name, userId) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180)

  return `${base || 'company'}-${userId}`
}

function developmentAction(token) {
  if (env.nodeEnv === 'production') return {}

  return {
    developmentActionUrl: `${env.clientOrigin}/verify-email?token=${encodeURIComponent(token)}`,
  }
}

async function employerCompany(client, userId) {
  const { rows } = await client.query(
    `
      SELECT
        companies.id,
        companies.name,
        companies.slug,
        companies.website_url AS "websiteUrl",
        companies.description,
        companies.headquarters_location AS "headquartersLocation",
        companies.industry,
        companies.company_size AS "companySize",
        companies.registration_number AS "registrationNumber",
        companies.tax_identifier AS "taxIdentifier",
        companies.contact_email AS "contactEmail",
        companies.contact_phone AS "contactPhone",
        companies.verification_status AS "verificationStatus",
        companies.submitted_at AS "submittedAt",
        companies.reviewed_at AS "reviewedAt",
        companies.rejection_reason AS "rejectionReason"
      FROM companies
      WHERE companies.owner_user_id = $1
        AND companies.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )

  return rows[0] ?? null
}

const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many employer registration attempts. Try again later.',
})

employersRouter.post(
  '/register',
  registrationRateLimit,
  async (request, response, next) => {
    const fullName = cleanText(request.body.fullName, 200)
    const email = normalizeEmail(request.body.email)
    const password = String(request.body.password ?? '')

    if (fullName.length < 2) {
      return response.status(400).json({ message: 'Enter your full name.' })
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 320) {
      return response.status(400).json({ message: 'Enter a valid email address.' })
    }
    if (
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > 200 ||
      !PASSWORD_PATTERN.test(password)
    ) {
      return response.status(400).json({
        message:
          'Password must be at least 8 characters and include uppercase, lowercase, and a number.',
      })
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS)
      const { rows } = await client.query(
        `
          INSERT INTO users (full_name, email, password_hash, role_id)
          SELECT $1, $2, $3, roles.id
          FROM roles
          WHERE roles.name = 'employer'
          RETURNING id, email
        `,
        [fullName, email, passwordHash],
      )
      const user = rows[0]
      const verificationToken = createOpaqueToken()

      await client.query(
        `
          INSERT INTO email_verification_tokens (
            user_id,
            token_hash,
            expires_at
          )
          VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
        `,
        [
          user.id,
          hashToken(verificationToken),
          EMAIL_VERIFICATION_DURATION_MS,
        ],
      )
      await writeAuditLog(client, request, {
        actorUserId: user.id,
        action: 'employer.registered',
        entityType: 'user',
        entityId: user.id,
        newValues: { email: user.email, role: 'employer' },
      })
      await client.query('COMMIT')

      return response.status(201).json({
        message: 'Employer account created. Verify your email before signing in.',
        email: user.email,
        ...developmentAction(verificationToken),
      })
    } catch (error) {
      await client.query('ROLLBACK')
      if (error.code === '23505') {
        return response.status(409).json({
          message: 'An account with this email already exists.',
        })
      }
      return next(error)
    } finally {
      client.release()
    }
  },
)

employersRouter.use(requireAuth, requireRole('employer'))

employersRouter.get(
  '/company',
  requirePermission('companies.manage_own'),
  async (request, response, next) => {
    try {
      const company = await employerCompany(pool, Number(request.auth.sub))

      if (!company) {
        return response.status(404).json({ message: 'Company profile not found.' })
      }

      const { rows: documents } = await pool.query(
        `
          SELECT
            id,
            document_type AS "documentType",
            original_filename AS "originalFilename",
            mime_type AS "mimeType",
            file_size AS "fileSize",
            created_at AS "createdAt"
          FROM company_documents
          WHERE company_id = $1
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `,
        [company.id],
      )

      return response.json({ company, documents })
    } catch (error) {
      return next(error)
    }
  },
)

employersRouter.put(
  '/company',
  requirePermission('companies.manage_own'),
  async (request, response, next) => {
    const userId = Number(request.auth.sub)
    const name = cleanText(request.body.name, 200)
    const websiteUrl = cleanText(request.body.websiteUrl, 500) || null
    const description = cleanText(request.body.description, 5000)
    const headquartersLocation = cleanText(
      request.body.headquartersLocation,
      150,
    )
    const industry = cleanText(request.body.industry, 120)
    const companySize = cleanText(request.body.companySize, 40)
    const registrationNumber = cleanText(
      request.body.registrationNumber,
      120,
    )
    const taxIdentifier = cleanText(request.body.taxIdentifier, 120) || null
    const contactEmail = normalizeEmail(request.body.contactEmail)
    const contactPhone = cleanText(request.body.contactPhone, 40)
    const submit = request.body.submit === true

    if (
      name.length < 2 ||
      description.length < 20 ||
      !headquartersLocation ||
      !industry ||
      !companySize ||
      !registrationNumber ||
      !contactPhone ||
      !EMAIL_PATTERN.test(contactEmail)
    ) {
      return response.status(400).json({
        message:
          'Name, description, location, industry, company size, registration number, contact email, and phone are required.',
      })
    }

    let parsedWebsiteUrl = websiteUrl
    if (websiteUrl) {
      try {
        const url = new URL(websiteUrl)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
        parsedWebsiteUrl = url.toString()
      } catch {
        return response.status(400).json({
          message: 'Website URL must use http or https.',
        })
      }
    }

    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const existing = await employerCompany(client, userId)
      let companyId = existing?.id

      if (!existing) {
        const { rows } = await client.query(
          `
            INSERT INTO companies (
              owner_user_id,
              name,
              slug,
              website_url,
              description,
              headquarters_location,
              industry,
              company_size,
              registration_number,
              tax_identifier,
              contact_email,
              contact_phone
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
          `,
          [
            userId,
            name,
            companySlug(name, userId),
            parsedWebsiteUrl,
            description,
            headquartersLocation,
            industry,
            companySize,
            registrationNumber,
            taxIdentifier,
            contactEmail,
            contactPhone,
          ],
        )
        companyId = rows[0].id
      } else {
        await client.query(
          `
            UPDATE companies
            SET
              name = $1,
              website_url = $2,
              description = $3,
              headquarters_location = $4,
              industry = $5,
              company_size = $6,
              registration_number = $7,
              tax_identifier = $8,
              contact_email = $9,
              contact_phone = $10,
              verification_status = 'draft',
              submitted_at = NULL,
              reviewed_at = NULL,
              reviewed_by_user_id = NULL,
              rejection_reason = NULL
            WHERE id = $11
          `,
          [
            name,
            parsedWebsiteUrl,
            description,
            headquartersLocation,
            industry,
            companySize,
            registrationNumber,
            taxIdentifier,
            contactEmail,
            contactPhone,
            companyId,
          ],
        )
      }

      if (submit) {
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
          return response.status(400).json({
            message: 'Upload at least one verification document before submitting.',
          })
        }

        await client.query(
          `
            UPDATE companies
            SET verification_status = 'pending', submitted_at = NOW()
            WHERE id = $1
          `,
          [companyId],
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
            VALUES (
              $1,
              'company_verification_submitted',
              'Company verification submitted',
              'Your company profile is waiting for admin review.',
              'company',
              $2
            )
          `,
          [userId, companyId],
        )
      }

      await writeAuditLog(client, request, {
        action: submit
          ? 'company.verification_submitted'
          : existing
            ? 'company.profile_updated'
            : 'company.profile_created',
        entityType: 'company',
        entityId: companyId,
        oldValues: existing,
        newValues: {
          name,
          verificationStatus: submit ? 'pending' : 'draft',
        },
      })
      const company = await employerCompany(client, userId)
      await client.query('COMMIT')

      return response.json({
        message: submit
          ? 'Company submitted for verification.'
          : 'Company profile saved as a draft.',
        company,
      })
    } catch (error) {
      await client.query('ROLLBACK')
      return next(error)
    } finally {
      client.release()
    }
  },
)

employersRouter.post(
  '/company/documents',
  requirePermission('companies.manage_own'),
  documentUploadRateLimit,
  upload.single('document'),
  async (request, response, next) => {
    const documentType = cleanText(request.body.documentType, 40)

    if (!request.file || !DOCUMENT_TYPES.has(documentType)) {
      if (request.file) await fs.unlink(request.file.path).catch(() => {})
      return response.status(400).json({
        message: 'A valid document type and file are required.',
      })
    }

    const client = await pool.connect()

    try {
      const userId = Number(request.auth.sub)
      const company = await employerCompany(client, userId)

      if (!company) {
        await fs.unlink(request.file.path).catch(() => {})
        return response.status(404).json({
          message: 'Create the company profile before uploading documents.',
        })
      }

      const fileBuffer = await fs.readFile(request.file.path)
      const isPdf =
        request.file.mimetype === 'application/pdf' &&
        fileBuffer.subarray(0, 4).toString() === '%PDF'
      const isJpeg =
        request.file.mimetype === 'image/jpeg' &&
        fileBuffer[0] === 0xff &&
        fileBuffer[1] === 0xd8 &&
        fileBuffer[2] === 0xff
      const pngSignature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])
      const isPng =
        request.file.mimetype === 'image/png' &&
        fileBuffer.subarray(0, 8).equals(pngSignature)

      if (!isPdf && !isJpeg && !isPng) {
        await fs.unlink(request.file.path).catch(() => {})
        return response.status(400).json({
          message: 'The uploaded file content does not match its file type.',
        })
      }

      const sha256 = createHash('sha256').update(fileBuffer).digest('hex')

      await client.query('BEGIN')
      const { rows } = await client.query(
        `
          INSERT INTO company_documents (
            company_id,
            uploaded_by_user_id,
            document_type,
            original_filename,
            stored_filename,
            mime_type,
            file_size,
            sha256
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING
            id,
            document_type AS "documentType",
            original_filename AS "originalFilename",
            mime_type AS "mimeType",
            file_size AS "fileSize",
            created_at AS "createdAt"
        `,
        [
          company.id,
          userId,
          documentType,
          path.basename(request.file.originalname).slice(0, 255),
          request.file.filename,
          request.file.mimetype,
          request.file.size,
          sha256,
        ],
      )
      await client.query(
        `
          UPDATE companies
          SET
            verification_status = 'draft',
            submitted_at = NULL,
            reviewed_at = NULL,
            reviewed_by_user_id = NULL,
            rejection_reason = NULL
          WHERE id = $1
        `,
        [company.id],
      )
      await writeAuditLog(client, request, {
        action: 'company.document_uploaded',
        entityType: 'company_document',
        entityId: rows[0].id,
        newValues: {
          companyId: company.id,
          documentType,
          mimeType: request.file.mimetype,
          fileSize: request.file.size,
          sha256,
        },
      })
      await client.query('COMMIT')

      return response.status(201).json({
        message: 'Verification document uploaded.',
        document: rows[0],
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      await fs.unlink(request.file.path).catch(() => {})
      return next(error)
    } finally {
      client.release()
    }
  },
)

employersRouter.get('/notifications', async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          id,
          notification_type AS "notificationType",
          title,
          body,
          read_at AS "readAt",
          created_at AS "createdAt"
        FROM notifications
        WHERE user_id = $1
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [Number(request.auth.sub)],
    )

    return response.json({ notifications: rows })
  } catch (error) {
    return next(error)
  }
})

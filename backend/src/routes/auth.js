import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import multer from 'multer'
import { env } from '../config/env.js'
import { pool } from '../db/pool.js'
import { rateLimit } from '../middleware/rateLimit.js'
import {
  REFRESH_COOKIE_NAME,
  requireAuth,
  requireRole,
} from '../middleware/auth.js'
import {
  EMAIL_VERIFICATION_DURATION_MS,
  PASSWORD_RESET_DURATION_MS,
  REFRESH_TOKEN_DURATION_MS,
  clearAuthCookies,
  createOpaqueToken,
  hashToken,
  publicUser,
  setAuthCookies,
} from '../services/auth.js'
import { writeAuditLog } from '../services/audit.js'
import { sendVerificationEmail } from '../services/email.js'
import {
  getAuthUserState,
  persistCompletion,
} from '../services/profileCompletion.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_HASH_ROUNDS = 12
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/
const PUBLIC_ROLES = new Set(['candidate', 'employer', 'tech_community'])
const MAX_RESUME_SIZE = 5 * 1024 * 1024
const RESUME_MIME_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docx',
  ],
])
const resumeUploadDirectory = path.resolve(
  'private-uploads',
  'candidate-resumes',
)

await fs.mkdir(resumeUploadDirectory, { recursive: true })

const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: resumeUploadDirectory,
    filename: (_request, file, callback) => {
      callback(
        null,
        `${randomUUID()}${RESUME_MIME_TYPES.get(file.mimetype) ?? ''}`,
      )
    },
  }),
  limits: {
    files: 1,
    fileSize: MAX_RESUME_SIZE,
    fields: 2,
  },
  fileFilter: (_request, file, callback) => {
    if (!RESUME_MIME_TYPES.has(file.mimetype)) {
      return callback(
        new multer.MulterError(
          'LIMIT_UNEXPECTED_FILE',
          'Only PDF, DOC, and DOCX resumes are accepted.',
        ),
      )
    }
    return callback(null, true)
  },
})
const resumeUploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many resume uploads. Try again later.',
})

export const authRouter = Router()
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
})
const accountActionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many account requests. Try again later.',
})

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function requestIp(request) {
  return request.ip || request.socket.remoteAddress || null
}

function userAgent(request) {
  return String(request.get('user-agent') ?? '').slice(0, 1000) || null
}

function developmentAction(path, token) {
  if (env.nodeEnv === 'production') return {}

  return {
    developmentActionUrl: `${env.clientOrigin}${path}?token=${encodeURIComponent(token)}`,
  }
}

function providerConfiguration() {
  return {
    google: Boolean(
      env.oauth.google.clientId && env.oauth.google.clientSecret,
    ),
    apple: Boolean(
      env.oauth.apple.clientId &&
        env.oauth.apple.teamId &&
        env.oauth.apple.keyId &&
        env.oauth.apple.privateKey,
    ),
    microsoft: Boolean(
      env.oauth.microsoft.clientId && env.oauth.microsoft.clientSecret,
    ),
  }
}

async function findPublicUser(client, userId) {
  return getAuthUserState(client, userId)
}

async function createRefreshSession(client, request, userId) {
  const token = createOpaqueToken()

  await client.query(
    `
      INSERT INTO refresh_tokens (
        user_id,
        token_hash,
        expires_at,
        created_by_ip,
        user_agent
      )
      VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'), $4, $5)
    `,
    [
      userId,
      hashToken(token),
      REFRESH_TOKEN_DURATION_MS,
      requestIp(request),
      userAgent(request),
    ],
  )

  return token
}

async function createActionToken(client, table, userId, durationMs) {
  const token = createOpaqueToken()

  await client.query(
    `
      UPDATE ${table}
      SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL
    `,
    [userId],
  )
  await client.query(
    `
      INSERT INTO ${table} (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'))
    `,
    [userId, hashToken(token), durationMs],
  )

  return token
}

authRouter.get('/providers', (_request, response) => {
  response.json({ providers: providerConfiguration() })
})

authRouter.get('/oauth/:provider', (request, response) => {
  const provider = request.params.provider
  const providers = providerConfiguration()

  if (!Object.hasOwn(providers, provider)) {
    return response.status(404).json({ message: 'Unknown sign-in provider.' })
  }

  if (!providers[provider]) {
    return response.status(503).json({
      message: `${provider[0].toUpperCase()}${provider.slice(1)} sign-in needs OAuth credentials in backend/.env.`,
      code: 'OAUTH_NOT_CONFIGURED',
    })
  }

  return response.status(501).json({
    message: `${provider[0].toUpperCase()}${provider.slice(1)} credentials are configured. The provider callback will be enabled in the OAuth integration step.`,
    code: 'OAUTH_CALLBACK_PENDING',
  })
})

authRouter.post(
  '/register',
  accountActionRateLimit,
  async (request, response, next) => {
  const fullName = String(request.body.fullName ?? '').trim()
  const email = normalizeEmail(request.body.email)
  const password = String(request.body.password ?? '')
  const confirmPassword = String(request.body.confirmPassword ?? '')
  const role = String(request.body.role ?? '').trim().toLowerCase()

  if (fullName.length < 2) {
    return response.status(400).json({ message: 'Enter your full name.' })
  }
  if (!EMAIL_PATTERN.test(email)) {
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
  if (password !== confirmPassword) {
    return response.status(400).json({ message: 'Passwords do not match.' })
  }
  if (!PUBLIC_ROLES.has(role)) {
    return response.status(400).json({
      message: 'Select Candidate, Employer, or Tech Community.',
    })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS)
    const { rows } = await client.query(
      `
        INSERT INTO users (
          full_name,
          email,
          password_hash,
          role_id,
          account_status
        )
        SELECT $1, $2, $3, roles.id, 'pending'
        FROM roles
        WHERE roles.name = $4
        RETURNING id, email, full_name
      `,
      [fullName, email, passwordHash, role],
    )
    const verificationToken = await createActionToken(
      client,
      'email_verification_tokens',
      rows[0].id,
      EMAIL_VERIFICATION_DURATION_MS,
    )

    await writeAuditLog(client, request, {
      actorUserId: rows[0].id,
      action: 'user.registered',
      entityType: 'user',
      entityId: rows[0].id,
      newValues: { email, role },
    })
    await client.query('COMMIT')
    const actionUrl = `${env.clientOrigin}/verify-email?token=${encodeURIComponent(verificationToken)}`
    await sendVerificationEmail({
      email: rows[0].email,
      fullName: rows[0].full_name,
      actionUrl,
    })
    clearAuthCookies(response)
    return response.status(201).json({
      message:
        'Your account was created successfully. Check your email to verify your account.',
      email: rows[0].email,
      ...developmentAction('/verify-email', verificationToken),
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

async function verifyEmailHandler(request, response, next) {
  const token = String(request.query.token ?? request.body?.token ?? '')

  if (!token) {
    return response.status(400).json({ message: 'Verification token required.' })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        SELECT id, user_id, expires_at, used_at
        FROM email_verification_tokens
        WHERE token_hash = $1
        FOR UPDATE
      `,
      [hashToken(token)],
    )

    if (!rows[0]) {
      await client.query('ROLLBACK')
      return response.status(400).json({
        message: 'This verification link is invalid.',
        code: 'INVALID_VERIFICATION_TOKEN',
      })
    }
    if (rows[0].used_at) {
      await client.query('ROLLBACK')
      return response.status(409).json({
        message: 'This verification link has already been used.',
        code: 'VERIFICATION_TOKEN_USED',
      })
    }
    if (new Date(rows[0].expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK')
      return response.status(400).json({
        message: 'This verification link has expired.',
        code: 'VERIFICATION_TOKEN_EXPIRED',
      })
    }

    await client.query(
      'UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1',
      [rows[0].id],
    )

    await client.query(
      `
        UPDATE users
        SET
          email_verified_at = COALESCE(email_verified_at, NOW()),
          account_status = 'active'
        WHERE id = $1
      `,
      [rows[0].user_id],
    )
    const user = await findPublicUser(client, rows[0].user_id)
    const refreshToken = await createRefreshSession(
      client,
      request,
      rows[0].user_id,
    )
    await client.query('COMMIT')
    setAuthCookies(response, user, refreshToken)
    return response.json({
      message: 'Email verified successfully.',
      user: publicUser(user),
      redirectTo: user.next_route,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
}

authRouter.get('/verify-email', verifyEmailHandler)
authRouter.post('/verify-email', verifyEmailHandler)

authRouter.post(
  '/resend-verification',
  accountActionRateLimit,
  async (request, response, next) => {
  const email = normalizeEmail(request.body.email)
  const genericMessage =
    'If an unverified account exists, a new verification link has been created.'

  if (!EMAIL_PATTERN.test(email)) {
    return response.json({ message: genericMessage })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        SELECT id, full_name
        FROM users
        WHERE email = $1
          AND email_verified_at IS NULL
          AND is_active = TRUE
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    )
    let action = {}

    if (rows[0]) {
      const token = await createActionToken(
        client,
        'email_verification_tokens',
        rows[0].id,
        EMAIL_VERIFICATION_DURATION_MS,
      )
      action = developmentAction('/verify-email', token)
      await sendVerificationEmail({
        email,
        fullName: rows[0].full_name,
        actionUrl: `${env.clientOrigin}/verify-email?token=${encodeURIComponent(token)}`,
      })
    }

    await client.query('COMMIT')
    return response.json({ message: genericMessage, ...action })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
  },
)

authRouter.post('/login', loginRateLimit, async (request, response, next) => {
  const email = normalizeEmail(request.body.email)
  const password = String(request.body.password ?? '')

  if (!EMAIL_PATTERN.test(email) || password.length < PASSWORD_MIN_LENGTH) {
    return response.status(401).json({ message: 'Invalid email or password.' })
  }

  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `
        SELECT
          users.id,
          users.full_name,
          users.email,
          users.password_hash,
          users.email_verified_at,
          roles.name AS role,
          users.is_active,
          users.account_status
        FROM users
        JOIN roles ON roles.id = users.role_id
        WHERE users.email = $1
          AND users.deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    )
    const user = rows[0]

    if (
      !user ||
      !user.is_active ||
      user.account_status === 'suspended' ||
      !user.password_hash ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return response.status(401).json({ message: 'Invalid email or password.' })
    }

    if (!user.email_verified_at) {
      clearAuthCookies(response)
      return response.status(403).json({
        message: 'Verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
      })
    }

    await client.query('BEGIN')
    await client.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id],
    )
    const publicState = await findPublicUser(client, user.id)
    const refreshToken = await createRefreshSession(client, request, user.id)
    await client.query('COMMIT')

    setAuthCookies(response, publicState, refreshToken)
    return response.json({ user: publicUser(publicState) })
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The transaction may not have started.
    }
    return next(error)
  } finally {
    client.release()
  }
})

authRouter.post('/refresh', async (request, response, next) => {
  const token = request.cookies[REFRESH_COOKIE_NAME]

  if (!token) {
    clearAuthCookies(response)
    return response.status(401).json({ message: 'Session refresh required.' })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        SELECT id, user_id
        FROM refresh_tokens
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
        FOR UPDATE
      `,
      [hashToken(token)],
    )
    const storedToken = rows[0]

    if (!storedToken) {
      await client.query('ROLLBACK')
      clearAuthCookies(response)
      return response.status(401).json({ message: 'Session has expired.' })
    }

    const user = await findPublicUser(client, storedToken.user_id)
    if (!user || !user.email_verified_at) {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
        [storedToken.id],
      )
      await client.query('COMMIT')
      clearAuthCookies(response)
      return response.status(401).json({ message: 'Account unavailable.' })
    }

    await client.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = NOW(), last_used_at = NOW()
        WHERE id = $1
      `,
      [storedToken.id],
    )
    const nextRefreshToken = await createRefreshSession(
      client,
      request,
      user.id,
    )
    await client.query('COMMIT')

    setAuthCookies(response, user, nextRefreshToken)
    return response.json({ user: publicUser(user) })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

authRouter.post('/logout', async (request, response, next) => {
  const token = request.cookies[REFRESH_COOKIE_NAME]

  try {
    if (token) {
      await pool.query(
        `
          UPDATE refresh_tokens
          SET revoked_at = COALESCE(revoked_at, NOW())
          WHERE token_hash = $1
        `,
        [hashToken(token)],
      )
    }

    clearAuthCookies(response)
    return response.status(204).end()
  } catch (error) {
    clearAuthCookies(response)
    return next(error)
  }
})

authRouter.post(
  '/forgot-password',
  accountActionRateLimit,
  async (request, response, next) => {
  const email = normalizeEmail(request.body.email)
  const genericMessage =
    'If an account exists for that email, a password reset link has been created.'

  if (!EMAIL_PATTERN.test(email)) {
    return response.json({ message: genericMessage })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        SELECT id
        FROM users
        WHERE email = $1
          AND is_active = TRUE
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    )
    let action = {}

    if (rows[0]) {
      const token = await createActionToken(
        client,
        'password_reset_tokens',
        rows[0].id,
        PASSWORD_RESET_DURATION_MS,
      )
      action = developmentAction('/reset-password', token)
    }

    await client.query('COMMIT')
    return response.json({ message: genericMessage, ...action })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
  },
)

authRouter.post('/reset-password', async (request, response, next) => {
  const token = String(request.body.token ?? '')
  const password = String(request.body.password ?? '')

  if (!token) {
    return response.status(400).json({ message: 'Reset token required.' })
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
    const { rows } = await client.query(
      `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING user_id
      `,
      [hashToken(token)],
    )

    if (!rows[0]) {
      await client.query('ROLLBACK')
      return response.status(400).json({
        message: 'This password reset link is invalid or has expired.',
      })
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS)
    await client.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, rows[0].user_id],
    )
    await client.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE user_id = $1
      `,
      [rows[0].user_id],
    )
    await client.query('COMMIT')

    clearAuthCookies(response)
    return response.json({
      message: 'Password updated. Sign in with your new password.',
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

authRouter.get('/me', requireAuth, async (request, response, next) => {
  try {
    const user = await findPublicUser(pool, Number(request.auth.sub))

    if (!user) {
      clearAuthCookies(response)
      return response.status(401).json({ message: 'Account not found.' })
    }

    return response.json({ user: publicUser(user) })
  } catch (error) {
    return next(error)
  }
})

authRouter.get(
  '/profile',
  requireAuth,
  requireRole('candidate'),
  async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          users.full_name AS "fullName",
          users.email,
          candidate_profiles.phone,
          candidate_profiles.location,
          candidate_profiles.headline,
          candidate_profiles.bio,
          candidate_profiles.years_experience AS "yearsExperience",
          candidate_profiles.linkedin_url AS "linkedinUrl",
          candidate_profiles.portfolio_url AS "portfolioUrl",
          candidate_profiles.desired_roles AS "desiredRoles",
          candidate_profiles.preferred_workplace AS "preferredWorkplace",
          candidate_resumes.id AS "resumeId",
          candidate_resumes.original_filename AS "resumeFilename",
          candidate_resumes.file_size AS "resumeFileSize",
          candidate_resumes.updated_at AS "resumeUpdatedAt",
          COALESCE(
            ARRAY_AGG(skills.name ORDER BY skills.name)
              FILTER (WHERE skills.id IS NOT NULL),
            '{}'
          ) AS skills
        FROM users
        JOIN roles ON roles.id = users.role_id
        LEFT JOIN candidate_profiles
          ON candidate_profiles.user_id = users.id
          AND candidate_profiles.deleted_at IS NULL
        LEFT JOIN candidate_skills
          ON candidate_skills.candidate_profile_id = candidate_profiles.id
        LEFT JOIN skills ON skills.id = candidate_skills.skill_id
        LEFT JOIN candidate_resumes
          ON candidate_resumes.candidate_profile_id = candidate_profiles.id
        WHERE users.id = $1
          AND roles.name = 'candidate'
          AND users.deleted_at IS NULL
        GROUP BY users.id, candidate_profiles.id, candidate_resumes.id
        LIMIT 1
      `,
      [Number(request.auth.sub)],
    )

    if (!rows[0]) {
      return response.status(404).json({
        message: 'Candidate profile not found.',
      })
    }

    return response.json({ profile: rows[0] })
  } catch (error) {
    return next(error)
  }
  },
)

authRouter.put(
  '/profile',
  requireAuth,
  requireRole('candidate'),
  async (request, response, next) => {
  const fullName = String(request.body.fullName ?? '').trim()
  const phone = String(request.body.phone ?? '').trim()
  const location = String(request.body.location ?? '').trim()
  const headline = String(request.body.headline ?? '').trim()
  const bio = String(request.body.bio ?? '').trim()
  const yearsExperience = Number(request.body.yearsExperience ?? 0)
  const linkedinUrl = String(request.body.linkedinUrl ?? '').trim() || null
  const portfolioUrl = String(request.body.portfolioUrl ?? '').trim() || null
  const desiredRoles = Array.isArray(request.body.desiredRoles)
    ? request.body.desiredRoles
        .map((role) => String(role).trim())
        .filter(Boolean)
        .slice(0, 10)
    : []
  const preferredWorkplace =
    String(request.body.preferredWorkplace ?? '').trim() || null
  const skillNames = Array.isArray(request.body.skills)
    ? request.body.skills
        .map((skill) => String(skill).trim())
        .filter(Boolean)
        .slice(0, 30)
    : []

  if (fullName.length < 2 || !phone || !location || !headline) {
    return response.status(400).json({
      message: 'Full name, phone, location, and professional headline are required.',
    })
  }
  if (
    !Number.isInteger(yearsExperience) ||
    yearsExperience < 0 ||
    yearsExperience > 80
  ) {
    return response.status(400).json({
      message: 'Years of experience must be between 0 and 80.',
    })
  }
  if (
    preferredWorkplace &&
    !['remote', 'hybrid', 'on_site'].includes(preferredWorkplace)
  ) {
    return response.status(400).json({
      message: 'Preferred workplace must be remote, hybrid, or on-site.',
    })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const roleResult = await client.query(
      `
        SELECT roles.name
        FROM users
        JOIN roles ON roles.id = users.role_id
        WHERE users.id = $1
          AND users.deleted_at IS NULL
        LIMIT 1
      `,
      [Number(request.auth.sub)],
    )

    if (roleResult.rows[0]?.name !== 'candidate') {
      await client.query('ROLLBACK')
      return response.status(403).json({
        message: 'Candidate profile access required.',
      })
    }

    await client.query(
      'UPDATE users SET full_name = $1 WHERE id = $2',
      [fullName, Number(request.auth.sub)],
    )
    await client.query(
      `
        INSERT INTO candidate_profiles (
          user_id,
          phone,
          location,
          headline,
          bio,
          years_experience,
          linkedin_url,
          portfolio_url,
          desired_roles,
          preferred_workplace
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE SET
          phone = EXCLUDED.phone,
          location = EXCLUDED.location,
          headline = EXCLUDED.headline,
          bio = EXCLUDED.bio,
          years_experience = EXCLUDED.years_experience,
          linkedin_url = EXCLUDED.linkedin_url,
          portfolio_url = EXCLUDED.portfolio_url,
          desired_roles = EXCLUDED.desired_roles,
          preferred_workplace = EXCLUDED.preferred_workplace,
          deleted_at = NULL
      `,
      [
        Number(request.auth.sub),
        phone,
        location,
        headline,
        bio || null,
        yearsExperience,
        linkedinUrl,
        portfolioUrl,
        desiredRoles,
        preferredWorkplace,
      ],
    )

    const profileResult = await client.query(
      'SELECT id FROM candidate_profiles WHERE user_id = $1',
      [Number(request.auth.sub)],
    )
    const candidateProfileId = profileResult.rows[0].id
    await client.query(
      'DELETE FROM candidate_skills WHERE candidate_profile_id = $1',
      [candidateProfileId],
    )

    for (const skillName of skillNames) {
      const slug = skillName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 120)
      if (!slug) continue

      const skillResult = await client.query(
        `
          INSERT INTO skills (name, slug)
          VALUES ($1, $2)
          ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            deleted_at = NULL
          RETURNING id
        `,
        [skillName.slice(0, 100), slug],
      )
      await client.query(
        `
          INSERT INTO candidate_skills (candidate_profile_id, skill_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [candidateProfileId, skillResult.rows[0].id],
      )
    }

    await persistCompletion(client, Number(request.auth.sub), 'candidate')
    const user = await findPublicUser(client, Number(request.auth.sub))
    await client.query('COMMIT')
    return response.json({
      message: 'Profile saved.',
      user: publicUser(user),
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
  },
)

authRouter.post(
  '/profile/resume',
  requireAuth,
  requireRole('candidate'),
  resumeUploadRateLimit,
  resumeUpload.single('resume'),
  async (request, response, next) => {
    if (!request.file) {
      return response.status(400).json({
        message: 'Select a PDF, DOC, or DOCX resume.',
      })
    }

    const client = await pool.connect()
    let previousStoredFilename = null

    try {
      const fileBuffer = await fs.readFile(request.file.path)
      const isPdf =
        request.file.mimetype === 'application/pdf' &&
        fileBuffer.subarray(0, 4).toString() === '%PDF'
      const isDoc =
        request.file.mimetype === 'application/msword' &&
        fileBuffer.subarray(0, 8).equals(
          Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        )
      const isDocx =
        request.file.mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
        fileBuffer.subarray(0, 2).toString() === 'PK'

      if (!isPdf && !isDoc && !isDocx) {
        await fs.unlink(request.file.path).catch(() => {})
        return response.status(400).json({
          message: 'The uploaded resume content does not match its file type.',
        })
      }

      await client.query('BEGIN')
      const profileResult = await client.query(
        `
          SELECT candidate_profiles.id
          FROM candidate_profiles
          WHERE candidate_profiles.user_id = $1
            AND candidate_profiles.deleted_at IS NULL
          FOR UPDATE
        `,
        [Number(request.auth.sub)],
      )
      const candidateProfileId = profileResult.rows[0]?.id
      if (!candidateProfileId) {
        await client.query('ROLLBACK')
        await fs.unlink(request.file.path).catch(() => {})
        return response.status(404).json({
          message: 'Candidate profile not found.',
        })
      }

      const existingResult = await client.query(
        `
          SELECT stored_filename
          FROM candidate_resumes
          WHERE candidate_profile_id = $1
        `,
        [candidateProfileId],
      )
      previousStoredFilename = existingResult.rows[0]?.stored_filename ?? null
      const sha256 = createHash('sha256').update(fileBuffer).digest('hex')
      const { rows } = await client.query(
        `
          INSERT INTO candidate_resumes (
            candidate_profile_id,
            uploaded_by_user_id,
            original_filename,
            stored_filename,
            mime_type,
            file_size,
            sha256
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (candidate_profile_id) DO UPDATE SET
            uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
            original_filename = EXCLUDED.original_filename,
            stored_filename = EXCLUDED.stored_filename,
            mime_type = EXCLUDED.mime_type,
            file_size = EXCLUDED.file_size,
            sha256 = EXCLUDED.sha256
          RETURNING
            id,
            original_filename AS "resumeFilename",
            file_size AS "resumeFileSize",
            updated_at AS "resumeUpdatedAt"
        `,
        [
          candidateProfileId,
          Number(request.auth.sub),
          path.basename(request.file.originalname).slice(0, 255),
          request.file.filename,
          request.file.mimetype,
          request.file.size,
          sha256,
        ],
      )
      await client.query(
        'UPDATE candidate_profiles SET resume_url = NULL WHERE id = $1',
        [candidateProfileId],
      )
      await writeAuditLog(client, request, {
        action: 'candidate.resume_uploaded',
        entityType: 'candidate_resume',
        entityId: rows[0].id,
        newValues: {
          filename: rows[0].resumeFilename,
          fileSize: rows[0].resumeFileSize,
          sha256,
        },
      })
      const completion = await persistCompletion(
        client,
        Number(request.auth.sub),
        'candidate',
      )
      const user = await findPublicUser(client, Number(request.auth.sub))
      await client.query('COMMIT')

      if (previousStoredFilename) {
        await fs
          .unlink(
            path.join(
              resumeUploadDirectory,
              path.basename(previousStoredFilename),
            ),
          )
          .catch(() => {})
      }

      return response.status(201).json({
        message: 'Resume uploaded.',
        resume: rows[0],
        completion,
        user: publicUser(user),
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

authRouter.get(
  '/profile/resume',
  requireAuth,
  requireRole('candidate'),
  async (request, response, next) => {
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
          WHERE candidate_profiles.user_id = $1
            AND candidate_profiles.deleted_at IS NULL
          LIMIT 1
        `,
        [Number(request.auth.sub)],
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

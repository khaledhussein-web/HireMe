import bcrypt from 'bcryptjs'
import { Router } from 'express'
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_HASH_ROUNDS = 12

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
  const { rows } = await client.query(
    `
      SELECT
        users.id,
        users.full_name,
        users.email,
        users.email_verified_at,
        roles.name AS role,
        companies.verification_status AS employer_verification_status,
        (
          CASE
            WHEN roles.name = 'candidate' THEN
              candidate_profiles.phone IS NOT NULL
              AND candidate_profiles.location IS NOT NULL
              AND candidate_profiles.headline IS NOT NULL
            WHEN roles.name = 'employer' THEN
              companies.verification_status IN ('pending', 'approved')
            ELSE TRUE
          END
        ) AS profile_complete
      FROM users
      JOIN roles ON roles.id = users.role_id
      LEFT JOIN candidate_profiles
        ON candidate_profiles.user_id = users.id
        AND candidate_profiles.deleted_at IS NULL
      LEFT JOIN companies
        ON companies.owner_user_id = users.id
        AND companies.deleted_at IS NULL
      WHERE users.id = $1
        AND users.is_active = TRUE
        AND users.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )

  return rows[0] ?? null
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

  if (fullName.length < 2) {
    return response.status(400).json({ message: 'Enter your full name.' })
  }
  if (!EMAIL_PATTERN.test(email)) {
    return response.status(400).json({ message: 'Enter a valid email address.' })
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return response.status(400).json({
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS)
    const { rows } = await client.query(
      `
        INSERT INTO users (full_name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, email
      `,
      [fullName, email, passwordHash],
    )

    await client.query(
      'INSERT INTO candidate_profiles (user_id) VALUES ($1)',
      [rows[0].id],
    )
    const verificationToken = await createActionToken(
      client,
      'email_verification_tokens',
      rows[0].id,
      EMAIL_VERIFICATION_DURATION_MS,
    )

    await client.query('COMMIT')
    clearAuthCookies(response)
    return response.status(201).json({
      message: 'Account created. Verify your email before signing in.',
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

authRouter.post('/verify-email', async (request, response, next) => {
  const token = String(request.body.token ?? '')

  if (!token) {
    return response.status(400).json({ message: 'Verification token required.' })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        UPDATE email_verification_tokens
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
        message: 'This verification link is invalid or has expired.',
      })
    }

    await client.query(
      `
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, NOW())
        WHERE id = $1
      `,
      [rows[0].user_id],
    )
    await client.query('COMMIT')
    return response.json({ message: 'Email verified. You can now sign in.' })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

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
        SELECT id
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
          companies.verification_status AS employer_verification_status,
          users.is_active,
          (
            CASE
              WHEN roles.name = 'candidate' THEN
                candidate_profiles.phone IS NOT NULL
                AND candidate_profiles.location IS NOT NULL
                AND candidate_profiles.headline IS NOT NULL
              WHEN roles.name = 'employer' THEN
                companies.verification_status IN ('pending', 'approved')
              ELSE TRUE
            END
          ) AS profile_complete
        FROM users
        JOIN roles ON roles.id = users.role_id
        LEFT JOIN candidate_profiles
          ON candidate_profiles.user_id = users.id
          AND candidate_profiles.deleted_at IS NULL
        LEFT JOIN companies
          ON companies.owner_user_id = users.id
          AND companies.deleted_at IS NULL
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
    const refreshToken = await createRefreshSession(client, request, user.id)
    await client.query('COMMIT')

    setAuthCookies(response, user, refreshToken)
    return response.json({ user: publicUser(user) })
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
  if (password.length < PASSWORD_MIN_LENGTH) {
    return response.status(400).json({
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
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
          candidate_profiles.resume_url AS "resumeUrl"
        FROM users
        JOIN roles ON roles.id = users.role_id
        LEFT JOIN candidate_profiles
          ON candidate_profiles.user_id = users.id
          AND candidate_profiles.deleted_at IS NULL
        WHERE users.id = $1
          AND roles.name = 'candidate'
          AND users.deleted_at IS NULL
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
  const resumeUrl = String(request.body.resumeUrl ?? '').trim() || null

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
          resume_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id) DO UPDATE SET
          phone = EXCLUDED.phone,
          location = EXCLUDED.location,
          headline = EXCLUDED.headline,
          bio = EXCLUDED.bio,
          years_experience = EXCLUDED.years_experience,
          linkedin_url = EXCLUDED.linkedin_url,
          portfolio_url = EXCLUDED.portfolio_url,
          resume_url = EXCLUDED.resume_url,
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
        resumeUrl,
      ],
    )

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

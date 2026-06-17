import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../middleware/auth.js'

export const ACCESS_TOKEN_DURATION_MS = 15 * 60 * 1000
export const REFRESH_TOKEN_DURATION_MS = 30 * 24 * 60 * 60 * 1000
export const EMAIL_VERIFICATION_DURATION_MS = 24 * 60 * 60 * 1000
export const PASSWORD_RESET_DURATION_MS = 60 * 60 * 1000

export function publicUser(user) {
  const result = {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    emailVerified: Boolean(user.email_verified_at),
    accountStatus: user.account_status ?? 'active',
    profileExists: Boolean(user.profileExists ?? user.profile_exists),
    profileCompletionPercentage: Number(
      user.percentage ?? user.profile_completion_percentage ?? 0,
    ),
    completedItems: user.completedItems ?? user.completed_items ?? [],
    missingItems: user.missingItems ?? user.missing_items ?? [],
    onboardingCompleted: Boolean(
      user.onboardingCompleted ??
        user.onboarding_completed ??
        user.profile_complete,
    ),
    profileComplete: Boolean(
      user.onboardingCompleted ??
        user.onboarding_completed ??
        user.profile_complete,
    ),
    onboardingStep: Number(user.onboardingStep ?? user.onboarding_step ?? 1),
    nextRoute: user.next_route ?? '/',
  }

  if (['employer', 'tech_community'].includes(user.role)) {
    result.verificationStatus =
      user.verificationStatus ?? user.verification_status ?? 'draft'
  }
  if (user.role === 'employer') {
    result.employerVerificationStatus = result.verificationStatus
  }

  return result
}

export function createOpaqueToken() {
  return randomBytes(32).toString('hex')
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'lax',
    maxAge,
    path: '/',
  }
}

export function setAuthCookies(response, user, refreshToken) {
  const token = jwt.sign(
    {
      sub: String(user.id),
      role: user.role,
    },
    env.jwtSecret,
    { expiresIn: '15m' },
  )

  response.cookie(
    AUTH_COOKIE_NAME,
    token,
    cookieOptions(ACCESS_TOKEN_DURATION_MS),
  )
  response.cookie(
    REFRESH_COOKIE_NAME,
    refreshToken,
    cookieOptions(REFRESH_TOKEN_DURATION_MS),
  )
}

export function clearAuthCookies(response) {
  const options = {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'lax',
    path: '/',
  }

  response.clearCookie(AUTH_COOKIE_NAME, options)
  response.clearCookie(REFRESH_COOKIE_NAME, options)
}

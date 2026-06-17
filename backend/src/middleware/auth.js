import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { pool } from '../db/pool.js'

export const AUTH_COOKIE_NAME = 'hireme_session'
export const REFRESH_COOKIE_NAME = 'hireme_refresh'

export function requireAuth(request, response, next) {
  const token = request.cookies[AUTH_COOKIE_NAME]

  if (!token) {
    return response.status(401).json({ message: 'Authentication required.' })
  }

  try {
    request.auth = jwt.verify(token, env.jwtSecret)
    return next()
  } catch {
    return response.status(401).json({ message: 'Your session has expired.' })
  }
}

export function requireRole(...allowedRoles) {
  return async (request, response, next) => {
    try {
      const { rows } = await pool.query(
        `
          SELECT roles.name AS role
          FROM users
          JOIN roles ON roles.id = users.role_id
          WHERE users.id = $1
            AND users.is_active = TRUE
            AND users.account_status = 'active'
            AND users.email_verified_at IS NOT NULL
            AND users.deleted_at IS NULL
          LIMIT 1
        `,
        [Number(request.auth?.sub)],
      )
      const role = rows[0]?.role

      if (!role || !allowedRoles.includes(role)) {
        return response.status(403).json({ message: 'Insufficient permissions.' })
      }

      request.auth.role = role
      return next()
    } catch (error) {
      return next(error)
    }
  }
}

export function requirePermission(permission) {
  return async (request, response, next) => {
    try {
      const { rows } = await pool.query(
        `
          SELECT 1
          FROM users
          JOIN role_permissions ON role_permissions.role_id = users.role_id
          JOIN permissions ON permissions.id = role_permissions.permission_id
          WHERE users.id = $1
            AND users.is_active = TRUE
            AND users.account_status = 'active'
            AND users.email_verified_at IS NOT NULL
            AND users.deleted_at IS NULL
            AND permissions.code = $2
          LIMIT 1
        `,
        [Number(request.auth?.sub), permission],
      )

      if (!rows[0]) {
        return response.status(403).json({ message: 'Insufficient permissions.' })
      }

      return next()
    } catch (error) {
      return next(error)
    }
  }
}

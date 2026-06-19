import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../middleware/auth.js'

const EVENT_TYPES = [
  'registration_verified',
  'application_submitted',
  'application_status_changed',
  'candidate_shortlisted',
  'interview_scheduled',
  'interview_updated',
  'new_matching_job',
  'job_deadline_approaching',
  'employer_approved',
  'subscription_expiring',
]

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

notificationsRouter.get('/', async (request, response, next) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100)
  try {
    const { rows } = await pool.query(
      `
        SELECT id, notification_type AS "notificationType", title, body,
          related_entity_type AS "relatedEntityType",
          related_entity_id AS "relatedEntityId", action_url AS "actionUrl",
          read_at AS "readAt", created_at AS "createdAt"
        FROM notifications
        WHERE user_id = $1 AND in_app_visible = TRUE AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [Number(request.auth.sub), limit],
    )
    const countResult = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count FROM notifications
       WHERE user_id = $1 AND in_app_visible = TRUE
         AND read_at IS NULL AND deleted_at IS NULL`,
      [Number(request.auth.sub)],
    )
    return response.json({
      notifications: rows,
      unreadCount: countResult.rows[0]?.count ?? 0,
    })
  } catch (error) {
    return next(error)
  }
})

notificationsRouter.patch('/:notificationId/read', async (request, response, next) => {
  const notificationId = Number(request.params.notificationId)
  if (!Number.isInteger(notificationId) || notificationId < 1) {
    return response.status(400).json({ message: 'Invalid notification ID.' })
  }
  try {
    const result = await pool.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`,
      [notificationId, Number(request.auth.sub)],
    )
    if (!result.rows[0]) {
      return response.status(404).json({ message: 'Notification not found.' })
    }
    return response.json({ message: 'Notification marked as read.' })
  } catch (error) {
    return next(error)
  }
})

notificationsRouter.post('/read-all', async (request, response, next) => {
  try {
    await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL AND deleted_at IS NULL`,
      [Number(request.auth.sub)],
    )
    return response.json({ message: 'All notifications marked as read.' })
  } catch (error) {
    return next(error)
  }
})

notificationsRouter.get('/preferences', async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT in_app_enabled AS "inAppEnabled", email_enabled AS "emailEnabled",
          sms_enabled AS "smsEnabled", whatsapp_enabled AS "whatsappEnabled",
          phone_e164 AS "phoneE164", whatsapp_number AS "whatsappNumber",
          event_preferences AS "eventPreferences"
        FROM notification_preferences WHERE user_id = $1
      `,
      [Number(request.auth.sub)],
    )
    return response.json({
      preferences: rows[0] ?? {
        inAppEnabled: true,
        emailEnabled: true,
        smsEnabled: false,
        whatsappEnabled: false,
        phoneE164: null,
        whatsappNumber: null,
        eventPreferences: {},
      },
      eventTypes: EVENT_TYPES,
      futureChannels: ['sms', 'whatsapp'],
    })
  } catch (error) {
    return next(error)
  }
})

notificationsRouter.put('/preferences', async (request, response, next) => {
  const eventPreferences = {}
  for (const type of EVENT_TYPES) {
    if (typeof request.body.eventPreferences?.[type] === 'boolean') {
      eventPreferences[type] = request.body.eventPreferences[type]
    }
  }
  try {
    const { rows } = await pool.query(
      `
        INSERT INTO notification_preferences (
          user_id, in_app_enabled, email_enabled, event_preferences
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE SET
          in_app_enabled = EXCLUDED.in_app_enabled,
          email_enabled = EXCLUDED.email_enabled,
          event_preferences = EXCLUDED.event_preferences
        RETURNING in_app_enabled AS "inAppEnabled",
          email_enabled AS "emailEnabled", sms_enabled AS "smsEnabled",
          whatsapp_enabled AS "whatsappEnabled",
          event_preferences AS "eventPreferences"
      `,
      [
        Number(request.auth.sub),
        request.body.inAppEnabled !== false,
        request.body.emailEnabled !== false,
        eventPreferences,
      ],
    )
    return response.json({ message: 'Notification preferences saved.', preferences: rows[0] })
  } catch (error) {
    return next(error)
  }
})

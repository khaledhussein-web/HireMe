import { env } from '../config/env.js'
import { pool } from '../db/pool.js'
import { sendEmailMessage } from './email.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function absoluteUrl(actionUrl) {
  if (!actionUrl) return null
  return new URL(actionUrl, env.clientOrigin).toString()
}

async function getDeliverySettings(client, userId, notificationType) {
  const { rows } = await client.query(
    `
      SELECT
        users.email,
        users.full_name,
        COALESCE(notification_preferences.in_app_enabled, TRUE) AS in_app_enabled,
        COALESCE(notification_preferences.email_enabled, TRUE) AS email_enabled,
        COALESCE(
          (notification_preferences.event_preferences ->> $2)::BOOLEAN,
          TRUE
        ) AS event_enabled
      FROM users
      LEFT JOIN notification_preferences
        ON notification_preferences.user_id = users.id
      WHERE users.id = $1
        AND users.is_active = TRUE
        AND users.deleted_at IS NULL
      LIMIT 1
    `,
    [userId, notificationType],
  )
  return rows[0] ?? null
}

export async function notifyUser(client, notification) {
  const userId = Number(notification.userId)
  if (!Number.isInteger(userId) || userId < 1) return null

  const settings = await getDeliverySettings(
    client,
    userId,
    notification.type,
  )
  if (!settings?.event_enabled) return null
  if (!settings.in_app_enabled && !settings.email_enabled) return null

  const result = await client.query(
    `
      INSERT INTO notifications (
        user_id,
        notification_type,
        title,
        body,
        related_entity_type,
        related_entity_id,
        action_url,
        deduplication_key,
        in_app_visible,
        email_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id, deduplication_key)
        WHERE deduplication_key IS NOT NULL AND deleted_at IS NULL
      DO NOTHING
      RETURNING id
    `,
    [
      userId,
      notification.type,
      notification.title,
      notification.body ?? null,
      notification.entityType ?? null,
      notification.entityId ?? null,
      notification.actionUrl ?? null,
      notification.deduplicationKey ?? null,
      settings.in_app_enabled,
      settings.email_enabled ? 'pending' : 'skipped',
    ],
  )
  const notificationId = result.rows[0]?.id
  if (!notificationId || !settings.email_enabled) return notificationId ?? null

  let delivery
  try {
    const actionUrl = absoluteUrl(notification.actionUrl)
    const actionText = actionUrl ? `\n\nOpen HireMe: ${actionUrl}` : ''
    const actionHtml = actionUrl
      ? `<p><a href="${escapeHtml(actionUrl)}">Open in HireMe</a></p>`
      : ''
    delivery = await sendEmailMessage({
      to: settings.email,
      subject: notification.title,
      text: `Hello ${settings.full_name || 'there'},\n\n${notification.body || notification.title}${actionText}`,
      html: `<p>Hello ${escapeHtml(settings.full_name || 'there')},</p><p>${escapeHtml(notification.body || notification.title)}</p>${actionHtml}`,
    })
  } catch (error) {
    delivery = {
      delivered: false,
      failed: true,
      reason: String(error.message ?? error).slice(0, 2000),
    }
  }

  if (delivery.delivered) {
    await client.query(
      `UPDATE notifications
       SET email_status = 'sent', emailed_at = NOW(), email_error = NULL
       WHERE id = $1`,
      [notificationId],
    )
  } else {
    await client.query(
      `UPDATE notifications
       SET email_status = $1::VARCHAR, emailed_at = NULL, email_error = $2
       WHERE id = $3`,
      [delivery.failed ? 'failed' : 'skipped', delivery.reason ?? null, notificationId],
    )
  }

  return notificationId
}

export async function notifyMatchingCandidates(client, jobId) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT
        users.id AS user_id,
        jobs.title,
        jobs.slug,
        companies.name AS company_name
      FROM jobs
      JOIN companies ON companies.id = jobs.company_id
      JOIN candidate_profiles ON candidate_profiles.deleted_at IS NULL
      JOIN users ON users.id = candidate_profiles.user_id
      WHERE jobs.id = $1
        AND jobs.status = 'published'
        AND jobs.deleted_at IS NULL
        AND users.is_active = TRUE
        AND users.deleted_at IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM unnest(candidate_profiles.desired_roles) AS desired_role
            WHERE jobs.title ILIKE '%' || desired_role || '%'
          )
          OR EXISTS (
            SELECT 1
            FROM candidate_skills
            JOIN skills ON skills.id = candidate_skills.skill_id
            WHERE candidate_skills.candidate_profile_id = candidate_profiles.id
              AND CONCAT_WS(' ', jobs.title, jobs.description, jobs.requirements)
                ILIKE '%' || skills.name || '%'
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM applications
          WHERE applications.job_id = jobs.id
            AND applications.candidate_user_id = users.id
            AND applications.deleted_at IS NULL
        )
    `,
    [jobId],
  )

  for (const row of rows) {
    await notifyUser(client, {
      userId: row.user_id,
      type: 'new_matching_job',
      title: 'New matching job',
      body: `${row.title} at ${row.company_name} matches your profile.`,
      entityType: 'job',
      entityId: jobId,
      actionUrl: `/apply?job=${encodeURIComponent(row.slug)}`,
      deduplicationKey: `matching-job:${jobId}`,
    })
  }
  return rows.length
}

export async function runNotificationSweeps(client = pool) {
  const deadlineResult = await client.query(
    `
      SELECT jobs.id, jobs.title, jobs.slug, jobs.expires_at, companies.owner_user_id
      FROM jobs
      JOIN companies ON companies.id = jobs.company_id
      WHERE jobs.status = 'published'
        AND jobs.deleted_at IS NULL
        AND companies.owner_user_id IS NOT NULL
        AND jobs.expires_at > NOW()
        AND jobs.expires_at <= NOW() + INTERVAL '3 days'
    `,
  )
  for (const job of deadlineResult.rows) {
    await notifyUser(client, {
      userId: job.owner_user_id,
      type: 'job_deadline_approaching',
      title: 'Job deadline approaching',
      body: `${job.title} closes on ${new Date(job.expires_at).toLocaleDateString()}.`,
      entityType: 'job',
      entityId: job.id,
      actionUrl: '/employer/dashboard',
      deduplicationKey: `job-deadline:${job.id}:${new Date(job.expires_at).toISOString().slice(0, 10)}`,
    })
  }

  const candidateDeadlineResult = await client.query(
    `
      SELECT saved_jobs.user_id, jobs.id, jobs.title, jobs.slug, jobs.expires_at
      FROM saved_jobs
      JOIN jobs ON jobs.id = saved_jobs.job_id
      WHERE jobs.status = 'published'
        AND jobs.deleted_at IS NULL
        AND jobs.expires_at > NOW()
        AND jobs.expires_at <= NOW() + INTERVAL '3 days'
        AND NOT EXISTS (
          SELECT 1 FROM applications
          WHERE applications.job_id = jobs.id
            AND applications.candidate_user_id = saved_jobs.user_id
            AND applications.deleted_at IS NULL
        )
    `,
  )
  for (const job of candidateDeadlineResult.rows) {
    await notifyUser(client, {
      userId: job.user_id,
      type: 'job_deadline_approaching',
      title: 'Saved job deadline approaching',
      body: `${job.title} closes on ${new Date(job.expires_at).toLocaleDateString()}.`,
      entityType: 'job',
      entityId: job.id,
      actionUrl: `/apply?job=${encodeURIComponent(job.slug)}`,
      deduplicationKey: `job-deadline:${job.id}:${new Date(job.expires_at).toISOString().slice(0, 10)}`,
    })
  }

  const subscriptionResult = await client.query(
    `
      SELECT subscriptions.id, subscriptions.plan_name,
        subscriptions.current_period_ends_at, companies.owner_user_id
      FROM subscriptions
      JOIN companies ON companies.id = subscriptions.company_id
      WHERE subscriptions.status IN ('trial', 'active')
        AND subscriptions.deleted_at IS NULL
        AND subscriptions.current_period_ends_at > NOW()
        AND subscriptions.current_period_ends_at <= NOW() + INTERVAL '7 days'
        AND companies.owner_user_id IS NOT NULL
    `,
  )
  for (const subscription of subscriptionResult.rows) {
    await notifyUser(client, {
      userId: subscription.owner_user_id,
      type: 'subscription_expiring',
      title: 'Subscription expiring',
      body: `${subscription.plan_name} expires on ${new Date(subscription.current_period_ends_at).toLocaleDateString()}.`,
      entityType: 'subscription',
      entityId: subscription.id,
      actionUrl: '/employer/dashboard',
      deduplicationKey: `subscription-expiring:${subscription.id}:${new Date(subscription.current_period_ends_at).toISOString().slice(0, 10)}`,
    })
  }

  return {
    deadlineReminders: deadlineResult.rowCount,
    candidateDeadlineReminders: candidateDeadlineResult.rowCount,
    subscriptionReminders: subscriptionResult.rowCount,
  }
}

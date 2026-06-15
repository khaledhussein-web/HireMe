export function requestIp(request) {
  return request.ip || request.socket.remoteAddress || null
}

export function requestUserAgent(request) {
  return String(request.get('user-agent') ?? '').slice(0, 1000) || null
}

export async function writeAuditLog(
  client,
  request,
  {
    actorUserId = Number(request.auth?.sub) || null,
    action,
    entityType,
    entityId = null,
    oldValues = null,
    newValues = null,
  },
) {
  await client.query(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        ip_address,
        user_agent,
        request_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      actorUserId,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      oldValues,
      newValues,
      requestIp(request),
      requestUserAgent(request),
      request.get('x-request-id')?.slice(0, 100) || null,
    ],
  )
}

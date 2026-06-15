const buckets = new Map()
let limiterSequence = 0

function clientKey(request) {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

export function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 100,
  message = 'Too many requests. Please try again later.',
} = {}) {
  const limiterId = ++limiterSequence

  return (request, response, next) => {
    const now = Date.now()
    const key = `${limiterId}:${clientKey(request)}`
    const current = buckets.get(key)

    if (buckets.size > 10000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey)
      }
    }

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    current.count += 1
    response.set('RateLimit-Limit', String(max))
    response.set(
      'RateLimit-Reset',
      String(Math.ceil((current.resetAt - now) / 1000)),
    )

    if (current.count > max) {
      response.set(
        'Retry-After',
        String(Math.ceil((current.resetAt - now) / 1000)),
      )
      return response.status(429).json({ message })
    }

    return next()
  }
}

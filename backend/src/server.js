import { app } from './app.js'
import { env } from './config/env.js'
import { runNotificationSweeps } from './services/notifications.js'

const server = app.listen(env.port, () => {
  console.log(`HireMe API running at http://localhost:${env.port}/api`)
  runNotificationSweeps().catch((error) =>
    console.error('Notification sweep failed', error),
  )
})

const notificationSweep = setInterval(
  () => runNotificationSweeps().catch((error) =>
    console.error('Notification sweep failed', error),
  ),
  60 * 60 * 1000,
)
notificationSweep.unref()

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`)
  clearInterval(notificationSweep)
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

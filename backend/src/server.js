import { app } from './app.js'
import { env } from './config/env.js'

const server = app.listen(env.port, () => {
  console.log(`HireMe API running at http://localhost:${env.port}/api`)
})

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`)
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

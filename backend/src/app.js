import cors from 'cors'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import multer from 'multer'
import { env } from './config/env.js'
import { applicationsRouter } from './routes/applications.js'
import { adminRouter } from './routes/admin.js'
import { authRouter } from './routes/auth.js'
import { candidateRouter } from './routes/candidate.js'
import { employersRouter } from './routes/employers.js'
import { employerWorkspaceRouter } from './routes/employerWorkspace.js'
import { healthRouter } from './routes/health.js'
import { jobsRouter } from './routes/jobs.js'
import { onboardingRouter } from './routes/onboarding.js'
import { rateLimit } from './middleware/rateLimit.js'

export const app = express()

app.use(helmet())
app.use(cors({ origin: env.clientOrigin, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'))

app.get('/api', (_request, response) => {
  response.json({
    name: 'HireMe API',
    version: '1.0.0',
  })
})

app.use('/api/health', healthRouter)
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many authentication requests. Try again later.',
  }),
  authRouter,
)
app.use('/api/employers', employersRouter)
app.use('/api/candidate', candidateRouter)
app.use('/api/employer-workspace', employerWorkspaceRouter)
app.use('/api/admin', adminRouter)
app.use('/api/applications', applicationsRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/onboarding', onboardingRouter)

app.use((_request, response) => {
  response.status(404).json({ message: 'Route not found' })
})

app.use((error, _request, response, _next) => {
  console.error(error)

  if (error instanceof multer.MulterError) {
    return response.status(400).json({
      message:
        error.code === 'LIMIT_FILE_SIZE'
          ? error.field === 'resume'
            ? 'Resume must be 5 MB or smaller.'
            : 'Document must be 5 MB or smaller.'
          : error.message,
    })
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return response.status(400).json({ message: 'Invalid JSON request body.' })
  }

  response.status(500).json({ message: 'Internal server error' })
})

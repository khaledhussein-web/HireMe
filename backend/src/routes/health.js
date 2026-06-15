import { Router } from 'express'
import { pool } from '../db/pool.js'

export const healthRouter = Router()

healthRouter.get('/', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    })
  } catch {
    response.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    })
  }
})

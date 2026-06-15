import 'dotenv/config'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required. Copy backend/.env.example to backend/.env and configure PostgreSQL.',
  )
}

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in backend/.env.')
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  authCookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID ?? '',
      teamId: process.env.APPLE_TEAM_ID ?? '',
      keyId: process.env.APPLE_KEY_ID ?? '',
      privateKey: process.env.APPLE_PRIVATE_KEY ?? '',
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
      tenant: process.env.MICROSOFT_TENANT ?? 'common',
    },
  },
}

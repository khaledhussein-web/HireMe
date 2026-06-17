import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { app } from '../src/app.js'
import { pool } from '../src/db/pool.js'

let server
let baseUrl
const createdEmails = []

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  for (const email of createdEmails) {
    const result = await pool.query('SELECT id FROM users WHERE email = $1', [
      email,
    ])
    const userId = result.rows[0]?.id
    if (!userId) continue
    await pool.query('DELETE FROM profile_assets WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM candidate_profiles WHERE user_id = $1', [
      userId,
    ])
    await pool.query('DELETE FROM companies WHERE owner_user_id = $1', [userId])
    await pool.query(
      'DELETE FROM community_profiles WHERE owner_user_id = $1',
      [userId],
    )
    await pool.query('DELETE FROM users WHERE id = $1', [userId])
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await pool.end()
})

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const data = await response.json()
  return { response, data }
}

test('registration validates role, password, and password confirmation', async () => {
  const common = {
    fullName: 'Validation Test',
    email: `validation-${Date.now()}@example.com`,
  }
  const invalidRole = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      ...common,
      password: 'StrongPass123',
      confirmPassword: 'StrongPass123',
      role: 'admin',
    }),
  })
  assert.equal(invalidRole.response.status, 400)

  const weakPassword = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      ...common,
      password: 'password',
      confirmPassword: 'password',
      role: 'candidate',
    }),
  })
  assert.equal(weakPassword.response.status, 400)

  const mismatch = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      ...common,
      password: 'StrongPass123',
      confirmPassword: 'StrongPass124',
      role: 'candidate',
    }),
  })
  assert.equal(mismatch.response.status, 400)
})

test('candidate verifies, auto-signs in, and saves partial onboarding', async () => {
  const email = `flow-${Date.now()}@example.com`
  createdEmails.push(email)
  const registration = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Integration Candidate',
      email,
      password: 'StrongPass123',
      confirmPassword: 'StrongPass123',
      role: 'candidate',
    }),
  })
  assert.equal(registration.response.status, 201)
  assert.match(registration.data.developmentActionUrl, /verify-email/)

  const duplicate = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Integration Candidate',
      email,
      password: 'StrongPass123',
      confirmPassword: 'StrongPass123',
      role: 'candidate',
    }),
  })
  assert.equal(duplicate.response.status, 409)

  const token = new URL(registration.data.developmentActionUrl).searchParams.get(
    'token',
  )
  const verification = await request(
    `/auth/verify-email?token=${encodeURIComponent(token)}`,
  )
  assert.equal(verification.response.status, 200)
  assert.equal(verification.data.user.emailVerified, true)
  assert.equal(verification.data.redirectTo, '/onboarding/candidate')

  const cookie = verification.response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const onboarding = await request('/onboarding/candidate', {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({
      phone: '+96170000000',
      country: 'Lebanon',
      city: 'Beirut',
      headline: 'Junior developer',
      bio: 'Candidate profile created by the integration test.',
      onboardingStep: 2,
    }),
  })
  assert.equal(onboarding.response.status, 200)
  assert.equal(onboarding.data.user.role, 'candidate')
  assert.ok(onboarding.data.completion.percentage > 0)
  assert.ok(onboarding.data.completion.missingItems.includes('cv'))

  const reused = await request(
    `/auth/verify-email?token=${encodeURIComponent(token)}`,
  )
  assert.equal(reused.response.status, 409)
})

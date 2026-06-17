export class AuthRequestError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'AuthRequestError'
    this.status = status
    this.code = code
  }
}

async function authRequest(path, options = {}) {
  let response
  const headers = { ...options.headers }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  try {
    response = await fetch(`/api/auth${path}`, {
      credentials: 'include',
      ...options,
      headers,
    })
  } catch {
    throw new Error(
      'Unable to reach the authentication server. Check that npm run dev is running.',
    )
  }

  const responseText = response.status === 204 ? '' : await response.text()
  let data = null

  if (responseText) {
    try {
      data = JSON.parse(responseText)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const isUnavailableProxyResponse =
      !data && [502, 503, 504].includes(response.status)

    throw new AuthRequestError(
      isUnavailableProxyResponse
        ? 'Authentication server is unavailable. Start the app from the project root with npm run dev.'
        : data?.message ??
            `Authentication request failed (${response.status}). Please try again.`,
      response.status,
      data?.code,
    )
  }

  if (response.status !== 204 && !data) {
    throw new Error(
      'The authentication server returned an invalid response. Please restart the development server.',
    )
  }

  return data
}

export function login(credentials) {
  return authRequest('/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export function getCurrentUser() {
  return authRequest('/me')
}

export function refreshSession() {
  return authRequest('/refresh', { method: 'POST' })
}

export function logout() {
  return authRequest('/logout', { method: 'POST' })
}

export function register(account) {
  return authRequest('/register', {
    method: 'POST',
    body: JSON.stringify(account),
  })
}

export function verifyEmail(token) {
  return authRequest(`/verify-email?token=${encodeURIComponent(token)}`)
}

export function resendVerification(email) {
  return authRequest('/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function forgotPassword(email) {
  return authRequest('/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(token, password) {
  return authRequest('/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}

export function getCandidateProfile() {
  return authRequest('/profile')
}

export function updateCandidateProfile(profile) {
  return authRequest('/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function uploadCandidateResume(resume) {
  const form = new FormData()
  form.append('resume', resume)

  return authRequest('/profile/resume', {
    method: 'POST',
    body: form,
  })
}

export function startSocialLogin(provider) {
  return authRequest(`/oauth/${provider}`)
}

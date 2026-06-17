import { PlatformRequestError } from './platform.js'

async function onboardingRequest(path, options = {}) {
  const headers = { ...options.headers }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  let response
  try {
    response = await fetch(`/api/onboarding${path}`, {
      credentials: 'include',
      ...options,
      headers,
    })
  } catch {
    throw new PlatformRequestError(
      'The application server is unavailable. Start the app with npm run dev.',
      0,
    )
  }

  const text = response.status === 204 ? '' : await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    throw new PlatformRequestError(
      data?.message ?? `Request failed (${response.status}).`,
      response.status,
    )
  }
  return data
}

export function getCandidateOnboarding() {
  return onboardingRequest('/candidate')
}

export function saveCandidateOnboarding(profile) {
  return onboardingRequest('/candidate', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function getEmployerOnboarding() {
  return onboardingRequest('/employer')
}

export function saveEmployerOnboarding(profile) {
  return onboardingRequest('/employer', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function getCommunityOnboarding() {
  return onboardingRequest('/community')
}

export function saveCommunityOnboarding(profile) {
  return onboardingRequest('/community', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function uploadProfileImage(role, image) {
  const form = new FormData()
  form.append('image', image)
  const path =
    role === 'candidate'
      ? '/candidate/photo'
      : role === 'employer'
        ? '/employer/logo'
        : '/community/logo'

  return onboardingRequest(path, {
    method: 'POST',
    body: form,
  })
}

export function getProfileAssetUrl(assetId) {
  return `/api/onboarding/assets/${assetId}`
}

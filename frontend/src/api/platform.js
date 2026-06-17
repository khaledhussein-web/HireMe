export class PlatformRequestError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'PlatformRequestError'
    this.status = status
  }
}

async function platformRequest(path, options = {}) {
  const headers = { ...options.headers }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  let response
  try {
    response = await fetch(path, {
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
    const isUnavailableProxyResponse =
      !data && [502, 503, 504].includes(response.status)

    throw new PlatformRequestError(
      isUnavailableProxyResponse
        ? 'The application server is unavailable. Start the app with npm run dev.'
        : data?.message ?? `Request failed (${response.status}).`,
      response.status,
    )
  }

  return data
}

function queryString(params = {}) {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    searchParams.set(key, value)
  })

  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

export function getJobs(filters = {}) {
  return platformRequest(`/api/jobs${queryString(filters)}`)
}

export function getJob(slug) {
  return platformRequest(`/api/jobs/${encodeURIComponent(slug)}`)
}

export function getRecommendations() {
  return platformRequest('/api/jobs/recommendations')
}

export function submitApplication(application) {
  return platformRequest('/api/applications', {
    method: 'POST',
    body: JSON.stringify(application),
  })
}

export function getApplications() {
  return platformRequest('/api/applications')
}

export function getInterviewPreparation(applicationId) {
  return platformRequest(
    `/api/applications/${applicationId}/interview-prep`,
  )
}

export function getCandidateDashboard() {
  return platformRequest('/api/candidate/dashboard')
}

export function getCandidatePlatformProfile() {
  return platformRequest('/api/candidate/profile')
}

export function saveCandidatePlatformProfile(profile) {
  return platformRequest('/api/candidate/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export function getSavedJobs() {
  return platformRequest('/api/candidate/saved-jobs')
}

export function saveJob(jobId) {
  return platformRequest(`/api/candidate/saved-jobs/${jobId}`, {
    method: 'POST',
  })
}

export function removeSavedJob(jobId) {
  return platformRequest(`/api/candidate/saved-jobs/${jobId}`, {
    method: 'DELETE',
  })
}

export function getApplicationHistory(applicationId) {
  return platformRequest(
    `/api/candidate/applications/${applicationId}/history`,
  )
}

export function withdrawApplication(applicationId, reason) {
  return platformRequest(
    `/api/candidate/applications/${applicationId}/withdraw`,
    {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    },
  )
}

export function markNotificationRead(notificationId) {
  return platformRequest(
    `/api/candidate/notifications/${notificationId}/read`,
    {
      method: 'PATCH',
    },
  )
}

export function getEmployerJobs() {
  return platformRequest('/api/employer-workspace/jobs')
}

export function createEmployerJob(job) {
  return platformRequest('/api/employer-workspace/jobs', {
    method: 'POST',
    body: JSON.stringify(job),
  })
}

export function updateEmployerJob(jobId, job) {
  return platformRequest(`/api/employer-workspace/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify(job),
  })
}

export function updateEmployerJobStatus(jobId, status) {
  return platformRequest(`/api/employer-workspace/jobs/${jobId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function duplicateEmployerJob(jobId) {
  return platformRequest(`/api/employer-workspace/jobs/${jobId}/duplicate`, {
    method: 'POST',
  })
}

export function featureEmployerJob(jobId, days = 30) {
  return platformRequest(`/api/employer-workspace/jobs/${jobId}/feature`, {
    method: 'POST',
    body: JSON.stringify({ days }),
  })
}

export function deleteEmployerJob(jobId) {
  return platformRequest(`/api/employer-workspace/jobs/${jobId}`, {
    method: 'DELETE',
  })
}

export function getEmployerDashboard() {
  return platformRequest('/api/employer-workspace/dashboard')
}

export function updateApplicationStatus(applicationId, status) {
  return platformRequest(
    `/api/employer-workspace/applications/${applicationId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  )
}

export function saveCandidateEvaluation(applicationId, evaluation) {
  return platformRequest(
    `/api/employer-workspace/applications/${applicationId}/evaluation`,
    {
      method: 'PATCH',
      body: JSON.stringify(evaluation),
    },
  )
}

export function scheduleApplicationInterview(applicationId, interview) {
  return platformRequest(
    `/api/employer-workspace/applications/${applicationId}/interviews`,
    {
      method: 'POST',
      body: JSON.stringify(interview),
    },
  )
}

export function getCandidatePool(query = '') {
  return platformRequest(
    `/api/employer-workspace/candidate-pool?query=${encodeURIComponent(query)}`,
  )
}

export function compareCandidates(candidateIds) {
  return platformRequest('/api/employer-workspace/candidate-comparison', {
    method: 'POST',
    body: JSON.stringify({ candidateIds }),
  })
}

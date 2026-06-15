export class ApiRequestError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

async function apiRequest(path, options = {}) {
  const headers = { ...options.headers }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  })
  const text = response.status === 204 ? '' : await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new ApiRequestError(
      data?.message ?? `Request failed (${response.status}).`,
      response.status,
    )
  }

  return data
}

export function registerEmployer(account) {
  return apiRequest('/api/employers/register', {
    method: 'POST',
    body: JSON.stringify(account),
  })
}

export function getEmployerCompany() {
  return apiRequest('/api/employers/company')
}

export function saveEmployerCompany(company) {
  return apiRequest('/api/employers/company', {
    method: 'PUT',
    body: JSON.stringify(company),
  })
}

export function uploadCompanyDocument(documentType, document) {
  const form = new FormData()
  form.append('documentType', documentType)
  form.append('document', document)

  return apiRequest('/api/employers/company/documents', {
    method: 'POST',
    body: form,
  })
}

export function getEmployerNotifications() {
  return apiRequest('/api/employers/notifications')
}

export function getPendingEmployerVerifications() {
  return apiRequest('/api/admin/employer-verifications?status=pending')
}

export function getEmployerVerification(companyId) {
  return apiRequest(`/api/admin/employer-verifications/${companyId}`)
}

export function reviewEmployerCompany(companyId, decision, reason = '') {
  return apiRequest(
    `/api/admin/employer-verifications/${companyId}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    },
  )
}

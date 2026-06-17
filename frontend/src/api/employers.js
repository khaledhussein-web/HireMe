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

function queryString(params = {}) {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    searchParams.set(key, value)
  })

  const query = searchParams.toString()
  return query ? `?${query}` : ''
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

export function getCandidateResumes() {
  return apiRequest('/api/admin/candidate-resumes')
}

export function getAdminDashboard() {
  return apiRequest('/api/admin/dashboard')
}

export function getAdminUsers(filters = {}) {
  return apiRequest(`/api/admin/users${queryString(filters)}`)
}

export function updateAdminUserStatus(userId, status, reason = '') {
  return apiRequest(`/api/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  })
}

export function getAdminJobs(filters = {}) {
  return apiRequest(`/api/admin/jobs${queryString(filters)}`)
}

export function moderateAdminJob(jobId, action, reason = '') {
  return apiRequest(`/api/admin/jobs/${jobId}/moderation`, {
    method: 'PATCH',
    body: JSON.stringify({ action, reason }),
  })
}

export function getAdminReports(filters = {}) {
  return apiRequest(`/api/admin/reports${queryString(filters)}`)
}

export function createAdminReport(report) {
  return apiRequest('/api/admin/reports', {
    method: 'POST',
    body: JSON.stringify(report),
  })
}

export function updateAdminReport(reportId, status, resolutionNotes = '') {
  return apiRequest(`/api/admin/reports/${reportId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, resolutionNotes }),
  })
}

export function getRolesPermissions() {
  return apiRequest('/api/admin/roles-permissions')
}

export function updateRolePermission(roleId, permissionCode, grant) {
  return apiRequest(`/api/admin/roles/${roleId}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ permissionCode, grant }),
  })
}

export function getAdminBilling() {
  return apiRequest('/api/admin/billing')
}

export function getAdminAnalytics() {
  return apiRequest('/api/admin/analytics')
}

export function getAdminCategories(filters = {}) {
  return apiRequest(`/api/admin/categories${queryString(filters)}`)
}

export function saveAdminCategory(category) {
  return apiRequest('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify(category),
  })
}

export function updateAdminCategory(categoryId, isActive) {
  return apiRequest(`/api/admin/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  })
}

export function getAuditLogs() {
  return apiRequest('/api/admin/audit-logs')
}

export function getPendingCommunityVerifications() {
  return apiRequest('/api/admin/community-verifications?status=pending')
}

export function reviewCommunity(communityId, decision, reason = '') {
  return apiRequest(
    `/api/admin/community-verifications/${communityId}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    },
  )
}

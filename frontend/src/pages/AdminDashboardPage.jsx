import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createAdminReport,
  getAdminAnalytics,
  getAdminBilling,
  getAdminCategories,
  getAdminDashboard,
  getAdminJobs,
  getAdminReports,
  getAdminUsers,
  getAuditLogs,
  getRolesPermissions,
  moderateAdminJob,
  saveAdminCategory,
  updateAdminCategory,
  updateAdminReport,
  updateAdminUserStatus,
  updateRolePermission,
} from '../api/employers.js'

const tabs = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['jobs', 'Jobs'],
  ['reports', 'Reports'],
  ['roles', 'Roles'],
  ['billing', 'Billing'],
  ['analytics', 'Analytics'],
  ['categories', 'Categories'],
  ['audit', 'Audit log'],
]

const emptyReport = {
  entityType: 'job',
  entityId: '',
  reason: '',
  details: '',
}

const emptyCategory = {
  categoryType: 'industry',
  name: '',
}

function fetchAdminData({ userFilters, jobFilters, reportFilter, categoryFilter }) {
  return Promise.allSettled([
    getAdminDashboard(),
    getAdminUsers(userFilters),
    getAdminJobs(jobFilters),
    getAdminReports({ status: reportFilter }),
    getRolesPermissions(),
    getAdminBilling(),
    getAdminAnalytics(),
    getAdminCategories({ type: categoryFilter }),
    getAuditLogs(),
  ])
}

function label(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function formatDate(value) {
  if (!value) return 'Not available'
  return new Date(value).toLocaleString()
}

function formatMoney(cents = 0, currency = 'USD') {
  return new Intl.NumberFormat(undefined, {
    currency,
    style: 'currency',
  }).format(Number(cents || 0) / 100)
}

function statusClass(status) {
  return `status-badge ${String(status ?? '').toLowerCase()}`
}

function MiniChart({ title, rows, labelKey = 'status' }) {
  const max = Math.max(...rows.map((row) => Number(row.count || 0)), 1)

  return (
    <div className="admin-module">
      <div>
        <h2>{title}</h2>
      </div>
      <div className="admin-bars">
        {rows.map((row) => (
          <div className="admin-bar-row" key={`${title}-${row[labelKey]}`}>
            <span>{label(row[labelKey])}</span>
            <div>
              <i style={{ width: `${(Number(row.count || 0) / max) * 100}%` }} />
            </div>
            <strong>{row.count}</strong>
          </div>
        ))}
        {rows.length === 0 && <p className="empty-state compact">No data yet.</p>}
      </div>
    </div>
  )
}

export function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [stats, setStats] = useState({})
  const [users, setUsers] = useState([])
  const [jobs, setJobs] = useState([])
  const [reports, setReports] = useState([])
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [billing, setBilling] = useState({ subscriptions: [], payments: [] })
  const [analytics, setAnalytics] = useState({
    usersByRole: [],
    jobsByStatus: [],
    applicationsByStatus: [],
    billing: {},
  })
  const [categories, setCategories] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [userFilters, setUserFilters] = useState({ role: '', status: '', query: '' })
  const [jobFilters, setJobFilters] = useState({ status: '', query: '' })
  const [reportFilter, setReportFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [userReason, setUserReason] = useState('')
  const [jobReason, setJobReason] = useState('')
  const [reportNotes, setReportNotes] = useState({})
  const [newReport, setNewReport] = useState(emptyReport)
  const [permissionForm, setPermissionForm] = useState({
    roleId: '',
    permissionCode: '',
    grant: true,
  })
  const [categoryForm, setCategoryForm] = useState(emptyCategory)
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function applyAdminData(results) {
    const [
      dashboardResult,
      userResult,
      jobResult,
      reportResult,
      roleResult,
      billingResult,
      analyticsResult,
      categoryResult,
      auditResult,
    ] = results

    if (dashboardResult.status === 'fulfilled') setStats(dashboardResult.value.stats)
    if (userResult.status === 'fulfilled') setUsers(userResult.value.users)
    if (jobResult.status === 'fulfilled') setJobs(jobResult.value.jobs)
    if (reportResult.status === 'fulfilled') setReports(reportResult.value.reports)
    if (roleResult.status === 'fulfilled') {
      setRoles(roleResult.value.roles)
      setPermissions(roleResult.value.permissions)
    }
    if (billingResult.status === 'fulfilled') setBilling(billingResult.value)
    if (analyticsResult.status === 'fulfilled') setAnalytics(analyticsResult.value)
    if (categoryResult.status === 'fulfilled') {
      setCategories(categoryResult.value.categories)
    }
    if (auditResult.status === 'fulfilled') setAuditLogs(auditResult.value.auditLogs)

    const failure = [
      dashboardResult,
      userResult,
      jobResult,
      reportResult,
      roleResult,
      billingResult,
      analyticsResult,
      categoryResult,
      auditResult,
    ].find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  async function loadAdminData() {
    const results = await fetchAdminData({
      categoryFilter,
      jobFilters,
      reportFilter,
      userFilters,
    })
    applyAdminData(results)
  }

  useEffect(() => {
    let isActive = true

    fetchAdminData({
      categoryFilter: '',
      jobFilters: { status: '', query: '' },
      reportFilter: '',
      userFilters: { role: '', status: '', query: '' },
    })
      .then((results) => {
        if (!isActive) return
        applyAdminData(results)
      })
      .catch((error) => {
        if (isActive) setMessage({ type: 'error', text: error.message })
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  const roleOptions = useMemo(
    () => roles.map((role) => role.name).filter(Boolean),
    [roles],
  )

  async function refreshWithNotice(text) {
    await loadAdminData()
    setMessage({ type: 'success', text })
  }

  async function runAction(action) {
    setIsSubmitting(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  function updateReportNote(reportId, value) {
    setReportNotes((current) => ({ ...current, [reportId]: value }))
  }

  return (
    <main className="workspace-page admin-page">
      <section className="workspace-shell admin-shell">
        <div className="workspace-heading admin-heading">
          <div>
            <p className="section-kicker">Administration</p>
            <h1>Platform control center</h1>
            <p>
              Manage users, verified employers, job quality, reports, payments,
              analytics, taxonomy and audit history from one place.
            </p>
          </div>
          <Link className="btn-secondary" to="/admin/verifications">
            Review companies
          </Link>
        </div>

        {message && <div className={`auth-message ${message.type}`}>{message.text}</div>}
        {isLoading && <div className="empty-state compact">Loading admin modules...</div>}

        <div className="workspace-tabs admin-tabs">
          {tabs.map(([id, name]) => (
            <button
              className={activeTab === id ? 'active' : ''}
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
            >
              {name}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="admin-stack">
            <div className="stat-grid admin-stat-grid">
              <div>
                <strong>{stats.userCount ?? 0}</strong>
                <span>Total users</span>
              </div>
              <div>
                <strong>{stats.unverifiedCount ?? 0}</strong>
                <span>Unverified accounts</span>
              </div>
              <div>
                <strong>{stats.openReports ?? 0}</strong>
                <span>Open reports</span>
              </div>
              <div>
                <strong>{stats.publishedJobs ?? 0}</strong>
                <span>Published jobs</span>
              </div>
              <div>
                <strong>{stats.pendingCompanies ?? 0}</strong>
                <span>Company approvals</span>
              </div>
              <div>
                <strong>{stats.suspendedCount ?? 0}</strong>
                <span>Suspended users</span>
              </div>
              <div>
                <strong>{formatMoney(stats.paidAmountCents)}</strong>
                <span>Paid revenue</span>
              </div>
              <div>
                <strong>{stats.pendingPayments ?? 0}</strong>
                <span>Pending payments</span>
              </div>
            </div>

            <div className="admin-grid two">
              <div className="admin-module">
                <div className="admin-module-head">
                  <div>
                    <h2>Moderation queue</h2>
                    <p>Companies, reports and suspicious jobs needing attention.</p>
                  </div>
                  <Link to="/admin/verifications">Open verification queue</Link>
                </div>
                <div className="admin-list">
                  <span>{stats.pendingCompanies ?? 0} pending companies</span>
                  <span>{stats.pendingCommunities ?? 0} pending communities</span>
                  <span>{stats.openReports ?? 0} unresolved reports</span>
                  <span>{stats.draftJobs ?? 0} draft jobs</span>
                  <span>{stats.closedJobs ?? 0} closed jobs</span>
                </div>
              </div>
              <div className="admin-module">
                <div className="admin-module-head">
                  <div>
                    <h2>Recent audit events</h2>
                    <p>Latest administrative changes recorded by the platform.</p>
                  </div>
                  <button type="button" onClick={() => setActiveTab('audit')}>
                    View all
                  </button>
                </div>
                <div className="admin-feed">
                  {auditLogs.slice(0, 6).map((log) => (
                    <article key={log.id}>
                      <strong>{label(log.action)}</strong>
                      <span>{log.actorName || log.actorEmail || 'System'}</span>
                      <time>{formatDate(log.createdAt)}</time>
                    </article>
                  ))}
                  {auditLogs.length === 0 && (
                    <p className="empty-state compact">No audit entries yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="admin-stack">
            <div className="admin-toolbar">
              <input
                placeholder="Search name or email"
                value={userFilters.query}
                onChange={(event) =>
                  setUserFilters((current) => ({
                    ...current,
                    query: event.target.value,
                  }))
                }
              />
              <select
                value={userFilters.role}
                onChange={(event) =>
                  setUserFilters((current) => ({ ...current, role: event.target.value }))
                }
              >
                <option value="">All roles</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {label(role)}
                  </option>
                ))}
              </select>
              <select
                value={userFilters.status}
                onChange={(event) =>
                  setUserFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              <button type="button" onClick={() => runAction(() => refreshWithNotice('Users refreshed.'))}>
                Filter
              </button>
            </div>
            <textarea
              className="admin-note"
              placeholder="Reason required when suspending fraudulent users"
              value={userReason}
              onChange={(event) => setUserReason(event.target.value)}
            />
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Last login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.fullName}</strong>
                        <span>{user.email}</span>
                      </td>
                      <td>{label(user.role)}</td>
                      <td><span className={statusClass(user.accountStatus)}>{label(user.accountStatus)}</span></td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>{formatDate(user.lastLoginAt)}</td>
                      <td>
                        <div className="admin-actions">
                          <button
                            disabled={isSubmitting || user.accountStatus === 'suspended'}
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await updateAdminUserStatus(user.id, 'suspended', userReason)
                                setUserReason('')
                                await refreshWithNotice('User suspended.')
                              })
                            }
                          >
                            Suspend
                          </button>
                          <button
                            disabled={isSubmitting || user.accountStatus === 'active'}
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await updateAdminUserStatus(user.id, 'active')
                                await refreshWithNotice('User restored.')
                              })
                            }
                          >
                            Restore
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="admin-stack">
            <div className="admin-toolbar">
              <input
                placeholder="Search job or company"
                value={jobFilters.query}
                onChange={(event) =>
                  setJobFilters((current) => ({
                    ...current,
                    query: event.target.value,
                  }))
                }
              />
              <select
                value={jobFilters.status}
                onChange={(event) =>
                  setJobFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option value="">All job statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="paused">Paused</option>
                <option value="closed">Closed</option>
                <option value="archived">Archived</option>
              </select>
              <button type="button" onClick={() => runAction(() => refreshWithNotice('Jobs refreshed.'))}>
                Filter
              </button>
            </div>
            <textarea
              className="admin-note"
              placeholder="Reason required for removing or archiving scam, duplicate or low-quality posts"
              value={jobReason}
              onChange={(event) => setJobReason(event.target.value)}
            />
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Applications</th>
                    <th>Published</th>
                    <th>Moderation</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <strong>{job.title}</strong>
                        <span>{label(job.employmentType)} · {label(job.workplaceType)}</span>
                      </td>
                      <td>
                        <strong>{job.company}</strong>
                        <span>{label(job.companyVerificationStatus)}</span>
                      </td>
                      <td><span className={statusClass(job.status)}>{label(job.status)}</span></td>
                      <td>{job.applicationCount}</td>
                      <td>{formatDate(job.publishedAt)}</td>
                      <td>
                        <div className="admin-actions">
                          {['archive', 'remove', 'restore', job.featured ? 'unfeature' : 'feature'].map((action) => (
                            <button
                              disabled={isSubmitting}
                              key={action}
                              type="button"
                              onClick={() =>
                                runAction(async () => {
                                  await moderateAdminJob(job.id, action, jobReason)
                                  if (['archive', 'remove'].includes(action)) {
                                    setJobReason('')
                                  }
                                  await refreshWithNotice('Job moderation updated.')
                                })
                              }
                            >
                              {label(action)}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="admin-grid two">
            <div className="admin-module">
              <div className="admin-module-head">
                <div>
                  <h2>Reported content</h2>
                  <p>Review reported companies, users, jobs and applications.</p>
                </div>
                <select
                  value={reportFilter}
                  onChange={(event) => setReportFilter(event.target.value)}
                >
                  <option value="">All reports</option>
                  <option value="open">Open</option>
                  <option value="reviewing">Reviewing</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>
              <button type="button" onClick={() => runAction(() => refreshWithNotice('Reports refreshed.'))}>
                Filter reports
              </button>
              <div className="admin-report-list">
                {reports.map((report) => (
                  <article key={report.id}>
                    <div>
                      <strong>{label(report.entityType)} #{report.entityId ?? 'n/a'}</strong>
                      <span className={statusClass(report.status)}>{label(report.status)}</span>
                    </div>
                    <p>{report.reason}</p>
                    {report.details && <small>{report.details}</small>}
                    <textarea
                      placeholder="Resolution notes"
                      value={reportNotes[report.id] ?? report.resolutionNotes ?? ''}
                      onChange={(event) => updateReportNote(report.id, event.target.value)}
                    />
                    <div className="admin-actions">
                      {['reviewing', 'resolved', 'dismissed'].map((status) => (
                        <button
                          disabled={isSubmitting}
                          key={status}
                          type="button"
                          onClick={() =>
                            runAction(async () => {
                              await updateAdminReport(
                                report.id,
                                status,
                                reportNotes[report.id] ?? '',
                              )
                              await refreshWithNotice('Report updated.')
                            })
                          }
                        >
                          {label(status)}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <form
              className="admin-module admin-form"
              onSubmit={(event) => {
                event.preventDefault()
                runAction(async () => {
                  await createAdminReport(newReport)
                  setNewReport(emptyReport)
                  await refreshWithNotice('Report created.')
                })
              }}
            >
              <h2>Create report</h2>
              <select
                value={newReport.entityType}
                onChange={(event) =>
                  setNewReport((current) => ({
                    ...current,
                    entityType: event.target.value,
                  }))
                }
              >
                <option value="job">Job</option>
                <option value="company">Company</option>
                <option value="candidate">Candidate</option>
                <option value="community">Community</option>
                <option value="application">Application</option>
                <option value="user">User</option>
                <option value="other">Other</option>
              </select>
              <input
                inputMode="numeric"
                placeholder="Entity ID"
                value={newReport.entityId}
                onChange={(event) =>
                  setNewReport((current) => ({
                    ...current,
                    entityId: event.target.value,
                  }))
                }
              />
              <input
                placeholder="Reason"
                value={newReport.reason}
                onChange={(event) =>
                  setNewReport((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
              <textarea
                placeholder="Details"
                value={newReport.details}
                onChange={(event) =>
                  setNewReport((current) => ({
                    ...current,
                    details: event.target.value,
                  }))
                }
              />
              <button disabled={isSubmitting} type="submit">Submit report</button>
            </form>
          </div>
        )}

        {activeTab === 'roles' && (
          <div className="admin-grid two">
            <div className="admin-module">
              <h2>Roles and permissions</h2>
              <div className="admin-role-list">
                {roles.map((role) => (
                  <article key={role.id}>
                    <strong>{label(role.name)}</strong>
                    <p>{role.description}</p>
                    <div className="tag-list">
                      {role.permissions.map((permission) => (
                        <span key={`${role.id}-${permission}`}>{permission}</span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <form
              className="admin-module admin-form"
              onSubmit={(event) => {
                event.preventDefault()
                runAction(async () => {
                  await updateRolePermission(
                    permissionForm.roleId,
                    permissionForm.permissionCode,
                    permissionForm.grant,
                  )
                  await refreshWithNotice('Role permission updated.')
                })
              }}
            >
              <h2>Change access</h2>
              <select
                value={permissionForm.roleId}
                onChange={(event) =>
                  setPermissionForm((current) => ({
                    ...current,
                    roleId: event.target.value,
                  }))
                }
              >
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{label(role.name)}</option>
                ))}
              </select>
              <select
                value={permissionForm.permissionCode}
                onChange={(event) =>
                  setPermissionForm((current) => ({
                    ...current,
                    permissionCode: event.target.value,
                  }))
                }
              >
                <option value="">Select permission</option>
                {permissions.map((permission) => (
                  <option key={permission.code} value={permission.code}>
                    {permission.code}
                  </option>
                ))}
              </select>
              <select
                value={permissionForm.grant ? 'grant' : 'revoke'}
                onChange={(event) =>
                  setPermissionForm((current) => ({
                    ...current,
                    grant: event.target.value === 'grant',
                  }))
                }
              >
                <option value="grant">Grant</option>
                <option value="revoke">Revoke</option>
              </select>
              <button disabled={isSubmitting} type="submit">Save permission</button>
            </form>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="admin-grid two">
            <div className="admin-module">
              <h2>Subscriptions</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Amount</th>
                      <th>Renews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.subscriptions.map((subscription) => (
                      <tr key={subscription.id}>
                        <td>{subscription.company}</td>
                        <td>{subscription.planName}</td>
                        <td><span className={statusClass(subscription.status)}>{label(subscription.status)}</span></td>
                        <td>{formatMoney(subscription.amountCents, subscription.currency)}</td>
                        <td>{formatDate(subscription.currentPeriodEndsAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="admin-module">
              <h2>Payments</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Status</th>
                      <th>Provider</th>
                      <th>Amount</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.company}</td>
                        <td><span className={statusClass(payment.status)}>{label(payment.status)}</span></td>
                        <td>{payment.provider}</td>
                        <td>{formatMoney(payment.amountCents, payment.currency)}</td>
                        <td>{formatDate(payment.paidAt || payment.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="admin-grid three">
            <MiniChart title="Users by role" rows={analytics.usersByRole} labelKey="role" />
            <MiniChart title="Jobs by status" rows={analytics.jobsByStatus} />
            <MiniChart title="Applications by status" rows={analytics.applicationsByStatus} />
            <div className="admin-module">
              <h2>Payment health</h2>
              <div className="admin-list">
                <span>{formatMoney(analytics.billing?.paidAmountCents)} collected</span>
                <span>{analytics.billing?.paymentCount ?? 0} payment records</span>
                <span>{stats.pendingPayments ?? 0} pending payments</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="admin-grid two">
            <form
              className="admin-module admin-form"
              onSubmit={(event) => {
                event.preventDefault()
                runAction(async () => {
                  await saveAdminCategory(categoryForm)
                  setCategoryForm(emptyCategory)
                  await refreshWithNotice('Platform category saved.')
                })
              }}
            >
              <h2>Manage taxonomy</h2>
              <select
                value={categoryForm.categoryType}
                onChange={(event) =>
                  setCategoryForm((current) => ({
                    ...current,
                    categoryType: event.target.value,
                  }))
                }
              >
                <option value="industry">Industry</option>
                <option value="location">Location</option>
                <option value="skill">Skill</option>
                <option value="job_category">Job category</option>
              </select>
              <input
                placeholder="Name"
                value={categoryForm.name}
                onChange={(event) =>
                  setCategoryForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
              <button disabled={isSubmitting} type="submit">Save category</button>
            </form>
            <div className="admin-module">
              <div className="admin-module-head">
                <h2>Categories</h2>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="">All types</option>
                  <option value="industry">Industry</option>
                  <option value="location">Location</option>
                  <option value="skill">Skill</option>
                  <option value="job_category">Job category</option>
                </select>
              </div>
              <button type="button" onClick={() => runAction(() => refreshWithNotice('Categories refreshed.'))}>
                Filter categories
              </button>
              <div className="admin-category-list">
                {categories.map((category) => (
                  <article key={category.id}>
                    <div>
                      <strong>{category.name}</strong>
                      <span>{label(category.categoryType)} · {category.slug}</span>
                    </div>
                    <button
                      disabled={isSubmitting}
                      type="button"
                      onClick={() =>
                        runAction(async () => {
                          await updateAdminCategory(category.id, !category.isActive)
                          await refreshWithNotice('Category updated.')
                        })
                      }
                    >
                      {category.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="admin-module">
            <h2>Audit log review</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Entity</th>
                    <th>IP</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{label(log.action)}</td>
                      <td>
                        <strong>{log.actorName || 'System'}</strong>
                        <span>{log.actorEmail}</span>
                      </td>
                      <td>{label(log.entityType)} #{log.entityId}</td>
                      <td>{log.ipAddress || 'n/a'}</td>
                      <td>{formatDate(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

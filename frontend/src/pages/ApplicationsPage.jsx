import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  getApplicationHistory,
  getApplications,
  getInterviewPreparation,
  withdrawApplication,
} from '../api/platform.js'

function formatStatus(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleString()
}

export function ApplicationsPage() {
  const location = useLocation()
  const [applications, setApplications] = useState([])
  const [preparation, setPreparation] = useState(null)
  const [history, setHistory] = useState(null)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [message, setMessage] = useState(
    location.state?.message
      ? { type: 'success', text: location.state.message }
      : null,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [workingApplicationId, setWorkingApplicationId] = useState(null)

  useEffect(() => {
    let isActive = true

    getApplications()
      .then((data) => {
        if (isActive) setApplications(data.applications)
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

  async function prepare(applicationId) {
    setMessage(null)
    setHistory(null)
    try {
      const data = await getInterviewPreparation(applicationId)
      setPreparation(data)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function showHistory(applicationId) {
    setMessage(null)
    setPreparation(null)
    try {
      const data = await getApplicationHistory(applicationId)
      setHistory({ applicationId, entries: data.history })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function withdraw(applicationId) {
    setMessage(null)
    setWorkingApplicationId(applicationId)
    try {
      const data = await withdrawApplication(applicationId, withdrawReason)
      setApplications((current) =>
        current.map((application) =>
          application.id === applicationId
            ? {
                ...application,
                status: data.application.status,
                withdrawnAt: data.application.withdrawnAt,
                canWithdraw: false,
              }
            : application,
        ),
      )
      setWithdrawReason('')
      setMessage({ type: 'success', text: data.message })
      await showHistory(applicationId)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setWorkingApplicationId(null)
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading applications...</section>
  }

  return (
    <main className="workspace-page">
      <section className="workspace-shell">
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">Candidate workspace</p>
            <h1>My applications</h1>
            <p>Track every submission, status change, interview, and withdrawal.</p>
          </div>
          <span className="status-badge approved">
            {applications.length} submitted
          </span>
        </div>
        {message && (
          <div className={`auth-message ${message.type}`}>{message.text}</div>
        )}
        <div className="application-list">
          {applications.map((application) => (
            <article className="application-card expanded-application-card" key={application.id}>
              <div>
                <p className="card-label">{application.company}</p>
                <h2>{application.jobTitle}</h2>
                <p>
                  Submitted {new Date(application.submittedAt).toLocaleDateString()}
                </p>
                {application.interviewStartsAt && (
                  <p>
                    Interview: {formatDate(application.interviewStartsAt)}
                    {application.interviewLocationOrUrl
                      ? ` | ${application.interviewLocationOrUrl}`
                      : ''}
                  </p>
                )}
                {application.withdrawnAt && (
                  <p>Withdrawn {formatDate(application.withdrawnAt)}</p>
                )}
              </div>
              <span className={`status-badge ${application.status}`}>
                {formatStatus(application.status)}
              </span>
              <div className="application-actions">
                <Link
                  className="btn btn-secondary"
                  to={`/apply?job=${application.jobSlug}`}
                >
                  Job details
                </Link>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => showHistory(application.id)}
                >
                  Status history
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => prepare(application.id)}
                >
                  Interview prep
                </button>
                {application.canWithdraw && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={workingApplicationId === application.id}
                    onClick={() => withdraw(application.id)}
                  >
                    {workingApplicationId === application.id
                      ? 'Withdrawing...'
                      : 'Withdraw'}
                  </button>
                )}
              </div>
            </article>
          ))}
          {applications.length === 0 && (
            <div className="empty-state">
              <h2>No applications yet</h2>
              <p>Applications submitted through HireMe will appear here.</p>
              <Link className="btn btn-primary" to="/">
                Search jobs
              </Link>
            </div>
          )}
        </div>

        {applications.some((application) => application.canWithdraw) && (
          <section className="detail-panel">
            <h2>Withdrawal note</h2>
            <label className="auth-form">
              <span>Optional reason</span>
              <textarea
                rows="3"
                value={withdrawReason}
                placeholder="Briefly note why you are withdrawing."
                onChange={(event) => setWithdrawReason(event.target.value)}
              />
            </label>
          </section>
        )}

        {history && (
          <section className="prep-panel">
            <div className="workspace-heading">
              <div>
                <p className="section-kicker">Application tracking</p>
                <h2>Status history</h2>
              </div>
              <button
                className="nav-action"
                type="button"
                onClick={() => setHistory(null)}
              >
                Close
              </button>
            </div>
            <ol className="timeline-list">
              {history.entries.map((entry) => (
                <li key={entry.id}>
                  <strong>{formatStatus(entry.newStatus)}</strong>
                  <span>{formatDate(entry.changedAt)}</span>
                  {entry.notes && <p>{entry.notes}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {preparation && (
          <section className="prep-panel">
            <div className="workspace-heading">
              <div>
                <p className="section-kicker">Interview preparation</p>
                <h2>
                  {preparation.application.jobTitle} at{' '}
                  {preparation.application.company}
                </h2>
              </div>
              <button
                className="nav-action"
                type="button"
                onClick={() => setPreparation(null)}
              >
                Close
              </button>
            </div>
            {preparation.application.interviewStartsAt && (
              <div className="auth-message info">
                Interview: {formatDate(preparation.application.interviewStartsAt)}
                {preparation.application.interviewLocationOrUrl
                  ? ` | ${preparation.application.interviewLocationOrUrl}`
                  : ''}
              </div>
            )}
            <h3>Practice questions</h3>
            <ol>
              {preparation.preparation.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
            <h3>Preparation checklist</h3>
            <ul>
              {preparation.preparation.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  )
}

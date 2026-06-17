import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  getCandidateDashboard,
  markNotificationRead,
  removeSavedJob,
  saveJob,
} from '../api/platform.js'
import { JobCard } from '../components/JobCard.jsx'
import { ProfileCompletionCard } from '../components/ProfileCompletionCard.jsx'
import { useAuth } from '../hooks/useAuth.js'

function formatStatus(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function formatDate(value) {
  if (!value) return 'Not scheduled'
  return new Date(value).toLocaleString()
}

export function CandidateDashboardPage() {
  const { user } = useAuth()
  const [dashboard, setDashboard] = useState(null)
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getCandidateDashboard()
      .then(setDashboard)
      .catch((error) => setMessage({ type: 'error', text: error.message }))
      .finally(() => setIsLoading(false))
  }, [])

  async function toggleSaved(job) {
    if (!dashboard) return
    try {
      if (job.isSaved) {
        await removeSavedJob(job.id)
      } else {
        await saveJob(job.id)
      }

      setDashboard((current) => ({
        ...current,
        recommendations: current.recommendations.map((item) =>
          item.id === job.id ? { ...item, isSaved: !job.isSaved } : item,
        ),
        savedJobs: job.isSaved
          ? current.savedJobs.filter((item) => item.id !== job.id)
          : [{ ...job, isSaved: true }, ...current.savedJobs].slice(0, 4),
      }))
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function readNotification(notificationId) {
    try {
      await markNotificationRead(notificationId)
      setDashboard((current) => ({
        ...current,
        notifications: current.notifications.map((notification) =>
          notification.id === notificationId
            ? { ...notification, readAt: new Date().toISOString() }
            : notification,
        ),
      }))
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading candidate dashboard...</section>
  }

  const unreadCount =
    dashboard?.notifications.filter((notification) => !notification.readAt)
      .length ?? 0

  return (
    <main className="workspace-page candidate-dashboard-page">
      <section className="workspace-shell">
        <div className="workspace-heading dashboard-hero">
          <div>
            <p className="section-kicker">Candidate platform</p>
            <h1>Welcome, {user.fullName}</h1>
            <p>
              Manage your profile, discover jobs, track applications, and stay
              ready for interviews.
            </p>
          </div>
          <Link className="btn btn-primary" to="/profile">
            Edit profile
          </Link>
        </div>

        {message && (
          <div className={`auth-message ${message.type}`}>{message.text}</div>
        )}

        <ProfileCompletionCard user={user} to="/profile" />

        <div className="candidate-stat-grid">
          <article>
            <strong>{dashboard?.completion?.percentage ?? 0}%</strong>
            <span>Profile completion</span>
          </article>
          <article>
            <strong>{dashboard?.recentApplications.length ?? 0}</strong>
            <span>Recent applications</span>
          </article>
          <article>
            <strong>{dashboard?.savedJobs.length ?? 0}</strong>
            <span>Saved jobs</span>
          </article>
          <article>
            <strong>{dashboard?.profileViews?.last30Days ?? 0}</strong>
            <span>Profile views in 30 days</span>
          </article>
          <article>
            <strong>{dashboard?.upcomingInterviews.length ?? 0}</strong>
            <span>Upcoming interviews</span>
          </article>
          <article>
            <strong>{unreadCount}</strong>
            <span>Unread notifications</span>
          </article>
        </div>

        <section className="candidate-section">
          <div className="section-row">
            <div>
              <p className="section-kicker">Recommended jobs</p>
              <h2>Best matches for your profile</h2>
            </div>
            <Link className="text-button" to="/recommendations">
              View all
            </Link>
          </div>
          <div className="jobs-grid compact-jobs-grid">
            {dashboard?.recommendations.map((job) => (
              <JobCard
                job={job}
                key={job.id}
                showMatch
                onToggleSave={toggleSaved}
              />
            ))}
          </div>
          {dashboard?.recommendations.length === 0 && (
            <div className="empty-state">
              <h2>No recommendations yet</h2>
              <p>Complete your profile skills and preferences to improve matches.</p>
            </div>
          )}
        </section>

        <div className="candidate-two-column">
          <section className="candidate-section">
            <div className="section-row">
              <div>
                <p className="section-kicker">Applications</p>
                <h2>Recent activity</h2>
              </div>
              <Link className="text-button" to="/applications">
                Track all
              </Link>
            </div>
            <div className="mini-list">
              {dashboard?.recentApplications.map((application) => (
                <article key={application.id}>
                  <div>
                    <strong>{application.jobTitle}</strong>
                    <span>{application.company}</span>
                  </div>
                  <span className={`status-badge ${application.status}`}>
                    {formatStatus(application.status)}
                  </span>
                </article>
              ))}
              {dashboard?.recentApplications.length === 0 && (
                <p className="form-help">Submitted applications will appear here.</p>
              )}
            </div>
          </section>

          <section className="candidate-section">
            <div className="section-row">
              <div>
                <p className="section-kicker">Interviews</p>
                <h2>Upcoming schedule</h2>
              </div>
            </div>
            <div className="mini-list">
              {dashboard?.upcomingInterviews.map((interview) => (
                <article key={interview.id}>
                  <div>
                    <strong>{interview.jobTitle}</strong>
                    <span>
                      {interview.company} | {formatDate(interview.startsAt)}
                    </span>
                  </div>
                  <span className="status-badge approved">
                    {formatStatus(interview.interviewType)}
                  </span>
                </article>
              ))}
              {dashboard?.upcomingInterviews.length === 0 && (
                <p className="form-help">Scheduled interviews will appear here.</p>
              )}
            </div>
          </section>
        </div>

        <div className="candidate-two-column">
          <section className="candidate-section">
            <div className="section-row">
              <div>
                <p className="section-kicker">Saved jobs</p>
                <h2>Roles to revisit</h2>
              </div>
            </div>
            <div className="mini-list">
              {dashboard?.savedJobs.map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>{job.title}</strong>
                    <span>{job.company}</span>
                  </div>
                  <Link className="btn btn-secondary" to={`/apply?job=${job.slug}`}>
                    Details
                  </Link>
                </article>
              ))}
              {dashboard?.savedJobs.length === 0 && (
                <p className="form-help">Save jobs from search or recommendations.</p>
              )}
            </div>
          </section>

          <section className="candidate-section">
            <div className="section-row">
              <div>
                <p className="section-kicker">Notifications</p>
                <h2>Latest updates</h2>
              </div>
            </div>
            <div className="notification-stack">
              {dashboard?.notifications.map((notification) => (
                <button
                  className={`notification-item${
                    notification.readAt ? '' : ' unread'
                  }`}
                  key={notification.id}
                  type="button"
                  onClick={() => readNotification(notification.id)}
                >
                  <strong>{notification.title}</strong>
                  {notification.body && <span>{notification.body}</span>}
                </button>
              ))}
              {dashboard?.notifications.length === 0 && (
                <p className="form-help">Status changes and confirmations will appear here.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

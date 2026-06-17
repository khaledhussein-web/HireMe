import { useEffect, useState } from 'react'
import {
  getRecommendations,
  removeSavedJob,
  saveJob,
} from '../api/platform.js'
import { JobCard } from '../components/JobCard.jsx'

export function RecommendationsPage() {
  const [jobs, setJobs] = useState([])
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getRecommendations()
      .then((data) => setJobs(data.jobs))
      .catch((error) => setMessage({ type: 'error', text: error.message }))
      .finally(() => setIsLoading(false))
  }, [])

  async function toggleSaved(job) {
    setMessage(null)
    try {
      if (job.isSaved) {
        await removeSavedJob(job.id)
      } else {
        await saveJob(job.id)
      }
      setJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...item, isSaved: !job.isSaved } : item,
        ),
      )
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  if (isLoading) {
    return <section className="route-loading">Finding your best matches...</section>
  }

  return (
    <main className="workspace-page">
      <section className="workspace-shell">
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">Profile-based matching</p>
            <h1>Job recommendations</h1>
            <p>
              Ranked using your desired roles, skills, experience, and workplace
              preference.
            </p>
          </div>
        </div>
        {message && (
          <div className={`auth-message ${message.type}`}>{message.text}</div>
        )}
        <div className="jobs-grid">
          {jobs.map((job) => (
            <JobCard
              job={job}
              key={job.id}
              showMatch
              onToggleSave={toggleSaved}
            />
          ))}
        </div>
        {jobs.length === 0 && (
          <div className="empty-state">
            <h2>No matches yet</h2>
            <p>
              Complete your skills and desired roles, or wait for an approved
              employer to publish a matching job.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

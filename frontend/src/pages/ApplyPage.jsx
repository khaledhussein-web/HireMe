import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { uploadCandidateResume } from '../api/auth.js'
import {
  getCandidatePlatformProfile,
  getJob,
  submitApplication,
} from '../api/platform.js'
import { useAuth } from '../hooks/useAuth.js'

function formatLabel(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function formatSalary(job) {
  if (!job?.salaryMin || !job?.salaryMax) return 'Salary not listed'
  return `${job.salaryCurrency ?? 'USD'} ${job.salaryMin.toLocaleString()} - ${job.salaryMax.toLocaleString()}`
}

export function ApplyPage() {
  const navigate = useNavigate()
  const { refreshUser, updateUser } = useAuth()
  const [searchParams] = useSearchParams()
  const jobSlug = searchParams.get('job') ?? ''
  const [job, setJob] = useState(null)
  const [profile, setProfile] = useState(null)
  const [selectedResumeId, setSelectedResumeId] = useState('')
  const [resume, setResume] = useState(null)
  const [coverLetter, setCoverLetter] = useState('')
  const [message, setMessage] = useState(
    jobSlug
      ? null
      : { type: 'error', text: 'Select a job before applying.' },
  )
  const [isLoading, setIsLoading] = useState(Boolean(jobSlug))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploadingResume, setIsUploadingResume] = useState(false)
  const [resumeInputKey, setResumeInputKey] = useState(0)

  useEffect(() => {
    if (!jobSlug) return

    Promise.all([getJob(jobSlug), getCandidatePlatformProfile()])
      .then(([jobData, profileData]) => {
        setJob(jobData.job)
        setProfile(profileData.profile)
        setSelectedResumeId(
          profileData.profile.resumeId
            ? String(profileData.profile.resumeId)
            : '',
        )
      })
      .catch((error) => setMessage({ type: 'error', text: error.message }))
      .finally(() => setIsLoading(false))
  }, [jobSlug])

  async function handleResumeUpload() {
    if (!resume) return
    setMessage(null)
    setIsUploadingResume(true)
    try {
      const data = await uploadCandidateResume(resume)
      setProfile((current) => ({
        ...current,
        resumeId: data.resume.id,
        resumeFilename: data.resume.resumeFilename,
        resumeFileSize: data.resume.resumeFileSize,
      }))
      setSelectedResumeId(String(data.resume.id))
      setResume(null)
      setResumeInputKey((current) => current + 1)
      if (data.user) updateUser(data.user)
      else await refreshUser()
      setMessage({ type: 'success', text: 'CV uploaded and selected.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsUploadingResume(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage(null)
    setIsSubmitting(true)
    try {
      const data = await submitApplication({
        jobSlug,
        resumeId: Number(selectedResumeId),
        coverLetter,
      })
      navigate('/applications', {
        replace: true,
        state: { message: data.message },
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading job details...</section>
  }

  return (
    <main className="workspace-page">
      <section className="workspace-shell application-flow-shell">
        {message && (
          <div className={`auth-message ${message.type}`}>{message.text}</div>
        )}
        {job && (
          <>
            <div className="workspace-heading">
              <div>
                <p className="section-kicker">Application flow</p>
                <h1>{job.title}</h1>
                <p>
                  {job.company} | {formatLabel(job.experienceLevel)} |{' '}
                  {formatLabel(job.workplaceType)} | {formatSalary(job)}
                </p>
              </div>
              <span className="status-badge approved">
                {formatLabel(job.employmentType)}
              </span>
            </div>

            <div className="application-flow-grid">
              <article className="detail-panel">
                <h2>Job details</h2>
                <p>{job.description}</p>
                {job.requirements && (
                  <>
                    <h3>Requirements</h3>
                    <p className="pre-line">{job.requirements}</p>
                  </>
                )}
                {job.responsibilities && (
                  <>
                    <h3>Responsibilities</h3>
                    <p className="pre-line">{job.responsibilities}</p>
                  </>
                )}
                {job.requiredSkills?.length > 0 && (
                  <>
                    <h3>Required skills</h3>
                    <div className="tag-list">
                      {job.requiredSkills.map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))}
                    </div>
                  </>
                )}
              </article>

              <form className="auth-form application-submit-panel" onSubmit={handleSubmit}>
                <section>
                  <h2>Choose CV</h2>
                  {profile?.resumeId ? (
                    <label className="candidate-radio-card">
                      <input
                        type="radio"
                        name="resume"
                        checked={selectedResumeId === String(profile.resumeId)}
                        value={profile.resumeId}
                        onChange={(event) =>
                          setSelectedResumeId(event.target.value)
                        }
                      />
                      <span>
                        <strong>{profile.resumeFilename}</strong>
                        <small>Current uploaded CV</small>
                      </span>
                    </label>
                  ) : (
                    <div className="auth-message info">
                      Upload a CV before submitting this application.
                    </div>
                  )}
                  <div className="resume-field">
                    <span className="field-label">Upload a new CV</span>
                    <input
                      key={resumeInputKey}
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(event) =>
                        setResume(event.target.files[0] ?? null)
                      }
                    />
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={!resume || isUploadingResume}
                      onClick={handleResumeUpload}
                    >
                      {isUploadingResume ? 'Uploading...' : 'Upload and select'}
                    </button>
                  </div>
                </section>

                <label>
                  <span>Cover letter</span>
                  <textarea
                    rows="10"
                    minLength="40"
                    maxLength="5000"
                    value={coverLetter}
                    placeholder="Explain why your experience and goals fit this role."
                    required
                    onChange={(event) => setCoverLetter(event.target.value)}
                  />
                </label>
                <p className="form-help">
                  Your saved profile supplies contact details, links,
                  experience, skills, and salary preferences.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={isSubmitting || !selectedResumeId}
                  type="submit"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit application'}
                </button>
                <Link className="btn btn-secondary" to="/">
                  Back to search
                </Link>
              </form>
            </div>
          </>
        )}
      </section>
    </main>
  )
}

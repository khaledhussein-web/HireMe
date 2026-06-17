import { useEffect, useMemo, useState } from 'react'
import {
  compareCandidates,
  createEmployerJob,
  deleteEmployerJob,
  duplicateEmployerJob,
  featureEmployerJob,
  getCandidatePool,
  getEmployerDashboard,
  getEmployerJobs,
  saveCandidateEvaluation,
  scheduleApplicationInterview,
  updateApplicationStatus,
  updateEmployerJob,
  updateEmployerJobStatus,
} from '../api/platform.js'
import { ProfileCompletionCard } from '../components/ProfileCompletionCard.jsx'
import { useAuth } from '../hooks/useAuth.js'

const emptyJob = {
  title: '',
  employmentType: 'full_time',
  workplaceType: 'remote',
  experienceLevel: 'entry_level',
  city: '',
  country: '',
  salaryMin: '',
  salaryMax: '',
  description: '',
  requirements: '',
  responsibilities: '',
  expiresAt: '',
  status: 'draft',
}

const emptyInterview = {
  interviewType: 'video',
  startsAt: '',
  endsAt: '',
  locationOrUrl: '',
  notes: '',
}

const stageColumns = [
  ['submitted', 'New'],
  ['in_review', 'Reviewing'],
  ['shortlisted', 'Shortlisted'],
  ['interview', 'Interview'],
  ['offered', 'Offer'],
  ['hired', 'Hired'],
  ['rejected', 'Rejected'],
]

const nextStatuses = {
  submitted: ['in_review', 'rejected'],
  in_review: ['shortlisted', 'rejected'],
  shortlisted: ['interview', 'rejected'],
  interview: ['offered', 'rejected'],
  offered: ['hired', 'rejected'],
  hired: [],
  rejected: [],
  withdrawn: [],
}

function label(value) {
  return String(value ?? '').replaceAll('_', ' ')
}

function dateInput(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function formatDate(value) {
  if (!value) return 'Not scheduled'
  return new Date(value).toLocaleString()
}

function jobToForm(job) {
  return {
    ...emptyJob,
    ...job,
    salaryMin: job.salaryMin ?? '',
    salaryMax: job.salaryMax ?? '',
    expiresAt: dateInput(job.expiresAt),
  }
}

export function EmployerDashboardPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('overview')
  const [jobs, setJobs] = useState([])
  const [dashboard, setDashboard] = useState({
    stats: {},
    applications: [],
  })
  const [candidates, setCandidates] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [comparison, setComparison] = useState([])
  const [candidateQuery, setCandidateQuery] = useState('')
  const [jobForm, setJobForm] = useState(emptyJob)
  const [editingJobId, setEditingJobId] = useState(null)
  const [evaluationForms, setEvaluationForms] = useState({})
  const [interviewForms, setInterviewForms] = useState({})
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function loadWorkspace() {
    const [jobResult, dashboardResult, candidateResult] = await Promise.allSettled([
      getEmployerJobs(),
      getEmployerDashboard(),
      getCandidatePool(),
    ])
    if (jobResult.status === 'fulfilled') setJobs(jobResult.value.jobs)
    if (dashboardResult.status === 'fulfilled') {
      setDashboard(dashboardResult.value)
      setEvaluationForms(
        Object.fromEntries(
          dashboardResult.value.applications.map((application) => [
            application.id,
            {
              score: application.score ?? '',
              skillsScore: application.skillsScore ?? '',
              experienceScore: application.experienceScore ?? '',
              cultureScore: application.cultureScore ?? '',
              privateNotes: application.privateNotes ?? '',
            },
          ]),
        ),
      )
      setInterviewForms(
        Object.fromEntries(
          dashboardResult.value.applications.map((application) => [
            application.id,
            { ...emptyInterview },
          ]),
        ),
      )
    }
    if (candidateResult.status === 'fulfilled') {
      setCandidates(candidateResult.value.candidates)
    }
    const failure = [jobResult, dashboardResult, candidateResult].find(
      (result) => result.status === 'rejected' && result.reason.status !== 403,
    )
    if (failure) throw failure.reason
  }

  useEffect(() => {
    let isActive = true

    Promise.allSettled([
      getEmployerJobs(),
      getEmployerDashboard(),
      getCandidatePool(),
    ])
      .then(([jobResult, dashboardResult, candidateResult]) => {
        if (!isActive) return
        if (jobResult.status === 'fulfilled') setJobs(jobResult.value.jobs)
        if (dashboardResult.status === 'fulfilled') {
          setDashboard(dashboardResult.value)
          setEvaluationForms(
            Object.fromEntries(
              dashboardResult.value.applications.map((application) => [
                application.id,
                {
                  score: application.score ?? '',
                  skillsScore: application.skillsScore ?? '',
                  experienceScore: application.experienceScore ?? '',
                  cultureScore: application.cultureScore ?? '',
                  privateNotes: application.privateNotes ?? '',
                },
              ]),
            ),
          )
          setInterviewForms(
            Object.fromEntries(
              dashboardResult.value.applications.map((application) => [
                application.id,
                { ...emptyInterview },
              ]),
            ),
          )
        }
        if (candidateResult.status === 'fulfilled') {
          setCandidates(candidateResult.value.candidates)
        }
        const failure = [jobResult, dashboardResult, candidateResult].find(
          (result) =>
            result.status === 'rejected' && result.reason.status !== 403,
        )
        if (failure) {
          setMessage({ type: 'error', text: failure.reason.message })
        }
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedIds.includes(candidate.id)),
    [candidates, selectedIds],
  )

  function updateJobField(event) {
    setJobForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }))
  }

  function editJob(job) {
    setEditingJobId(job.id)
    setJobForm(jobToForm(job))
    setActiveTab('job-editor')
  }

  function resetJobForm(status = 'draft') {
    setEditingJobId(null)
    setJobForm({ ...emptyJob, status })
  }

  async function saveJob(event) {
    event.preventDefault()
    setMessage(null)
    setIsSubmitting(true)
    try {
      const payload = {
        ...jobForm,
        salaryMin: jobForm.salaryMin === '' ? null : Number(jobForm.salaryMin),
        salaryMax: jobForm.salaryMax === '' ? null : Number(jobForm.salaryMax),
      }
      const data = editingJobId
        ? await updateEmployerJob(editingJobId, payload)
        : await createEmployerJob(payload)
      setMessage({ type: 'success', text: data.message })
      resetJobForm()
      await loadWorkspace()
      setActiveTab('jobs')
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function changeJobStatus(jobId, status) {
    setMessage(null)
    try {
      const data = await updateEmployerJobStatus(jobId, status)
      setMessage({ type: 'success', text: data.message })
      await loadWorkspace()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function duplicateJob(jobId) {
    setMessage(null)
    try {
      const data = await duplicateEmployerJob(jobId)
      setMessage({ type: 'success', text: data.message })
      await loadWorkspace()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function featureJob(jobId) {
    setMessage(null)
    try {
      const data = await featureEmployerJob(jobId, 30)
      setMessage({ type: 'success', text: data.message })
      await loadWorkspace()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function removeJob(jobId) {
    if (!window.confirm('Archive and remove this job from the workspace?')) {
      return
    }
    setMessage(null)
    try {
      await deleteEmployerJob(jobId)
      setMessage({ type: 'success', text: 'Job archived.' })
      await loadWorkspace()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function changeStatus(applicationId, status) {
    setMessage(null)
    try {
      const data = await updateApplicationStatus(applicationId, status)
      setDashboard((current) => ({
        ...current,
        applications: current.applications.map((application) =>
          application.id === applicationId
            ? { ...application, status: data.status }
            : application,
        ),
      }))
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  function updateEvaluation(applicationId, field, value) {
    setEvaluationForms((current) => ({
      ...current,
      [applicationId]: {
        ...current[applicationId],
        [field]: value,
      },
    }))
  }

  async function saveEvaluation(applicationId) {
    setMessage(null)
    try {
      const form = evaluationForms[applicationId] ?? {}
      const data = await saveCandidateEvaluation(applicationId, {
        ...form,
        score: form.score === '' ? null : Number(form.score),
        skillsScore: form.skillsScore === '' ? null : Number(form.skillsScore),
        experienceScore:
          form.experienceScore === '' ? null : Number(form.experienceScore),
        cultureScore:
          form.cultureScore === '' ? null : Number(form.cultureScore),
      })
      setDashboard((current) => ({
        ...current,
        applications: current.applications.map((application) =>
          application.id === applicationId
            ? { ...application, ...data.evaluation }
            : application,
        ),
      }))
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  function updateInterview(applicationId, field, value) {
    setInterviewForms((current) => ({
      ...current,
      [applicationId]: {
        ...current[applicationId],
        [field]: value,
      },
    }))
  }

  async function scheduleInterview(applicationId) {
    setMessage(null)
    try {
      const data = await scheduleApplicationInterview(
        applicationId,
        interviewForms[applicationId],
      )
      setMessage({ type: 'success', text: data.message })
      await loadWorkspace()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function searchCandidates(event) {
    event.preventDefault()
    setMessage(null)
    try {
      const data = await getCandidatePool(candidateQuery)
      setCandidates(data.candidates)
      setSelectedIds([])
      setComparison([])
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  function toggleCandidate(candidateId) {
    setSelectedIds((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId)
      }
      if (current.length === 4) return current
      return [...current, candidateId]
    })
  }

  async function runComparison() {
    setMessage(null)
    try {
      const data = await compareCandidates(selectedIds)
      setComparison(data.candidates)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading employer workspace...</section>
  }

  const approved = user.verificationStatus === 'approved'

  return (
    <main className="workspace-page employer-platform-page">
      <section className="workspace-shell employer-platform-shell">
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">Employer platform</p>
            <h1>Hiring command center</h1>
            <p>
              Manage jobs, move applicants through the ATS, evaluate
              candidates, schedule interviews, and export permitted data.
            </p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              resetJobForm('draft')
              setActiveTab('job-editor')
            }}
          >
            Create draft
          </button>
        </div>

        {message && (
          <div className={`auth-message ${message.type}`}>{message.text}</div>
        )}
        <ProfileCompletionCard user={user} to="/onboarding/employer" />
        {!approved && (
          <div className="auth-message info">
            Company status: {user.verificationStatus}. Job publishing and
            candidate tools unlock after admin approval.
          </div>
        )}

        <div className="employer-stat-grid">
          <article><strong>{dashboard.stats.activeJobs ?? 0}</strong><span>Active jobs</span></article>
          <article><strong>{dashboard.stats.totalApplications ?? 0}</strong><span>Total applications</span></article>
          <article><strong>{dashboard.stats.newApplicants ?? 0}</strong><span>New applicants</span></article>
          <article><strong>{dashboard.stats.shortlistedCandidates ?? 0}</strong><span>Shortlisted candidates</span></article>
          <article><strong>{dashboard.stats.upcomingInterviews ?? 0}</strong><span>Upcoming interviews</span></article>
          <article><strong>{dashboard.stats.jobViews ?? 0}</strong><span>Job views</span></article>
          <article><strong>{dashboard.stats.conversionRate ?? 0}%</strong><span>Conversion rate</span></article>
        </div>

        <div className="workspace-tabs" role="tablist">
          {[
            ['overview', 'Overview'],
            ['jobs', 'Job management'],
            ['ats', 'Applicant tracking'],
            ['pool', 'Candidate pool'],
            ['compare', 'Compare'],
            ['job-editor', editingJobId ? 'Edit job' : 'New job'],
          ].map(([value, text]) => (
            <button
              className={activeTab === value ? 'active' : ''}
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
            >
              {text}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="candidate-two-column">
            <section className="candidate-section">
              <div className="section-row">
                <div>
                  <p className="section-kicker">Jobs</p>
                  <h2>Open hiring work</h2>
                </div>
                <button className="text-button" type="button" onClick={() => setActiveTab('jobs')}>
                  Manage jobs
                </button>
              </div>
              <div className="mini-list">
                {jobs.slice(0, 5).map((job) => (
                  <article key={job.id}>
                    <div>
                      <strong>{job.title}</strong>
                      <span>
                        {label(job.status)} | {job.applicationCount} applications | {job.viewCount} views
                      </span>
                    </div>
                    <span className={`status-badge ${job.status}`}>{label(job.status)}</span>
                  </article>
                ))}
              </div>
            </section>
            <section className="candidate-section">
              <div className="section-row">
                <div>
                  <p className="section-kicker">Applicants</p>
                  <h2>Newest candidates</h2>
                </div>
                <button className="text-button" type="button" onClick={() => setActiveTab('ats')}>
                  Open ATS
                </button>
              </div>
              <div className="mini-list">
                {dashboard.applications.slice(0, 5).map((application) => (
                  <article key={application.id}>
                    <div>
                      <strong>{application.fullName}</strong>
                      <span>{application.jobTitle}</span>
                    </div>
                    <span className={`status-badge ${application.status}`}>
                      {stageColumns.find(([value]) => value === application.status)?.[1] ?? label(application.status)}
                    </span>
                  </article>
                ))}
                {dashboard.applications.length === 0 && (
                  <p className="form-help">Applicants will appear here after candidates apply.</p>
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="application-list">
            {jobs.map((job) => (
              <article className="employer-job-card" key={job.id}>
                <div>
                  <p className="card-label">{label(job.experienceLevel)}</p>
                  <h2>{job.title}</h2>
                  <p>
                    {label(job.workplaceType)} | {label(job.employmentType)} | {job.applicationCount} applications | {job.viewCount} views
                  </p>
                  {job.featured && (
                    <span className="match-score">Featured until {dateInput(job.featuredPaidUntil)}</span>
                  )}
                </div>
                <span className={`status-badge ${job.status}`}>{label(job.status)}</span>
                <div className="application-actions">
                  <button className="btn btn-secondary" type="button" onClick={() => editJob(job)}>Edit</button>
                  {job.status !== 'published' && (
                    <button className="btn btn-primary" type="button" onClick={() => changeJobStatus(job.id, 'published')}>Publish</button>
                  )}
                  {job.status === 'published' && (
                    <button className="btn btn-secondary" type="button" onClick={() => changeJobStatus(job.id, 'paused')}>Pause</button>
                  )}
                  {job.status === 'paused' && (
                    <button className="btn btn-primary" type="button" onClick={() => changeJobStatus(job.id, 'published')}>Resume</button>
                  )}
                  {job.status !== 'closed' && (
                    <button className="btn btn-secondary" type="button" onClick={() => changeJobStatus(job.id, 'closed')}>Close</button>
                  )}
                  <button className="btn btn-secondary" type="button" onClick={() => duplicateJob(job.id)}>Duplicate</button>
                  <button className="btn btn-secondary" type="button" onClick={() => featureJob(job.id)}>Feature paid</button>
                  <button className="btn btn-secondary" type="button" onClick={() => changeJobStatus(job.id, 'archived')}>Archive</button>
                  <button className="btn btn-secondary" type="button" onClick={() => removeJob(job.id)}>Delete</button>
                </div>
              </article>
            ))}
            {jobs.length === 0 && (
              <div className="empty-state">
                <h2>No jobs yet</h2>
                <button className="btn btn-primary" type="button" onClick={() => setActiveTab('job-editor')}>Create draft</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'job-editor' && (
          <form className="auth-form job-form" onSubmit={saveJob}>
            <div className="section-row">
              <div>
                <p className="section-kicker">Job management</p>
                <h2>{editingJobId ? 'Edit job' : 'Create draft or publish'}</h2>
              </div>
              <button className="text-button" type="button" onClick={() => resetJobForm()}>
                Clear form
              </button>
            </div>
            <div className="auth-field-grid">
              <label><span>Job title</span><input name="title" value={jobForm.title} required onChange={updateJobField} /></label>
              <label><span>Status</span><select name="status" value={jobForm.status} disabled={Boolean(editingJobId)} onChange={updateJobField}><option value="draft">Draft</option><option value="published">Publish now</option></select></label>
              <label><span>Experience level</span><select name="experienceLevel" value={jobForm.experienceLevel} onChange={updateJobField}><option value="internship">Internship</option><option value="entry_level">Entry level</option><option value="mid_level">Mid level</option><option value="senior_level">Senior level</option></select></label>
              <label><span>Employment type</span><select name="employmentType" value={jobForm.employmentType} onChange={updateJobField}><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option><option value="internship">Internship</option><option value="temporary">Temporary</option></select></label>
              <label><span>Workplace</span><select name="workplaceType" value={jobForm.workplaceType} onChange={updateJobField}><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on_site">On-site</option></select></label>
              <label><span>City</span><input name="city" value={jobForm.city ?? ''} onChange={updateJobField} /></label>
              <label><span>Country</span><input name="country" value={jobForm.country ?? ''} onChange={updateJobField} /></label>
              <label><span>Minimum salary</span><input type="number" min="0" name="salaryMin" value={jobForm.salaryMin ?? ''} onChange={updateJobField} /></label>
              <label><span>Maximum salary</span><input type="number" min="0" name="salaryMax" value={jobForm.salaryMax ?? ''} onChange={updateJobField} /></label>
              <label><span>Closing date</span><input type="date" name="expiresAt" value={jobForm.expiresAt ?? ''} onChange={updateJobField} /></label>
            </div>
            <label><span>Description</span><textarea rows="5" minLength="20" name="description" value={jobForm.description ?? ''} required onChange={updateJobField} /></label>
            <label><span>Requirements</span><textarea rows="5" name="requirements" value={jobForm.requirements ?? ''} onChange={updateJobField} /></label>
            <label><span>Responsibilities</span><textarea rows="5" name="responsibilities" value={jobForm.responsibilities ?? ''} onChange={updateJobField} /></label>
            <button className="btn btn-primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Saving...' : editingJobId ? 'Save edits' : jobForm.status === 'published' ? 'Publish job' : 'Create draft'}
            </button>
          </form>
        )}

        {activeTab === 'ats' && (
          <div className="ats-board">
            {stageColumns.map(([status, title]) => {
              const stageApplications = dashboard.applications.filter(
                (application) => application.status === status,
              )
              return (
                <section className="ats-column" key={status}>
                  <div className="section-row">
                    <h2>{title}</h2>
                    <span className="status-badge">{stageApplications.length}</span>
                  </div>
                  {stageApplications.map((application) => (
                    <ApplicantCard
                      application={application}
                      evaluation={evaluationForms[application.id] ?? {}}
                      interview={interviewForms[application.id] ?? emptyInterview}
                      key={application.id}
                      onChangeStatus={changeStatus}
                      onEvaluationChange={updateEvaluation}
                      onInterviewChange={updateInterview}
                      onSaveEvaluation={saveEvaluation}
                      onScheduleInterview={scheduleInterview}
                    />
                  ))}
                </section>
              )
            })}
          </div>
        )}

        {activeTab === 'pool' && (
          <>
            <form className="pool-search" onSubmit={searchCandidates}>
              <input
                value={candidateQuery}
                placeholder="Search name, skill, headline, or location"
                onChange={(event) => setCandidateQuery(event.target.value)}
              />
              <button className="btn btn-primary" type="submit">Search</button>
            </form>
            <div className="candidate-grid">
              {candidates.map((candidate) => (
                <CandidateCard
                  candidate={candidate}
                  checked={selectedIds.includes(candidate.id)}
                  key={candidate.id}
                  onToggle={() => toggleCandidate(candidate.id)}
                />
              ))}
            </div>
            {candidates.length === 0 && (
              <div className="empty-state">
                <h2>No candidates match this search</h2>
              </div>
            )}
          </>
        )}

        {activeTab === 'compare' && (
          <>
            <div className="comparison-toolbar">
              <p>{selectedCandidates.length} candidates selected from the pool</p>
              <button
                className="btn btn-primary"
                disabled={selectedIds.length < 2}
                type="button"
                onClick={runComparison}
              >
                Compare selected
              </button>
            </div>
            <div className="comparison-grid">
              {comparison.map((candidate) => (
                <article className="comparison-card" key={candidate.id}>
                  <h2>{candidate.fullName}</h2>
                  <p>{candidate.headline}</p>
                  <dl>
                    <dt>Experience</dt><dd>{candidate.yearsExperience} years</dd>
                    <dt>Location</dt><dd>{candidate.location}</dd>
                    <dt>Skills</dt><dd>{candidate.skills.join(', ') || 'Not listed'}</dd>
                    <dt>Desired roles</dt><dd>{candidate.desiredRoles.join(', ') || 'Not listed'}</dd>
                    <dt>Advanced applications</dt><dd>{candidate.advancedApplicationCount}</dd>
                  </dl>
                </article>
              ))}
            </div>
            {comparison.length === 0 && (
              <div className="empty-state">
                <h2>Select candidates in Candidate pool</h2>
                <p>Choose two to four real profiles, then compare them here.</p>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}

function ApplicantCard({
  application,
  evaluation,
  interview,
  onChangeStatus,
  onEvaluationChange,
  onInterviewChange,
  onSaveEvaluation,
  onScheduleInterview,
}) {
  return (
    <article className="ats-card">
      <p className="card-label">{application.jobTitle}</p>
      <h3>{application.fullName}</h3>
      <p>{application.location} | {application.yearsExperience} years</p>
      <div className="tag-list">
        {application.skills.map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>
      <p className="cover-letter-preview">{application.coverLetter}</p>
      {application.interviewStartsAt && (
        <div className="auth-message info">
          Interview: {formatDate(application.interviewStartsAt)}
          {application.interviewLocationOrUrl
            ? ` | ${application.interviewLocationOrUrl}`
            : ''}
        </div>
      )}
      <div className="button-row">
        {(nextStatuses[application.status] ?? []).map((status) => (
          <button
            className={status === 'rejected' ? 'btn btn-secondary' : 'btn btn-primary'}
            key={status}
            type="button"
            onClick={() => onChangeStatus(application.id, status)}
          >
            {stageColumns.find(([value]) => value === status)?.[1] ?? label(status)}
          </button>
        ))}
      </div>
      <div className="evaluation-grid">
        <label><span>Overall</span><select value={evaluation.score ?? ''} onChange={(event) => onEvaluationChange(application.id, 'score', event.target.value)}><option value="">-</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>
        <label><span>Skills</span><select value={evaluation.skillsScore ?? ''} onChange={(event) => onEvaluationChange(application.id, 'skillsScore', event.target.value)}><option value="">-</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>
        <label><span>Experience</span><select value={evaluation.experienceScore ?? ''} onChange={(event) => onEvaluationChange(application.id, 'experienceScore', event.target.value)}><option value="">-</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>
        <label><span>Culture</span><select value={evaluation.cultureScore ?? ''} onChange={(event) => onEvaluationChange(application.id, 'cultureScore', event.target.value)}><option value="">-</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>
      </div>
      <label className="evaluation-notes">
        <span>Private notes</span>
        <textarea
          rows="3"
          value={evaluation.privateNotes ?? ''}
          onChange={(event) =>
            onEvaluationChange(application.id, 'privateNotes', event.target.value)
          }
        />
      </label>
      <button className="btn btn-secondary" type="button" onClick={() => onSaveEvaluation(application.id)}>
        Save evaluation
      </button>
      <details className="interview-scheduler">
        <summary>Schedule interview</summary>
        <div className="auth-form">
          <label><span>Type</span><select value={interview.interviewType} onChange={(event) => onInterviewChange(application.id, 'interviewType', event.target.value)}><option value="phone">Phone</option><option value="video">Video</option><option value="on_site">On-site</option><option value="technical">Technical</option><option value="panel">Panel</option></select></label>
          <label><span>Starts</span><input type="datetime-local" value={interview.startsAt} onChange={(event) => onInterviewChange(application.id, 'startsAt', event.target.value)} /></label>
          <label><span>Ends</span><input type="datetime-local" value={interview.endsAt} onChange={(event) => onInterviewChange(application.id, 'endsAt', event.target.value)} /></label>
          <label><span>Location or URL</span><input value={interview.locationOrUrl} onChange={(event) => onInterviewChange(application.id, 'locationOrUrl', event.target.value)} /></label>
          <label><span>Notes</span><textarea rows="2" value={interview.notes} onChange={(event) => onInterviewChange(application.id, 'notes', event.target.value)} /></label>
          <button className="btn btn-primary" type="button" onClick={() => onScheduleInterview(application.id)}>Schedule</button>
        </div>
      </details>
      <div className="link-row">
        {application.linkedinUrl && <a href={application.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}
        {application.portfolioUrl && <a href={application.portfolioUrl} target="_blank" rel="noreferrer">Portfolio</a>}
        {application.candidateUserId && application.resumeId && (
          <a href={`/api/employer-workspace/candidates/${application.candidateUserId}/resume`}>
            CV
          </a>
        )}
        <a href={`/api/employer-workspace/applications/${application.id}/export`}>Export CSV</a>
      </div>
    </article>
  )
}

function CandidateCard({ candidate, checked, onToggle }) {
  return (
    <article className={`candidate-card${checked ? ' selected' : ''}`}>
      <label className="candidate-select">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        Compare
      </label>
      <h2>{candidate.fullName}</h2>
      <p>{candidate.headline}</p>
      <p>{candidate.location} | {candidate.yearsExperience} years</p>
      <div className="tag-list">
        {candidate.skills.map((skill) => <span key={skill}>{skill}</span>)}
      </div>
      <div className="link-row">
        {candidate.linkedinUrl && <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}
        {candidate.portfolioUrl && <a href={candidate.portfolioUrl} target="_blank" rel="noreferrer">Portfolio</a>}
        {candidate.hasResume && (
          <a href={`/api/employer-workspace/candidates/${candidate.id}/resume`}>
            CV
          </a>
        )}
      </div>
    </article>
  )
}

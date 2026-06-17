import { Link } from 'react-router-dom'

const workplaceLabels = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  on_site: 'On-site',
}

const employmentLabels = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
}

function formatSalary(job) {
  if (!job.salaryMin || !job.salaryMax) {
    return 'Salary not listed'
  }

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: job.salaryCurrency ?? 'USD',
    maximumFractionDigits: 0,
    notation: 'compact',
  })

  return `${formatter.format(job.salaryMin)} - ${formatter.format(job.salaryMax)}`
}

export function JobCard({ job, showMatch = false, onToggleSave }) {
  const initials = job.company
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <article className="job-card">
      <div className="job-header">
        <div className="company-logo" aria-hidden="true">
          {initials}
        </div>
        <div className="job-info">
          <h3>{job.title}</h3>
          <p className="company-name">{job.company}</p>
        </div>
      </div>
      <div className="job-details">
        {showMatch && (
          <span className="match-score">{job.matchScore}% match</span>
        )}
        <span className="badge">
          {employmentLabels[job.employmentType] ?? job.employmentType}
        </span>
        <span className="badge">
          {workplaceLabels[job.workplaceType] ?? job.workplaceType}
        </span>
        <span className="salary">{formatSalary(job)}</span>
      </div>
      <p className="job-description">{job.description}</p>
      {showMatch && job.matchedSkills?.length > 0 && (
        <p className="match-reason">
          Matching skills: {job.matchedSkills.join(', ')}
        </p>
      )}
      <div className="job-card-actions">
        <Link
          className="btn btn-secondary"
          to={`/apply?job=${encodeURIComponent(job.slug)}`}
        >
          View details
        </Link>
        {onToggleSave && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => onToggleSave(job)}
          >
            {job.isSaved ? 'Saved' : 'Save'}
          </button>
        )}
      </div>
    </article>
  )
}

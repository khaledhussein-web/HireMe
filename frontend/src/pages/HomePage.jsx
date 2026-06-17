import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/JobCard.jsx'
import { getJobs, removeSavedJob, saveJob } from '../api/platform.js'
import { useAuth } from '../hooks/useAuth.js'

const features = [
  {
    icon: '01',
    title: 'Perfect Match',
    description:
      'Find roles that fit your skills, experience, and work preferences.',
  },
  {
    icon: '02',
    title: 'Fast Applications',
    description:
      'Apply to opportunities from one focused and reusable profile.',
  },
  {
    icon: '03',
    title: 'Secure and Private',
    description:
      'Keep your personal information protected throughout your search.',
  },
  {
    icon: '04',
    title: 'Application Tracking',
    description:
      'Follow every submitted application and prepare for interviews in one place.',
  },
]

export function HomePage() {
  const { user } = useAuth()
  const [jobs, setJobs] = useState([])
  const [jobsMessage, setJobsMessage] = useState('')
  const [filters, setFilters] = useState({
    keyword: '',
    location: '',
    workplaceType: '',
    employmentType: '',
    experienceLevel: '',
    salaryMin: '',
    salaryMax: '',
    industry: '',
    skills: '',
    datePublished: '',
  })
  const [isSearching, setIsSearching] = useState(true)

  useEffect(() => {
    let isActive = true

    getJobs()
      .then((data) => {
        if (isActive && Array.isArray(data.jobs)) setJobs(data.jobs)
      })
      .catch((error) => {
        if (isActive) {
          setJobs([])
          setJobsMessage(error.message)
        }
      })
      .finally(() => {
        if (isActive) setIsSearching(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  function updateFilter(event) {
    setFilters((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }))
  }

  async function loadJobs(nextFilters = filters) {
    setIsSearching(true)
    setJobsMessage('')
    try {
      const data = await getJobs(nextFilters)
      if (Array.isArray(data.jobs)) setJobs(data.jobs)
    } catch (error) {
      setJobs([])
      setJobsMessage(error.message)
    } finally {
      setIsSearching(false)
    }
  }

  async function toggleSaved(job) {
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
      setJobsMessage(error.message)
    }
  }

  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">Your next chapter starts here</p>
          <h1 className="hero-title">Find Your Dream Job Today</h1>
          <p className="hero-subtitle">
            Connecting talented professionals with great opportunities
            worldwide.
          </p>
          <form
            className="hero-search"
            onSubmit={(event) => {
              event.preventDefault()
              loadJobs(filters)
            }}
          >
            <input
              className="search-input"
              type="search"
              name="keyword"
              value={filters.keyword}
              placeholder="Job title, keywords..."
              aria-label="Search by job title or keyword"
              onChange={updateFilter}
            />
            <input
              className="search-input"
              type="search"
              name="location"
              value={filters.location}
              placeholder="City, country, remote..."
              aria-label="Search by location"
              onChange={updateFilter}
            />
            <button className="btn btn-primary" type="submit">
              {isSearching ? 'Searching...' : 'Search Jobs'}
            </button>
          </form>
        </div>
      </section>

      <section className="featured-jobs">
        <div className="container">
          <p className="section-kicker">Featured opportunities</p>
          <h2 className="section-title">Find a role built for you</h2>
          <form
            className="job-filter-panel"
            onSubmit={(event) => {
              event.preventDefault()
              loadJobs(filters)
            }}
          >
            <select
              name="workplaceType"
              value={filters.workplaceType}
              aria-label="Workplace type"
              onChange={updateFilter}
            >
              <option value="">Remote, hybrid or on-site</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="on_site">On-site</option>
            </select>
            <select
              name="employmentType"
              value={filters.employmentType}
              aria-label="Employment type"
              onChange={updateFilter}
            >
              <option value="">Internship, part-time or full-time</option>
              <option value="internship">Internship</option>
              <option value="part_time">Part-time</option>
              <option value="full_time">Full-time</option>
              <option value="contract">Contract</option>
              <option value="temporary">Temporary</option>
            </select>
            <select
              name="experienceLevel"
              value={filters.experienceLevel}
              aria-label="Experience level"
              onChange={updateFilter}
            >
              <option value="">Experience level</option>
              <option value="internship">Internship</option>
              <option value="entry_level">Entry level</option>
              <option value="mid_level">Mid level</option>
              <option value="senior_level">Senior level</option>
            </select>
            <input
              name="salaryMin"
              type="number"
              min="0"
              value={filters.salaryMin}
              placeholder="Min salary"
              aria-label="Minimum salary"
              onChange={updateFilter}
            />
            <input
              name="salaryMax"
              type="number"
              min="0"
              value={filters.salaryMax}
              placeholder="Max salary"
              aria-label="Maximum salary"
              onChange={updateFilter}
            />
            <input
              name="industry"
              value={filters.industry}
              placeholder="Industry"
              aria-label="Industry"
              onChange={updateFilter}
            />
            <input
              name="skills"
              value={filters.skills}
              placeholder="Required skills"
              aria-label="Required skills"
              onChange={updateFilter}
            />
            <select
              name="datePublished"
              value={filters.datePublished}
              aria-label="Date published"
              onChange={updateFilter}
            >
              <option value="">Any publish date</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
            <button className="btn btn-primary" type="submit">
              Apply filters
            </button>
          </form>
          <div className="jobs-grid">
            {jobs.map((job) => (
              <JobCard
                job={job}
                key={job.id}
                onToggleSave={user?.role === 'candidate' ? toggleSaved : null}
              />
            ))}
          </div>
          {jobs.length === 0 && (
            <p className="job-search-empty">
              {jobsMessage ||
                'No real jobs are published yet. Approved employers can publish the first role.'}
            </p>
          )}
        </div>
      </section>

      <section className="why-choose">
        <div className="container">
          <p className="section-kicker">Why HireMe</p>
          <h2 className="section-title">A clearer path to better work</h2>
          <div className="features-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <div className="feature-icon">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2>Ready to take the next step?</h2>
            <p>
              Join professionals building their next chapter through HireMe.
            </p>
            <div className="cta-buttons">
              <Link className="btn btn-primary btn-large" to="/signup">
                Create Free Account
              </Link>
              <Link className="btn btn-outline btn-large" to="/how-it-works">
                Learn More
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

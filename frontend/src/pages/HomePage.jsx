import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { JobCard } from '../components/JobCard.jsx'
import { fallbackJobs } from '../data/fallbackJobs.js'

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
    title: 'Direct Communication',
    description:
      'Connect with hiring teams and follow each application in one place.',
  },
]

function normalize(value) {
  return value.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function HomePage() {
  const [jobs, setJobs] = useState(fallbackJobs)
  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadJobs() {
      try {
        const response = await fetch('/api/jobs', { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        if (Array.isArray(data.jobs) && data.jobs.length > 0) {
          setJobs(data.jobs)
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.info('Using local jobs until the API is available.')
        }
      }
    }

    loadJobs()
    return () => controller.abort()
  }, [])

  const filteredJobs = useMemo(() => {
    const keywordTerms = normalize(keyword).split(' ').filter(Boolean)
    const normalizedLocation = normalize(location)

    return jobs.filter((job) => {
      const searchable = normalize(
        `${job.title} ${job.company} ${job.description}`,
      )
      const jobLocation = normalize(job.workplaceType)

      return (
        keywordTerms.every((term) => searchable.includes(term)) &&
        (normalizedLocation === '' || jobLocation.includes(normalizedLocation))
      )
    })
  }, [jobs, keyword, location])

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
          <div className="hero-search">
            <input
              className="search-input"
              type="search"
              value={keyword}
              placeholder="Job title, keywords..."
              aria-label="Search by job title or keyword"
              onChange={(event) => setKeyword(event.target.value)}
            />
            <input
              className="search-input"
              type="search"
              value={location}
              placeholder="Remote, hybrid, on-site..."
              aria-label="Search by workplace type"
              onChange={(event) => setLocation(event.target.value)}
            />
            <button className="btn btn-primary" type="button">
              Search Jobs
            </button>
          </div>
          <div className="hero-stats">
            <div className="stat-item">
              <h3 className="stat-number">10,000+</h3>
              <p>Active Jobs</p>
            </div>
            <div className="stat-item">
              <h3 className="stat-number">5,000+</h3>
              <p>Companies</p>
            </div>
            <div className="stat-item">
              <h3 className="stat-number">50,000+</h3>
              <p>Candidates</p>
            </div>
          </div>
        </div>
      </section>

      <section className="featured-jobs">
        <div className="container">
          <p className="section-kicker">Featured opportunities</p>
          <h2 className="section-title">Find a role built for you</h2>
          <div className="jobs-grid">
            {filteredJobs.map((job) => (
              <JobCard job={job} key={job.id} />
            ))}
          </div>
          {filteredJobs.length === 0 && (
            <p className="job-search-empty">
              No jobs match that search. Try broader keywords or another
              workplace type.
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

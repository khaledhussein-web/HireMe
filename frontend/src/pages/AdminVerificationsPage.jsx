import { useEffect, useState } from 'react'
import {
  getEmployerVerification,
  getCandidateResumes,
  getPendingEmployerVerifications,
  getPendingCommunityVerifications,
  reviewEmployerCompany,
  reviewCommunity,
} from '../api/employers.js'

export function AdminVerificationsPage() {
  const [companies, setCompanies] = useState([])
  const [reasons, setReasons] = useState({})
  const [details, setDetails] = useState({})
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [resumes, setResumes] = useState([])
  const [communities, setCommunities] = useState([])
  const [communityReasons, setCommunityReasons] = useState({})

  useEffect(() => {
    Promise.all([
      getPendingEmployerVerifications(),
      getCandidateResumes(),
      getPendingCommunityVerifications(),
    ])
      .then(([verificationData, resumeData, communityData]) => {
        setCompanies(verificationData.companies)
        setResumes(resumeData.resumes)
        setCommunities(communityData.communities)
      })
      .catch((error) => setMessage({ type: 'error', text: error.message }))
      .finally(() => setIsLoading(false))
  }, [])

  async function decide(companyId, decision) {
    setMessage(null)
    try {
      const data = await reviewEmployerCompany(
        companyId,
        decision,
        reasons[companyId] ?? '',
      )
      setCompanies((current) =>
        current.filter((company) => company.id !== companyId),
      )
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function decideCommunity(communityId, decision) {
    setMessage(null)
    try {
      const data = await reviewCommunity(
        communityId,
        decision,
        communityReasons[communityId] ?? '',
      )
      setCommunities((current) =>
        current.filter((community) => community.id !== communityId),
      )
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function loadDetails(companyId) {
    try {
      const data = await getEmployerVerification(companyId)
      setDetails((current) => ({ ...current, [companyId]: data }))
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading verification queue...</section>
  }

  return (
    <main className="profile-page">
      <section className="profile-card employer-workspace">
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">Administration</p>
            <h1>Employer verification queue</h1>
          </div>
          <span className="status-badge pending">{companies.length} pending</span>
        </div>
        {message && (
          <div className={`auth-message ${message.type}`}>{message.text}</div>
        )}
        <div className="verification-list">
          {companies.map((company) => (
            <article key={company.id} className="verification-card">
              <div>
                <h2>{company.name}</h2>
                <p>
                  {company.ownerName} | {company.ownerEmail}
                </p>
                <p>
                  {company.industry} | {company.headquartersLocation} |{' '}
                  {company.documentCount} document(s)
                </p>
              </div>
              {!details[company.id] ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => loadDetails(company.id)}
                >
                  Review profile and documents
                </button>
              ) : (
                <div className="verification-details">
                  <p>{details[company.id].company.description}</p>
                  <p>
                    Registration:{' '}
                    {details[company.id].company.registration_number}
                  </p>
                  {details[company.id].documents.map((document) => (
                    <a
                      key={document.id}
                      href={`/api/admin/company-documents/${document.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {document.originalFilename} (
                      {document.documentType.replaceAll('_', ' ')})
                    </a>
                  ))}
                </div>
              )}
              <textarea
                placeholder="Rejection reason"
                value={reasons[company.id] ?? ''}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [company.id]: event.target.value,
                  }))
                }
              />
              <div className="verification-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => decide(company.id, 'rejected')}
                >
                  Reject
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => decide(company.id, 'approved')}
                >
                  Approve
                </button>
              </div>
            </article>
          ))}
          {companies.length === 0 && <p>No pending company submissions.</p>}
        </div>
        <div className="workspace-section">
          <div className="workspace-heading">
            <div>
              <p className="section-kicker">Tech communities</p>
              <h2>Community verification queue</h2>
            </div>
            <span className="status-badge pending">
              {communities.length} pending
            </span>
          </div>
          <div className="verification-list">
            {communities.map((community) => (
              <article className="verification-card" key={community.id}>
                <div>
                  <h2>{community.communityName}</h2>
                  <p>{community.ownerName} | {community.ownerEmail}</p>
                  <p>{community.category} | {community.city}, {community.country}</p>
                  <p>{community.description}</p>
                  <div className="tag-list">
                    {community.technicalTracks.map((track) => (
                      <span key={track}>{track}</span>
                    ))}
                  </div>
                </div>
                <textarea
                  placeholder="Rejection reason"
                  value={communityReasons[community.id] ?? ''}
                  onChange={(event) =>
                    setCommunityReasons((current) => ({
                      ...current,
                      [community.id]: event.target.value,
                    }))
                  }
                />
                <div className="verification-actions">
                  <button className="btn btn-secondary" type="button" onClick={() => decideCommunity(community.id, 'rejected')}>Reject</button>
                  <button className="btn btn-primary" type="button" onClick={() => decideCommunity(community.id, 'approved')}>Approve</button>
                </div>
              </article>
            ))}
            {communities.length === 0 && <p>No pending communities.</p>}
          </div>
        </div>
        <div className="workspace-section">
          <div className="workspace-heading">
            <div>
              <p className="section-kicker">Candidate documents</p>
              <h2>Stored resumes</h2>
            </div>
            <span className="status-badge approved">{resumes.length} CVs</span>
          </div>
          <div className="resume-admin-list">
            {resumes.map((resume) => (
              <article className="resume-admin-card" key={resume.id}>
                <div>
                  <h3>{resume.candidateName}</h3>
                  <p>{resume.candidateEmail}</p>
                  <p>
                    {resume.headline || 'No headline'} |{' '}
                    {resume.location || 'No location'}
                  </p>
                  <small>
                    {resume.resumeFilename} |{' '}
                    {Math.ceil(resume.resumeFileSize / 1024)} KB
                  </small>
                </div>
                <a
                  className="btn btn-secondary"
                  href={`/api/admin/candidate-resumes/${resume.id}/download`}
                >
                  Download CV
                </a>
              </article>
            ))}
            {resumes.length === 0 && <p>No candidate resumes uploaded.</p>}
          </div>
        </div>
      </section>
    </main>
  )
}

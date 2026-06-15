import { useEffect, useState } from 'react'
import {
  getEmployerVerification,
  getPendingEmployerVerifications,
  reviewEmployerCompany,
} from '../api/employers.js'

export function AdminVerificationsPage() {
  const [companies, setCompanies] = useState([])
  const [reasons, setReasons] = useState({})
  const [details, setDetails] = useState({})
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getPendingEmployerVerifications()
      .then((data) => setCompanies(data.companies))
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
                  {company.ownerName} · {company.ownerEmail}
                </p>
                <p>
                  {company.industry} · {company.headquartersLocation} ·{' '}
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
      </section>
    </main>
  )
}

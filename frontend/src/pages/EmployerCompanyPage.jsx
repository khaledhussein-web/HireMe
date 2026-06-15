import { useEffect, useState } from 'react'
import {
  getEmployerCompany,
  getEmployerNotifications,
  saveEmployerCompany,
  uploadCompanyDocument,
} from '../api/employers.js'
import { useAuth } from '../hooks/useAuth.js'

const emptyCompany = {
  name: '',
  websiteUrl: '',
  description: '',
  headquartersLocation: '',
  industry: '',
  companySize: '',
  registrationNumber: '',
  taxIdentifier: '',
  contactEmail: '',
  contactPhone: '',
  verificationStatus: 'draft',
}

export function EmployerCompanyPage() {
  const { user, updateUser } = useAuth()
  const [form, setForm] = useState(emptyCompany)
  const [documents, setDocuments] = useState([])
  const [notifications, setNotifications] = useState([])
  const [documentType, setDocumentType] = useState('business_registration')
  const [document, setDocument] = useState(null)
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    Promise.allSettled([getEmployerCompany(), getEmployerNotifications()])
      .then(([companyResult, notificationResult]) => {
        if (companyResult.status === 'fulfilled') {
          setForm((current) => ({
            ...current,
            ...companyResult.value.company,
          }))
          setDocuments(companyResult.value.documents)
        } else if (companyResult.reason.status !== 404) {
          setMessage({ type: 'error', text: companyResult.reason.message })
        }

        if (notificationResult.status === 'fulfilled') {
          setNotifications(notificationResult.value.notifications)
        }
      })
      .finally(() => setIsLoading(false))
  }, [])

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }))
  }

  async function saveCompany(submit) {
    setMessage(null)
    setIsSubmitting(true)
    try {
      const data = await saveEmployerCompany({ ...form, submit })
      setForm((current) => ({ ...current, ...data.company }))
      if (submit) {
        updateUser({
          ...user,
          profileComplete: true,
          employerVerificationStatus: 'pending',
        })
      }
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function uploadDocument(event) {
    event.preventDefault()
    if (!document) return
    const formElement = event.currentTarget

    setMessage(null)
    setIsSubmitting(true)
    try {
      const data = await uploadCompanyDocument(documentType, document)
      setDocuments((current) => [data.document, ...current])
      setForm((current) => ({
        ...current,
        verificationStatus: 'draft',
      }))
      setDocument(null)
      formElement.reset()
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading company profile...</section>
  }

  return (
    <main className="profile-page">
      <section className="profile-card employer-workspace">
        <div className="workspace-heading">
          <div>
            <p className="section-kicker">Employer verification</p>
            <h1>Company profile</h1>
          </div>
          <span className={`status-badge ${form.verificationStatus}`}>
            {form.verificationStatus}
          </span>
        </div>

        {form.rejectionReason && (
          <div className="auth-message error">{form.rejectionReason}</div>
        )}
        {message && (
          <div className={`auth-message ${message.type}`} role="alert">
            {message.text}
          </div>
        )}

        <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
          <div className="auth-field-grid">
            <label>
              <span>Company name</span>
              <input name="name" value={form.name} required onChange={updateField} />
            </label>
            <label>
              <span>Industry</span>
              <input
                name="industry"
                value={form.industry}
                required
                onChange={updateField}
              />
            </label>
          </div>
          <div className="auth-field-grid">
            <label>
              <span>Company size</span>
              <input
                name="companySize"
                value={form.companySize}
                placeholder="1-10, 11-50, 51-200..."
                required
                onChange={updateField}
              />
            </label>
            <label>
              <span>Headquarters</span>
              <input
                name="headquartersLocation"
                value={form.headquartersLocation}
                required
                onChange={updateField}
              />
            </label>
          </div>
          <div className="auth-field-grid">
            <label>
              <span>Registration number</span>
              <input
                name="registrationNumber"
                value={form.registrationNumber}
                required
                onChange={updateField}
              />
            </label>
            <label>
              <span>Tax identifier</span>
              <input
                name="taxIdentifier"
                value={form.taxIdentifier ?? ''}
                onChange={updateField}
              />
            </label>
          </div>
          <div className="auth-field-grid">
            <label>
              <span>Contact email</span>
              <input
                type="email"
                name="contactEmail"
                value={form.contactEmail}
                required
                onChange={updateField}
              />
            </label>
            <label>
              <span>Contact phone</span>
              <input
                name="contactPhone"
                value={form.contactPhone}
                required
                onChange={updateField}
              />
            </label>
          </div>
          <label>
            <span>Website</span>
            <input
              type="url"
              name="websiteUrl"
              value={form.websiteUrl ?? ''}
              placeholder="https://"
              onChange={updateField}
            />
          </label>
          <label>
            <span>Company description</span>
            <textarea
              name="description"
              value={form.description}
              minLength="20"
              required
              onChange={updateField}
            />
          </label>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={isSubmitting}
            onClick={() => saveCompany(false)}
          >
            Save draft
          </button>
        </form>

        <div className="workspace-section">
          <h2>Verification documents</h2>
          <p>Upload PDF, JPEG, or PNG files up to 5 MB.</p>
          <form className="document-form" onSubmit={uploadDocument}>
            <select
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
            >
              <option value="business_registration">Business registration</option>
              <option value="tax_certificate">Tax certificate</option>
              <option value="owner_identification">Owner identification</option>
              <option value="address_proof">Address proof</option>
              <option value="other">Other</option>
            </select>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              required
              onChange={(event) => setDocument(event.target.files[0] ?? null)}
            />
            <button className="btn btn-secondary" disabled={isSubmitting}>
              Upload
            </button>
          </form>
          <ul className="document-list">
            {documents.map((item) => (
              <li key={item.id}>
                <strong>{item.originalFilename}</strong>
                <span>{item.documentType.replaceAll('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          className="btn btn-primary auth-submit"
          type="button"
          disabled={isSubmitting || form.verificationStatus === 'pending'}
          onClick={() => saveCompany(true)}
        >
          {form.verificationStatus === 'pending'
            ? 'Waiting for admin review'
            : 'Submit for verification'}
        </button>

        {notifications.length > 0 && (
          <div className="workspace-section">
            <h2>Notifications</h2>
            <ul className="notification-list">
              {notifications.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  )
}

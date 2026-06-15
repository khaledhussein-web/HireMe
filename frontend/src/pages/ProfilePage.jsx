import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  getCandidateProfile,
  updateCandidateProfile,
} from '../api/auth.js'
import { useAuth } from '../hooks/useAuth.js'

const emptyProfile = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  headline: '',
  bio: '',
  yearsExperience: 0,
  linkedinUrl: '',
  portfolioUrl: '',
  resumeUrl: '',
}

export function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { updateUser } = useAuth()
  const [form, setForm] = useState(emptyProfile)
  const [message, setMessage] = useState(
    location.state?.message
      ? { type: 'info', text: location.state.message }
      : null,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let isActive = true

    getCandidateProfile()
      .then((data) => {
        if (!isActive) return
        setForm({
          ...emptyProfile,
          ...data.profile,
          yearsExperience: data.profile.yearsExperience ?? 0,
        })
      })
      .catch((error) => {
        if (isActive) setMessage({ type: 'error', text: error.message })
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    try {
      const data = await updateCandidateProfile({
        ...form,
        yearsExperience: Number(form.yearsExperience),
      })
      updateUser(data.user)
      setMessage({ type: 'success', text: data.message })
      navigate('/', { replace: true })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading your profile...</section>
  }

  return (
    <section className="profile-page">
      <div className="profile-card">
        <div className="auth-heading">
          <p className="auth-eyebrow">Candidate profile</p>
          <h1>Complete your profile</h1>
          <p>
            Required fields help employers understand who you are before you
            apply.
          </p>
        </div>

        {message && (
          <div className={`auth-message ${message.type}`} role="alert">
            {message.text}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field-grid">
            <label>
              <span>Full name</span>
              <input
                name="fullName"
                value={form.fullName}
                autoComplete="name"
                required
                onChange={updateField}
              />
            </label>
            <label>
              <span>Email</span>
              <input value={form.email} disabled />
            </label>
            <label>
              <span>Phone</span>
              <input
                name="phone"
                value={form.phone}
                autoComplete="tel"
                required
                onChange={updateField}
              />
            </label>
            <label>
              <span>Location</span>
              <input
                name="location"
                value={form.location}
                autoComplete="address-level2"
                required
                onChange={updateField}
              />
            </label>
          </div>
          <label>
            <span>Professional headline</span>
            <input
              name="headline"
              value={form.headline}
              placeholder="Frontend developer focused on accessible products"
              required
              onChange={updateField}
            />
          </label>
          <label>
            <span>About you</span>
            <textarea
              name="bio"
              value={form.bio}
              rows="4"
              onChange={updateField}
            />
          </label>
          <div className="auth-field-grid">
            <label>
              <span>Years of experience</span>
              <input
                type="number"
                name="yearsExperience"
                value={form.yearsExperience}
                min="0"
                max="80"
                required
                onChange={updateField}
              />
            </label>
            <label>
              <span>Resume URL</span>
              <input
                type="url"
                name="resumeUrl"
                value={form.resumeUrl}
                placeholder="https://"
                onChange={updateField}
              />
            </label>
            <label>
              <span>LinkedIn URL</span>
              <input
                type="url"
                name="linkedinUrl"
                value={form.linkedinUrl}
                placeholder="https://linkedin.com/in/..."
                onChange={updateField}
              />
            </label>
            <label>
              <span>Portfolio URL</span>
              <input
                type="url"
                name="portfolioUrl"
                value={form.portfolioUrl}
                placeholder="https://"
                onChange={updateField}
              />
            </label>
          </div>
          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving profile...' : 'Save profile'}
          </button>
        </form>
      </div>
    </section>
  )
}

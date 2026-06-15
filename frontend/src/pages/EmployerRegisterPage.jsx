import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerEmployer } from '../api/employers.js'
import { AuthShell } from '../components/AuthShell.jsx'

export function EmployerRegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [message, setMessage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage(null)

    if (form.password !== form.confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }

    setIsSubmitting(true)
    try {
      const data = await registerEmployer({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
      })
      const token = data.developmentActionUrl
        ? new URL(data.developmentActionUrl).searchParams.get('token')
        : null

      navigate(
        token
          ? `/verify-email?token=${encodeURIComponent(token)}`
          : '/verify-email',
        {
          replace: true,
          state: { email: data.email, message: data.message },
        },
      )
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Hire with HireMe"
      title="Create an employer account"
      subtitle="Verify your business before publishing jobs or reviewing candidates."
      footerText="Already registered?"
      footerLinkText="Sign in"
      footerLinkTo="/login"
    >
      {message && (
        <div className={`auth-message ${message.type}`} role="alert">
          {message.text}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Full name</span>
          <input
            name="fullName"
            value={form.fullName}
            minLength="2"
            autoComplete="name"
            required
            onChange={updateField}
          />
        </label>
        <label>
          <span>Work email</span>
          <input
            type="email"
            name="email"
            value={form.email}
            autoComplete="email"
            required
            onChange={updateField}
          />
        </label>
        <div className="auth-field-grid">
          <label>
            <span>Password</span>
            <input
              type="password"
              name="password"
              value={form.password}
              minLength="8"
              autoComplete="new-password"
              required
              onChange={updateField}
            />
          </label>
          <label>
            <span>Confirm password</span>
            <input
              type="password"
              name="confirmPassword"
              value={form.confirmPassword}
              minLength="8"
              autoComplete="new-password"
              required
              onChange={updateField}
            />
          </label>
        </div>
        <p className="auth-terms">
          Use at least eight characters with uppercase, lowercase, and a number.
        </p>
        <button
          className="btn btn-primary auth-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating account...' : 'Create employer account'}
        </button>
        <p className="auth-terms">
          Looking for work? <Link to="/signup">Create a candidate account</Link>.
        </p>
      </form>
    </AuthShell>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { register } from '../api/auth.js'
import { AuthShell } from '../components/AuthShell.jsx'
import { SocialLoginButtons } from '../components/SocialLoginButtons.jsx'

const initialForm = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
}

export function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
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
      const data = await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
      })
      const developmentToken = data.developmentActionUrl
        ? new URL(data.developmentActionUrl).searchParams.get('token')
        : null

      navigate(
        developmentToken
          ? `/verify-email?token=${encodeURIComponent(developmentToken)}`
          : '/verify-email',
        {
        replace: true,
        state: {
          email: data.email,
          message: data.message,
        },
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
      eyebrow="Join HireMe"
      title="Create your account"
      subtitle="Set up your profile and start finding work that fits."
      footerText="Already have an account?"
      footerLinkText="Sign in"
      footerLinkTo="/login"
    >
      <SocialLoginButtons onMessage={setMessage} />
      <div className="auth-divider">
        <span>or sign up with email</span>
      </div>

      {message && (
        <div className={`auth-message ${message.type}`} role="alert">
          {message.text}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Full name</span>
          <input
            type="text"
            name="fullName"
            value={form.fullName}
            autoComplete="name"
            placeholder="Your full name"
            minLength="2"
            required
            onChange={updateField}
          />
        </label>
        <label>
          <span>Email address</span>
          <input
            type="email"
            name="email"
            value={form.email}
            autoComplete="email"
            placeholder="you@example.com"
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
              autoComplete="new-password"
              placeholder="8+ characters"
              minLength="8"
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
              autoComplete="new-password"
              placeholder="Repeat password"
              minLength="8"
              required
              onChange={updateField}
            />
          </label>
        </div>
        <p className="auth-terms">
          By creating an account, you agree to HireMe&apos;s terms and privacy
          policy.
        </p>
        <button
          className="btn btn-primary auth-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  )
}

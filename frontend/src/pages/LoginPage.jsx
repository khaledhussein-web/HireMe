import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/AuthShell.jsx'
import { SocialLoginButtons } from '../components/SocialLoginButtons.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { userDestination } from '../utils/authRouting.js'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [form, setForm] = useState({
    email: location.state?.email ?? '',
    password: '',
  })
  const [message, setMessage] = useState(
    location.state?.message
      ? { type: 'info', text: location.state.message }
      : null,
  )
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
    setIsSubmitting(true)

    try {
      const user = await login(form)
      const destination =
        user.onboardingCompleted && location.state?.from
          ? location.state.from
          : userDestination(user)
      navigate(destination, { replace: true })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        navigate('/check-email', {
          state: { email: form.email, message: error.message },
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to HireMe"
      subtitle="Continue your search and pick up where you left off."
      footerText="New to HireMe?"
      footerLinkText="Create an account"
      footerLinkTo="/signup"
    >
      <SocialLoginButtons onMessage={setMessage} />
      <div className="auth-divider">
        <span>or continue with email</span>
      </div>

      {message && (
        <div className={`auth-message ${message.type}`} role="alert">
          {message.text}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
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
        <label>
          <span className="auth-label-row">
            <span>Password</span>
            <Link to="/forgot-password">Forgot password?</Link>
          </span>
          <input
            type="password"
            name="password"
            value={form.password}
            autoComplete="current-password"
            placeholder="At least 8 characters"
            minLength="8"
            required
            onChange={updateField}
          />
        </label>
        <button
          className="btn btn-primary auth-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  )
}

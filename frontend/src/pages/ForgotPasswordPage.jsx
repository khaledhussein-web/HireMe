import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../api/auth.js'
import { AuthShell } from '../components/AuthShell.jsx'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(null)
  const [developmentUrl, setDevelopmentUrl] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage(null)
    setDevelopmentUrl(null)

    try {
      const data = await forgotPassword(email)
      setMessage({ type: 'info', text: data.message })
      setDevelopmentUrl(data.developmentActionUrl ?? null)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="Enter your account email and we will create a secure reset link."
      footerText="Remembered it?"
      footerLinkText="Back to sign in"
      footerLinkTo="/login"
    >
      {message && (
        <div className={`auth-message ${message.type}`} role="status">
          {message.text}
        </div>
      )}
      {developmentUrl && (
        <div className="auth-message development">
          Development mode: <Link to={new URL(developmentUrl).pathname + new URL(developmentUrl).search}>open the reset link</Link>.
        </div>
      )}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Email address</span>
          <input
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@example.com"
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button
          className="btn btn-primary auth-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating link...' : 'Send reset link'}
        </button>
      </form>
    </AuthShell>
  )
}

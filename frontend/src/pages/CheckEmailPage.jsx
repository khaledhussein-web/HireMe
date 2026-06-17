import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { resendVerification } from '../api/auth.js'
import { AuthShell } from '../components/AuthShell.jsx'

export function CheckEmailPage() {
  const location = useLocation()
  const [, setSearchParams] = useSearchParams()
  const [email, setEmail] = useState(location.state?.email ?? '')
  const [message, setMessage] = useState({
    type: 'info',
    text:
      location.state?.message ??
      'We sent a verification link to your email address.',
  })
  const [developmentActionUrl, setDevelopmentActionUrl] = useState(
    location.state?.developmentActionUrl ?? '',
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function resend(event) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const data = await resendVerification(email)
      setMessage({ type: 'success', text: data.message })
      if (data.developmentActionUrl) {
        setDevelopmentActionUrl(data.developmentActionUrl)
        const token = new URL(data.developmentActionUrl).searchParams.get('token')
        setSearchParams({})
        window.location.assign(`/verify-email?token=${encodeURIComponent(token)}`)
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="One last step"
      title="Check your email"
      subtitle="Open the verification link to activate your account and continue onboarding."
      footerText="Already verified?"
      footerLinkText="Sign in"
      footerLinkTo="/login"
    >
      <div className={`auth-message ${message.type}`}>{message.text}</div>
      {developmentActionUrl && (
        <a className="btn btn-primary auth-submit" href={developmentActionUrl}>
          Verify account in development
        </a>
      )}
      <form className="auth-form" onSubmit={resend}>
        <label>
          <span>Email address</span>
          <input
            type="email"
            value={email}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button className="btn btn-secondary" disabled={isSubmitting}>
          {isSubmitting ? 'Sending...' : 'Resend verification email'}
        </button>
      </form>
    </AuthShell>
  )
}

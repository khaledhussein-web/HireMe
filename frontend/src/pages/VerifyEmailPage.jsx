import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  resendVerification,
  verifyEmail,
} from '../api/auth.js'
import { AuthShell } from '../components/AuthShell.jsx'

export function VerifyEmailPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [email, setEmail] = useState(location.state?.email ?? '')
  const [message, setMessage] = useState(
    location.state?.message
      ? { type: 'info', text: location.state.message }
      : null,
  )
  const [isSubmitting, setIsSubmitting] = useState(Boolean(token))

  useEffect(() => {
    if (!token) return

    let isActive = true

    verifyEmail(token)
      .then((data) => {
        if (!isActive) return
        setMessage({ type: 'success', text: data.message })
        setSearchParams({}, { replace: true })
      })
      .catch((error) => {
        if (isActive) setMessage({ type: 'error', text: error.message })
      })
      .finally(() => {
        if (isActive) setIsSubmitting(false)
      })

    return () => {
      isActive = false
    }
  }, [setSearchParams, token])

  async function handleResend(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    try {
      const data = await resendVerification(email)
      setMessage({ type: 'info', text: data.message })

      if (data.developmentActionUrl) {
        const developmentToken = new URL(
          data.developmentActionUrl,
        ).searchParams.get('token')
        setSearchParams({ token: developmentToken }, { replace: true })
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Confirm your account"
      title="Verify your email"
      subtitle="Use the link sent to your inbox before signing in."
      footerText="Already verified?"
      footerLinkText="Sign in"
      footerLinkTo="/login"
    >
      {message && (
        <div className={`auth-message ${message.type}`} role="alert">
          {message.text}
          {message.type === 'success' && (
            <>
              {' '}
              <Link to="/login">Continue to sign in.</Link>
            </>
          )}
        </div>
      )}

      {isSubmitting && (
        <div className="auth-message info" aria-live="polite">
          Verifying your email...
        </div>
      )}

      {!token && message?.type !== 'success' && (
        <form className="auth-form" onSubmit={handleResend}>
          <label>
            <span>Email address</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating link...' : 'Resend verification link'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { resetPassword } from '../api/auth.js'
import { AuthShell } from '../components/AuthShell.jsx'

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [form, setForm] = useState({ password: '', confirmPassword: '' })
  const [message, setMessage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage(null)

    if (!token) {
      setMessage({ type: 'error', text: 'This reset link is missing a token.' })
      return
    }
    if (form.password !== form.confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }

    setIsSubmitting(true)
    try {
      const data = await resetPassword(token, form.password)
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      eyebrow="Choose a new password"
      title="Secure your account"
      subtitle="Use at least eight characters for your new password."
      footerText="Return to"
      footerLinkText="sign in"
      footerLinkTo="/login"
    >
      {message && (
        <div className={`auth-message ${message.type}`} role="alert">
          {message.text}
          {message.type === 'success' && (
            <>
              {' '}
              <Link to="/login">Sign in now.</Link>
            </>
          )}
        </div>
      )}
      {message?.type !== 'success' && (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>New password</span>
            <input
              type="password"
              value={form.password}
              autoComplete="new-password"
              minLength="8"
              required
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Confirm new password</span>
            <input
              type="password"
              value={form.confirmPassword}
              autoComplete="new-password"
              minLength="8"
              required
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  confirmPassword: event.target.value,
                }))
              }
            />
          </label>
          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Updating password...' : 'Update password'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}

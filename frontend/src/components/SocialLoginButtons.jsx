import { useState } from 'react'
import { startSocialLogin } from '../api/auth.js'

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.3h5.4a4.7 4.7 0 0 1-2 3v2.8h3.3c1.9-1.8 2.9-4.4 2.9-7.9Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.8c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.8A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.7A6 6 0 0 1 6.1 12c0-.6.1-1.2.3-1.7V7.5H3A10 10 0 0 0 2 12c0 1.6.4 3.1 1 4.5l3.4-2.8Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.2c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.8C7.2 8 9.4 6.2 12 6.2Z"
      />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M17.1 12.5c0-2.3 1.9-3.4 2-3.5a4.3 4.3 0 0 0-3.4-1.8c-1.5-.1-2.8.9-3.5.9-.8 0-1.9-.9-3.1-.9a4.7 4.7 0 0 0-4 2.4c-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.3 1.1-.1 1.6-.8 3-.8 1.3 0 1.8.8 3 .8 1.3 0 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.4-1-2.4-3.9ZM14.8 5.7c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.8-1.3Z"
      />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  )
}

const providers = [
  { id: 'google', label: 'Google', Icon: GoogleIcon },
  { id: 'apple', label: 'Apple', Icon: AppleIcon },
  { id: 'microsoft', label: 'Outlook', Icon: MicrosoftIcon },
]

export function SocialLoginButtons({ onMessage }) {
  const [pendingProvider, setPendingProvider] = useState('')

  async function handleProvider(provider) {
    setPendingProvider(provider.id)
    onMessage(null)

    try {
      await startSocialLogin(provider.id)
    } catch (error) {
      onMessage({ type: 'info', text: error.message })
    } finally {
      setPendingProvider('')
    }
  }

  return (
    <div className="social-login-grid">
      {providers.map((provider) => (
        <button
          className="social-login-button"
          type="button"
          key={provider.id}
          disabled={Boolean(pendingProvider)}
          onClick={() => handleProvider(provider)}
        >
          <provider.Icon />
          <span>
            {pendingProvider === provider.id
              ? 'Connecting...'
              : provider.label}
          </span>
        </button>
      ))}
    </div>
  )
}

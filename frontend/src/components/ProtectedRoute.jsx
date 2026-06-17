import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'

export function ProtectedRoute({
  children,
  onboardingOnly = false,
  roles,
}) {
  const location = useLocation()
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <section className="route-loading" aria-live="polite">
        Checking your session...
      </section>
    )
  }

  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`

    return (
      <Navigate
        to="/login"
        replace
        state={{
          from,
          message: 'Sign in to apply for jobs or view your applications.',
        }}
      />
    )
  }

  if (!user.emailVerified) {
    return (
      <Navigate
        to="/check-email"
        replace
        state={{
          email: user.email,
          message: 'Verify your email before continuing.',
        }}
      />
    )
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.nextRoute || '/'} replace />
  }

  if (
    onboardingOnly &&
    user.onboardingCompleted &&
    user.profileCompletionPercentage === 100
  ) {
    return <Navigate to={user.nextRoute || '/'} replace />
  }

  return children
}

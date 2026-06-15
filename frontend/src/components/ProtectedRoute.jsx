import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'

export function ProtectedRoute({
  children,
  requireCompleteProfile = false,
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

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  if (
    requireCompleteProfile &&
    user.role === 'candidate' &&
    !user.profileComplete
  ) {
    return (
      <Navigate
        to="/profile"
        replace
        state={{
          message: 'Complete your candidate profile before applying.',
        }}
      />
    )
  }

  return children
}

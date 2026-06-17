import { Navigate } from 'react-router-dom'

export function EmployerRegisterPage() {
  return <Navigate to="/signup" replace state={{ role: 'employer' }} />
}

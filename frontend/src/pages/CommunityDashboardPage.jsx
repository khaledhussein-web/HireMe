import { ProfileCompletionCard } from '../components/ProfileCompletionCard.jsx'
import { useAuth } from '../hooks/useAuth.js'

export function CommunityDashboardPage() {
  const { user } = useAuth()
  return (
    <main className="workspace-page">
      <section className="workspace-shell narrow-workspace">
        <p className="section-kicker">Tech community dashboard</p>
        <h1>{user.fullName}</h1>
        <span className={`status-badge ${user.verificationStatus}`}>{user.verificationStatus}</span>
        <p className="form-help">Manage your community identity and review status from one place.</p>
        <ProfileCompletionCard user={user} to="/onboarding/community" />
        {user.verificationStatus === 'pending' && <div className="auth-message info">Your community profile is waiting for admin review.</div>}
      </section>
    </main>
  )
}

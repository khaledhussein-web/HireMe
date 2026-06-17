import { Link } from 'react-router-dom'

const labels = {
  basic_information: 'Basic information',
  education: 'Education',
  career_preferences: 'Career preferences',
  cv: 'CV',
  skills: 'Skills',
  github_or_portfolio: 'GitHub or portfolio',
  profile_photo: 'Profile photo',
  linkedin: 'LinkedIn',
  company_information: 'Company information',
  business_contact: 'Business contact',
  company_logo: 'Company logo',
  verification_document: 'Verification document',
  submitted_for_review: 'Submit for review',
  community_information: 'Community information',
  location: 'Location',
  technical_tracks: 'Technical tracks',
  contact: 'Contact information',
  community_logo: 'Community logo',
}

export function ProfileCompletionCard({ user, to }) {
  if (!user || user.profileCompletionPercentage >= 100) return null

  return (
    <section className="completion-card">
      <div>
        <p className="card-label">Profile completion</p>
        <h2>{user.profileCompletionPercentage}% complete</h2>
        <p>
          Add {user.missingItems.map((item) => labels[item] ?? item).slice(0, 3).join(', ')}
          {user.missingItems.length > 3 ? ', and more' : ''}.
        </p>
      </div>
      <div className="completion-meter">
        <span style={{ width: `${user.profileCompletionPercentage}%` }} />
      </div>
      <Link className="btn btn-primary" to={to}>
        Continue profile
      </Link>
    </section>
  )
}

import { Link } from 'react-router-dom'

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  footerText,
  footerLinkText,
  footerLinkTo,
  children,
}) {
  return (
    <section className="auth-page">
      <div className="auth-backdrop" aria-hidden="true">
        <span className="auth-orb auth-orb-one" />
        <span className="auth-orb auth-orb-two" />
      </div>
      <div className="auth-layout">
        <aside className="auth-story">
          <Link className="auth-story-logo" to="/">
            HireMe
          </Link>
          <div>
            <p className="auth-story-kicker">One profile. Better opportunities.</p>
            <h2>Build a career that feels like yours.</h2>
            <p>
              Discover focused roles, connect with employers, and keep your
              applications moving from one calm workspace.
            </p>
          </div>
          <p className="auth-story-kicker">
            Real profiles | Verified employers | Trackable applications
          </p>
        </aside>

        <div className="auth-card">
          <div className="auth-heading">
            <p className="auth-eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
          <p className="auth-footer">
            {footerText} <Link to={footerLinkTo}>{footerLinkText}</Link>
          </p>
        </div>
      </div>
    </section>
  )
}

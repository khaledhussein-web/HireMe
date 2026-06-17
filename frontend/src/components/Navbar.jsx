import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'

const publicLinks = [
  { to: '/', label: 'Home' },
  { to: '/for-employers', label: 'For Employers' },
  { to: '/how-it-works', label: 'How It Works' },
]

function getDashboardPath(role) {
  if (role === 'candidate') return '/candidate/dashboard'
  if (role === 'employer') return '/employer/dashboard'
  if (role === 'tech_community') return '/community/dashboard'
  return '/admin/dashboard'
}

function getWorkspaceLinks(role) {
  if (role === 'candidate') {
    return [
      { to: '/recommendations', label: 'Recommendations' },
      { to: '/applications', label: 'Applications' },
      { to: '/profile', label: 'Profile' },
    ]
  }

  if (role === 'employer') {
    return [
      { to: '/employer/dashboard', label: 'Hiring' },
      { to: '/employer/company', label: 'Company' },
    ]
  }

  if (role === 'tech_community') {
    return [{ to: '/onboarding/community', label: 'Community profile' }]
  }

  if (role === 'admin') {
    return [{ to: '/admin/verifications', label: 'Verifications' }]
  }

  return []
}

function navLinkClass({ isActive }) {
  return `nav-link${isActive ? ' active' : ''}`
}

function primaryActionClass({ isActive }) {
  return `nav-link nav-link-primary${isActive ? ' active' : ''}`
}

export function Navbar() {
  const { user, isLoading, logout } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const workspaceLinks = user ? getWorkspaceLinks(user.role) : []
  const dashboardPath = user ? getDashboardPath(user.role) : '/'

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  async function handleLogout() {
    await logout()
    setIsMenuOpen(false)
  }

  return (
    <nav
      className={`navbar${isScrolled ? ' scrolled' : ''}`}
      aria-label="Primary navigation"
    >
      <div className="nav-container">
        <div className="logo">
          <Link
            className="brand-link"
            to="/"
            onClick={() => setIsMenuOpen(false)}
          >
            <span className="brand-mark" aria-hidden="true">
              H
            </span>
            <span>HireMe</span>
          </Link>
        </div>
        <button
          type="button"
          className={`menu-toggle${isMenuOpen ? ' active' : ''}`}
          aria-label="Toggle navigation"
          aria-controls="primary-navigation"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>
        <div
          id="primary-navigation"
          className={`nav-menu${isMenuOpen ? ' active' : ''}`}
        >
          <div className="nav-group nav-primary-links">
            {publicLinks.map((link) => (
              <NavLink
                key={link.to}
                className={navLinkClass}
                to={link.to}
                end={link.to === '/'}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
          {!isLoading && user ? (
            <>
              <div className="nav-group nav-workspace-links">
                <NavLink
                  className={primaryActionClass}
                  to={dashboardPath}
                  onClick={() => setIsMenuOpen(false)}
                >
                  Dashboard
                </NavLink>
                {workspaceLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    className={navLinkClass}
                    to={link.to}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
              <div className="nav-group nav-auth-links">
                <button
                  className="nav-action nav-action-quiet"
                  type="button"
                  onClick={handleLogout}
                >
                  Log out
                </button>
              </div>
            </>
          ) : (
            !isLoading && (
              <div className="nav-group nav-auth-links">
                <NavLink
                  className={navLinkClass}
                  to="/login"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Login
                </NavLink>
                <NavLink
                  className={primaryActionClass}
                  to="/signup"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign Up
                </NavLink>
              </div>
            )
          )}
        </div>
      </div>
    </nav>
  )
}

import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'

const publicLinks = [
  { to: '/', label: 'Home' },
  { to: '/for-employers', label: 'For Employers' },
  { to: '/how-it-works', label: 'How It Works' },
]

export function Navbar() {
  const { user, isLoading, logout } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)

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
    <nav className={`navbar${isScrolled ? ' scrolled' : ''}`}>
      <div className="nav-container">
        <div className="logo">
          <Link to="/" onClick={() => setIsMenuOpen(false)}>
            HireMe
          </Link>
        </div>
        <button
          type="button"
          className={`menu-toggle${isMenuOpen ? ' active' : ''}`}
          aria-label="Toggle navigation"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>
        <ul className={`nav-menu${isMenuOpen ? ' active' : ''}`}>
          {publicLinks.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === '/'}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </NavLink>
            </li>
          ))}
          {!isLoading && user ? (
            <>
              {user.role === 'candidate' && (
                <li>
                  <NavLink
                    to="/applications"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    My Applications
                  </NavLink>
                </li>
              )}
              {user.role === 'candidate' && (
                <li>
                  <NavLink
                    to="/profile"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Profile
                  </NavLink>
                </li>
              )}
              {user.role === 'employer' && (
                <li>
                  <NavLink
                    to="/employer/company"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Company
                  </NavLink>
                </li>
              )}
              {user.role === 'admin' && (
                <li>
                  <NavLink
                    to="/admin/verifications"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Verifications
                  </NavLink>
                </li>
              )}
              <li>
                <button
                  className="nav-action"
                  type="button"
                  onClick={handleLogout}
                >
                  Log out
                </button>
              </li>
            </>
          ) : (
            !isLoading && (
              <>
                <li>
                  <NavLink
                    to="/login"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Login
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/signup"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Sign Up
                  </NavLink>
                </li>
              </>
            )
          )}
        </ul>
      </div>
    </nav>
  )
}

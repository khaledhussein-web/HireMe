import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-col">
            <h4>HireMe</h4>
            <p>Connecting talent with opportunity since 2024.</p>
          </div>
          <div className="footer-col">
            <h4>For Job Seekers</h4>
            <ul>
              <li>
                <Link to="/">Browse Jobs</Link>
              </li>
              <li>
                <Link to="/how-it-works">How It Works</Link>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>For Employers</h4>
            <ul>
              <li>
                <Link to="/for-employers">Post a Job</Link>
              </li>
              <li>
                <Link to="/for-employers">Pricing</Link>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Account</h4>
            <ul>
              <li>
                <Link to="/login">Log In</Link>
              </li>
              <li>
                <Link to="/signup">Create Account</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2026 HireMe. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

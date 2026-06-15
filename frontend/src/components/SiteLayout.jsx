import { Outlet } from 'react-router-dom'
import { Footer } from './Footer.jsx'
import { Navbar } from './Navbar.jsx'

export function SiteLayout() {
  return (
    <>
      <Navbar />
      <main>
        <Outlet />
      </main>
      <Footer />
    </>
  )
}

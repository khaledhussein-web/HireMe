import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute.jsx'
import { SiteLayout } from './components/SiteLayout.jsx'
import { AuthProvider } from './context/AuthProvider.jsx'
import { HomePage } from './pages/HomePage.jsx'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.jsx'
import { AdminVerificationsPage } from './pages/AdminVerificationsPage.jsx'
import { EmployerCompanyPage } from './pages/EmployerCompanyPage.jsx'
import { EmployerRegisterPage } from './pages/EmployerRegisterPage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { MigrationPage } from './pages/MigrationPage.jsx'
import { ProfilePage } from './pages/ProfilePage.jsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx'
import { SignupPage } from './pages/SignupPage.jsx'
import { VerifyEmailPage } from './pages/VerifyEmailPage.jsx'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/for-employers"
              element={<EmployerRegisterPage />}
            />
            <Route
              path="/employer/company"
              element={
                <ProtectedRoute roles={['employer']}>
                  <EmployerCompanyPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/verifications"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminVerificationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/how-it-works"
              element={<MigrationPage title="How It Works" />}
            />
            <Route
              path="/apply"
              element={
                <ProtectedRoute requireCompleteProfile>
                  <MigrationPage title="Apply" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/applications"
              element={
                <ProtectedRoute requireCompleteProfile>
                  <MigrationPage title="My Applications" />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

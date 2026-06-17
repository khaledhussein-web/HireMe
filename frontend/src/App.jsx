import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute.jsx'
import { SiteLayout } from './components/SiteLayout.jsx'
import { AuthProvider } from './context/AuthProvider.jsx'
import { HomePage } from './pages/HomePage.jsx'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.jsx'
import { AdminVerificationsPage } from './pages/AdminVerificationsPage.jsx'
import { ApplicationsPage } from './pages/ApplicationsPage.jsx'
import { ApplyPage } from './pages/ApplyPage.jsx'
import { EmployerCompanyPage } from './pages/EmployerCompanyPage.jsx'
import { EmployerDashboardPage } from './pages/EmployerDashboardPage.jsx'
import { EmployerRegisterPage } from './pages/EmployerRegisterPage.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { MigrationPage } from './pages/MigrationPage.jsx'
import { ProfilePage } from './pages/ProfilePage.jsx'
import { RecommendationsPage } from './pages/RecommendationsPage.jsx'
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx'
import { SignupPage } from './pages/SignupPage.jsx'
import { VerifyEmailPage } from './pages/VerifyEmailPage.jsx'
import { CheckEmailPage } from './pages/CheckEmailPage.jsx'
import { CandidateOnboardingPage } from './pages/CandidateOnboardingPage.jsx'
import { EmployerOnboardingPage } from './pages/EmployerOnboardingPage.jsx'
import { CommunityOnboardingPage } from './pages/CommunityOnboardingPage.jsx'
import { CandidateDashboardPage } from './pages/CandidateDashboardPage.jsx'
import { CommunityDashboardPage } from './pages/CommunityDashboardPage.jsx'
import { AdminDashboardPage } from './pages/AdminDashboardPage.jsx'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/check-email" element={<CheckEmailPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/onboarding/candidate"
              element={
                <ProtectedRoute roles={['candidate']} onboardingOnly>
                  <CandidateOnboardingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/onboarding/employer"
              element={
                <ProtectedRoute roles={['employer']} onboardingOnly>
                  <EmployerOnboardingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/onboarding/community"
              element={
                <ProtectedRoute roles={['tech_community']} onboardingOnly>
                  <CommunityOnboardingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/candidate/dashboard"
              element={
                <ProtectedRoute roles={['candidate']}>
                  <CandidateDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/community/dashboard"
              element={
                <ProtectedRoute roles={['tech_community']}>
                  <CommunityDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/dashboard"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute roles={['candidate']}>
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
                <ProtectedRoute roles={['candidate']}>
                  <ApplyPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/applications"
              element={
                <ProtectedRoute roles={['candidate']}>
                  <ApplicationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/recommendations"
              element={
                <ProtectedRoute roles={['candidate']}>
                  <RecommendationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/employer/dashboard"
              element={
                <ProtectedRoute roles={['employer']}>
                  <EmployerDashboardPage />
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

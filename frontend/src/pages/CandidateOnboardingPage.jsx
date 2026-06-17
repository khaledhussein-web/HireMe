import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadCandidateResume } from '../api/auth.js'
import {
  getCandidateOnboarding,
  saveCandidateOnboarding,
  uploadProfileImage,
} from '../api/onboarding.js'
import { OnboardingShell } from '../components/OnboardingShell.jsx'
import { useAuth } from '../hooks/useAuth.js'

const steps = ['About you', 'Education', 'Career', 'Links', 'CV and skills']
const emptyForm = {
  phone: '',
  country: '',
  city: '',
  headline: '',
  bio: '',
  educationLevel: '',
  university: '',
  major: '',
  graduationYear: '',
  experienceLevel: '',
  preferredWorkTypesText: '',
  preferredJobCategoriesText: '',
  preferredLocationsText: '',
  githubUrl: '',
  linkedinUrl: '',
  portfolioUrl: '',
  technicalSkillsText: '',
  softSkillsText: '',
  languagesText: '',
}

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export function CandidateOnboardingPage() {
  const navigate = useNavigate()
  const { refreshUser, updateUser } = useAuth()
  const [form, setForm] = useState(emptyForm)
  const [step, setStep] = useState(1)
  const [completion, setCompletion] = useState({ percentage: 0 })
  const [photo, setPhoto] = useState(null)
  const [resume, setResume] = useState(null)
  const [resumeName, setResumeName] = useState('')
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    getCandidateOnboarding()
      .then(({ profile, completion: nextCompletion }) => {
        if (profile) {
          setForm({
            ...emptyForm,
            ...profile,
            graduationYear: profile.graduationYear ?? '',
            preferredWorkTypesText: (profile.preferredWorkTypes ?? []).join(', '),
            preferredJobCategoriesText: (profile.preferredJobCategories ?? []).join(', '),
            preferredLocationsText: (profile.preferredLocations ?? []).join(', '),
            technicalSkillsText: (profile.technicalSkills ?? []).join(', '),
            softSkillsText: (profile.softSkills ?? []).join(', '),
            languagesText: (profile.languages ?? []).join(', '),
          })
          setResumeName(profile.resumeFilename ?? '')
        }
        setCompletion(nextCompletion)
        setStep(Math.min(profile?.onboardingStep ?? 1, steps.length))
      })
      .catch((error) => setMessage({ type: 'error', text: error.message }))
      .finally(() => setIsLoading(false))
  }, [])

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function save({ leave = false } = {}) {
    setIsSubmitting(true)
    setMessage(null)
    try {
      const payload = {
        ...form,
        onboardingStep: leave ? step : Math.min(step + 1, steps.length),
        preferredWorkTypes: list(form.preferredWorkTypesText),
        preferredJobCategories: list(form.preferredJobCategoriesText),
        preferredLocations: list(form.preferredLocationsText),
        technicalSkills: list(form.technicalSkillsText),
        softSkills: list(form.softSkillsText),
        languages: list(form.languagesText),
      }
      let data = await saveCandidateOnboarding(payload)
      if (photo) {
        data = await uploadProfileImage('candidate', photo)
        setPhoto(null)
      }
      if (resume) {
        data = await uploadCandidateResume(resume)
        setResumeName(data.resume.resumeFilename)
        setResume(null)
      }
      if (data.user) updateUser(data.user)
      setCompletion(data.completion ?? completion)

      if (leave) {
        await refreshUser()
        navigate('/candidate/dashboard')
      } else if (step < steps.length) {
        setStep((current) => current + 1)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        const user = await refreshUser()
        navigate(user.nextRoute, { replace: true })
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) return <section className="route-loading">Loading onboarding...</section>

  return (
    <OnboardingShell
      eyebrow="Candidate onboarding"
      title="Build a profile employers can trust"
      subtitle="Your progress is saved after every step."
      steps={steps}
      step={step}
      completion={completion}
      message={message}
      isSubmitting={isSubmitting}
      onBack={() => setStep((current) => current - 1)}
      onContinue={() => save()}
      onSaveLater={() => save({ leave: true })}
    >
      <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
        {step === 1 && (
          <>
            <div className="auth-field-grid">
              <label><span>Phone</span><input name="phone" value={form.phone ?? ''} onChange={updateField} /></label>
              <label><span>Profile photo</span><input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={(event) => setPhoto(event.target.files[0] ?? null)} /></label>
              <label><span>Country</span><input name="country" value={form.country ?? ''} onChange={updateField} /></label>
              <label><span>City</span><input name="city" value={form.city ?? ''} onChange={updateField} /></label>
            </div>
            <label><span>Professional headline</span><input name="headline" value={form.headline ?? ''} onChange={updateField} /></label>
            <label><span>Short bio</span><textarea name="bio" value={form.bio ?? ''} onChange={updateField} /></label>
          </>
        )}
        {step === 2 && (
          <div className="auth-field-grid">
            <label><span>Education level</span><input name="educationLevel" value={form.educationLevel ?? ''} placeholder="Bachelor's degree" onChange={updateField} /></label>
            <label><span>University</span><input name="university" value={form.university ?? ''} onChange={updateField} /></label>
            <label><span>Major</span><input name="major" value={form.major ?? ''} onChange={updateField} /></label>
            <label><span>Graduation year</span><input type="number" min="1950" max="2100" name="graduationYear" value={form.graduationYear} onChange={updateField} /></label>
          </div>
        )}
        {step === 3 && (
          <>
            <label><span>Experience level</span><select name="experienceLevel" value={form.experienceLevel ?? ''} onChange={updateField}><option value="">Select</option><option value="student">Student</option><option value="internship">Internship</option><option value="entry_level">Entry level</option><option value="mid_level">Mid level</option><option value="senior_level">Senior level</option></select></label>
            <label><span>Preferred work types</span><input name="preferredWorkTypesText" value={form.preferredWorkTypesText} placeholder="Full time, Internship, Contract" onChange={updateField} /></label>
            <label><span>Job categories</span><input name="preferredJobCategoriesText" value={form.preferredJobCategoriesText} placeholder="Frontend, Data, Design" onChange={updateField} /></label>
            <label><span>Preferred locations</span><input name="preferredLocationsText" value={form.preferredLocationsText} placeholder="Beirut, Remote" onChange={updateField} /></label>
          </>
        )}
        {step === 4 && (
          <>
            <label><span>GitHub URL</span><input type="url" name="githubUrl" value={form.githubUrl ?? ''} placeholder="https://" onChange={updateField} /></label>
            <label><span>LinkedIn URL</span><input type="url" name="linkedinUrl" value={form.linkedinUrl ?? ''} placeholder="https://" onChange={updateField} /></label>
            <label><span>Portfolio URL</span><input type="url" name="portfolioUrl" value={form.portfolioUrl ?? ''} placeholder="https://" onChange={updateField} /></label>
          </>
        )}
        {step === 5 && (
          <>
            <div className="resume-field">
              <span className="field-label">Resume / CV</span>
              <input type="file" accept=".pdf,.doc,.docx" onChange={(event) => setResume(event.target.files[0] ?? null)} />
              <small>{resume?.name ?? resumeName ?? 'PDF, DOC, or DOCX up to 5 MB.'}</small>
              {resumeName && <a className="btn btn-secondary" href="/api/auth/profile/resume">Download current CV</a>}
            </div>
            <label><span>Technical skills</span><input name="technicalSkillsText" value={form.technicalSkillsText} placeholder="React, SQL, Figma" onChange={updateField} /></label>
            <label><span>Soft skills</span><input name="softSkillsText" value={form.softSkillsText} placeholder="Communication, teamwork" onChange={updateField} /></label>
            <label><span>Languages</span><input name="languagesText" value={form.languagesText} placeholder="Arabic, English, French" onChange={updateField} /></label>
          </>
        )}
      </form>
    </OnboardingShell>
  )
}

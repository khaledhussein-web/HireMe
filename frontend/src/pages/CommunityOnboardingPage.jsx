import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCommunityOnboarding,
  saveCommunityOnboarding,
  uploadProfileImage,
} from '../api/onboarding.js'
import { OnboardingShell } from '../components/OnboardingShell.jsx'
import { useAuth } from '../hooks/useAuth.js'

const steps = ['Community', 'Location', 'Tracks', 'Contact']
const initial = {
  communityName: '', description: '', category: '', universityName: '',
  websiteUrl: '', country: '', city: '', contactEmail: '', technicalTracks: [],
}

export function CommunityOnboardingPage() {
  const navigate = useNavigate()
  const { refreshUser, updateUser } = useAuth()
  const [form, setForm] = useState(initial)
  const [tracks, setTracks] = useState([])
  const [step, setStep] = useState(1)
  const [completion, setCompletion] = useState({ percentage: 0 })
  const [logo, setLogo] = useState(null)
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    getCommunityOnboarding()
      .then(({ profile, completion: value, availableTracks }) => {
        if (profile) setForm((current) => ({ ...current, ...profile }))
        setTracks(availableTracks)
        setCompletion(value)
        setStep(Math.min(profile?.onboardingStep ?? 1, steps.length))
      })
      .catch((error) => setMessage({ type: 'error', text: error.message }))
      .finally(() => setIsLoading(false))
  }, [])

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function toggleTrack(track) {
    setForm((current) => ({
      ...current,
      technicalTracks: current.technicalTracks.includes(track)
        ? current.technicalTracks.filter((item) => item !== track)
        : [...current.technicalTracks, track],
    }))
  }

  async function save({ leave = false } = {}) {
    setIsSubmitting(true)
    setMessage(null)
    try {
      let data = await saveCommunityOnboarding({
        ...form,
        onboardingStep: leave ? step : Math.min(step + 1, steps.length),
        submit: step === steps.length && !leave,
      })
      if (logo) data = await uploadProfileImage('tech_community', logo)
      if (data.user) updateUser(data.user)
      setCompletion(data.completion ?? completion)
      if (leave) {
        await refreshUser()
        navigate('/community/dashboard')
      } else if (step < steps.length) {
        setStep((value) => value + 1)
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
      eyebrow="Tech community onboarding" title="Create your community profile"
      subtitle="Help candidates discover your university club, meetup, or technical network."
      steps={steps} step={step} completion={completion} message={message}
      isSubmitting={isSubmitting} finalLabel="Submit for review"
      onBack={() => setStep((value) => value - 1)}
      onContinue={() => save()} onSaveLater={() => save({ leave: true })}
    >
      <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
        {step === 1 && <><label><span>Community name</span><input name="communityName" value={form.communityName ?? ''} onChange={update} /></label><div className="auth-field-grid"><label><span>Category</span><input name="category" value={form.category ?? ''} placeholder="University club, meetup..." onChange={update} /></label><label><span>University, if applicable</span><input name="universityName" value={form.universityName ?? ''} onChange={update} /></label></div><label><span>Description</span><textarea name="description" value={form.description ?? ''} onChange={update} /></label></>}
        {step === 2 && <div className="auth-field-grid"><label><span>Country</span><input name="country" value={form.country ?? ''} onChange={update} /></label><label><span>City</span><input name="city" value={form.city ?? ''} onChange={update} /></label><label><span>Community logo</span><input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={(event) => setLogo(event.target.files[0] ?? null)} /></label></div>}
        {step === 3 && <div className="choice-grid">{tracks.map((track) => <label className="choice-card" key={track}><input type="checkbox" checked={form.technicalTracks.includes(track)} onChange={() => toggleTrack(track)} />{track}</label>)}</div>}
        {step === 4 && <><label><span>Contact email</span><input type="email" name="contactEmail" value={form.contactEmail ?? ''} onChange={update} /></label><label><span>Website or social link</span><input type="url" name="websiteUrl" value={form.websiteUrl ?? ''} placeholder="https://" onChange={update} /></label><p className="form-help">Your dashboard remains available while the profile is under review.</p></>}
      </form>
    </OnboardingShell>
  )
}

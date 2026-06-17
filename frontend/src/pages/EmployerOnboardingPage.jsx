import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadCompanyDocument } from '../api/employers.js'
import {
  getEmployerOnboarding,
  saveEmployerOnboarding,
  uploadProfileImage,
} from '../api/onboarding.js'
import { OnboardingShell } from '../components/OnboardingShell.jsx'
import { useAuth } from '../hooks/useAuth.js'

const steps = ['Company', 'Location', 'Contact', 'Verification']
const initial = {
  name: '', description: '', industry: '', websiteUrl: '', companySize: '',
  country: '', city: '', contactEmail: '', contactPhone: '',
  registrationNumber: '',
}

export function EmployerOnboardingPage() {
  const navigate = useNavigate()
  const { refreshUser, updateUser } = useAuth()
  const [form, setForm] = useState(initial)
  const [step, setStep] = useState(1)
  const [completion, setCompletion] = useState({ percentage: 0 })
  const [logo, setLogo] = useState(null)
  const [document, setDocument] = useState(null)
  const [documentType, setDocumentType] = useState('business_registration')
  const [message, setMessage] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    getEmployerOnboarding()
      .then(({ profile, completion: value }) => {
        if (profile) setForm((current) => ({ ...current, ...profile }))
        setCompletion(value)
        setStep(Math.min(profile?.onboardingStep ?? 1, steps.length))
      })
      .catch((error) => setMessage({ type: 'error', text: error.message }))
      .finally(() => setIsLoading(false))
  }, [])

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function save({ leave = false } = {}) {
    setIsSubmitting(true)
    setMessage(null)
    try {
      let data = await saveEmployerOnboarding({
        ...form,
        onboardingStep: leave ? step : Math.min(step + 1, steps.length),
        submit: false,
      })
      if (logo) data = await uploadProfileImage('employer', logo)
      if (document) await uploadCompanyDocument(documentType, document)
      if (step === steps.length && !leave) {
        data = await saveEmployerOnboarding({
          ...form,
          onboardingStep: steps.length,
          submit: true,
        })
      }
      if (data.user) updateUser(data.user)
      setCompletion(data.completion ?? completion)
      if (leave) {
        await refreshUser()
        navigate('/employer/dashboard')
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
      eyebrow="Employer onboarding" title="Introduce your company"
      subtitle="Complete the profile, upload evidence, and submit it for admin review."
      steps={steps} step={step} completion={completion} message={message}
      isSubmitting={isSubmitting} finalLabel="Submit for review"
      onBack={() => setStep((value) => value - 1)}
      onContinue={() => save()} onSaveLater={() => save({ leave: true })}
    >
      <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
        {step === 1 && <>
          <label><span>Company name</span><input name="name" value={form.name ?? ''} onChange={update} /></label>
          <div className="auth-field-grid"><label><span>Industry</span><input name="industry" value={form.industry ?? ''} onChange={update} /></label><label><span>Company size</span><input name="companySize" value={form.companySize ?? ''} placeholder="11-50" onChange={update} /></label></div>
          <label><span>Description</span><textarea name="description" value={form.description ?? ''} onChange={update} /></label>
          <label><span>Website</span><input type="url" name="websiteUrl" value={form.websiteUrl ?? ''} placeholder="https://" onChange={update} /></label>
        </>}
        {step === 2 && <div className="auth-field-grid"><label><span>Country</span><input name="country" value={form.country ?? ''} onChange={update} /></label><label><span>City</span><input name="city" value={form.city ?? ''} onChange={update} /></label><label><span>Company logo</span><input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={(event) => setLogo(event.target.files[0] ?? null)} /></label></div>}
        {step === 3 && <><div className="auth-field-grid"><label><span>Business email</span><input type="email" name="contactEmail" value={form.contactEmail ?? ''} onChange={update} /></label><label><span>Business phone</span><input name="contactPhone" value={form.contactPhone ?? ''} onChange={update} /></label></div><label><span>Registration number</span><input name="registrationNumber" value={form.registrationNumber ?? ''} onChange={update} /></label></>}
        {step === 4 && <><label><span>Document type</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="business_registration">Business registration</option><option value="tax_certificate">Tax certificate</option><option value="owner_identification">Owner identification</option><option value="address_proof">Address proof</option></select></label><label><span>Verification document</span><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setDocument(event.target.files[0] ?? null)} /></label><p className="form-help">You can use the dashboard while review is pending, but publishing jobs remains locked until approval.</p></>}
      </form>
    </OnboardingShell>
  )
}

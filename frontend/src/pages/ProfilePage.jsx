import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { uploadCandidateResume } from '../api/auth.js'
import { uploadProfileImage } from '../api/onboarding.js'
import {
  getCandidatePlatformProfile,
  saveCandidatePlatformProfile,
} from '../api/platform.js'
import { useAuth } from '../hooks/useAuth.js'

const emptyEducation = {
  institutionName: '',
  degree: '',
  fieldOfStudy: '',
  startDate: '',
  endDate: '',
  grade: '',
  description: '',
}
const emptyWork = {
  companyName: '',
  jobTitle: '',
  employmentType: '',
  location: '',
  startDate: '',
  endDate: '',
  isCurrent: false,
  description: '',
}
const emptyCertification = {
  name: '',
  issuer: '',
  issuedOn: '',
  expiresOn: '',
  credentialUrl: '',
}
const emptyProject = {
  name: '',
  description: '',
  projectUrl: '',
  repositoryUrl: '',
  startedAt: '',
  completedAt: '',
}
const emptyProfile = {
  fullName: '',
  email: '',
  phone: '',
  country: '',
  city: '',
  location: '',
  headline: '',
  bio: '',
  yearsExperience: 0,
  educationLevel: '',
  experienceLevel: '',
  desiredRolesText: '',
  preferredWorkTypesText: '',
  preferredJobCategoriesText: '',
  preferredLocationsText: '',
  technicalSkillsText: '',
  softSkillsText: '',
  languagesText: '',
  githubUrl: '',
  linkedinUrl: '',
  portfolioUrl: '',
  availabilityStatus: 'open',
  availabilityNotes: '',
  noticePeriodDays: '',
  openToRelocation: false,
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'USD',
  profileVisibility: 'employers',
  resumeId: null,
  resumeFilename: '',
  resumeFileSize: null,
  photoAssetId: null,
  education: [{ ...emptyEducation }],
  workExperience: [{ ...emptyWork }],
  certifications: [{ ...emptyCertification }],
  projects: [{ ...emptyProject }],
}

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

function dateValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function normalizeProfile(profile) {
  return {
    ...emptyProfile,
    ...profile,
    salaryCurrency: profile.salaryCurrency?.trim() || 'USD',
    desiredRolesText: (profile.desiredRoles ?? []).join(', '),
    preferredWorkTypesText: (profile.preferredWorkTypes ?? []).join(', '),
    preferredJobCategoriesText: (
      profile.preferredJobCategories ?? []
    ).join(', '),
    preferredLocationsText: (profile.preferredLocations ?? []).join(', '),
    technicalSkillsText: (profile.technicalSkills ?? []).join(', '),
    softSkillsText: (profile.softSkills ?? []).join(', '),
    languagesText: (profile.languages ?? []).join(', '),
    education:
      profile.education?.length > 0
        ? profile.education.map((item) => ({
            ...emptyEducation,
            ...item,
            startDate: dateValue(item.startDate),
            endDate: dateValue(item.endDate),
          }))
        : [{ ...emptyEducation }],
    workExperience:
      profile.workExperience?.length > 0
        ? profile.workExperience.map((item) => ({
            ...emptyWork,
            ...item,
            startDate: dateValue(item.startDate),
            endDate: dateValue(item.endDate),
          }))
        : [{ ...emptyWork }],
    certifications:
      profile.certifications?.length > 0
        ? profile.certifications.map((item) => ({
            ...emptyCertification,
            ...item,
            issuedOn: dateValue(item.issuedOn),
            expiresOn: dateValue(item.expiresOn),
          }))
        : [{ ...emptyCertification }],
    projects:
      profile.projects?.length > 0
        ? profile.projects.map((item) => ({
            ...emptyProject,
            ...item,
            startedAt: dateValue(item.startedAt),
            completedAt: dateValue(item.completedAt),
          }))
        : [{ ...emptyProject }],
  }
}

function compactRows(rows, requiredKey) {
  return rows.filter((row) => String(row[requiredKey] ?? '').trim())
}

export function ProfilePage() {
  const location = useLocation()
  const { refreshUser, updateUser } = useAuth()
  const [form, setForm] = useState(emptyProfile)
  const [message, setMessage] = useState(
    location.state?.message
      ? { type: 'info', text: location.state.message }
      : null,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resume, setResume] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [isUploadingResume, setIsUploadingResume] = useState(false)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [resumeInputKey, setResumeInputKey] = useState(0)
  const [photoInputKey, setPhotoInputKey] = useState(0)

  useEffect(() => {
    let isActive = true

    getCandidatePlatformProfile()
      .then((data) => {
        if (isActive) setForm(normalizeProfile(data.profile))
      })
      .catch((error) => {
        if (isActive) setMessage({ type: 'error', text: error.message })
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  function updateField(event) {
    const { name, type, checked, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  function updateRow(section, index, field, value) {
    setForm((current) => ({
      ...current,
      [section]: current[section].map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }))
  }

  function addRow(section, emptyRow) {
    setForm((current) => ({
      ...current,
      [section]: [...current[section], { ...emptyRow }],
    }))
  }

  function removeRow(section, index, emptyRow) {
    setForm((current) => {
      const nextRows = current[section].filter((_, itemIndex) => itemIndex !== index)
      return {
        ...current,
        [section]: nextRows.length > 0 ? nextRows : [{ ...emptyRow }],
      }
    })
  }

  async function handlePhotoUpload() {
    if (!photo) return
    setMessage(null)
    setIsUploadingPhoto(true)
    try {
      const data = await uploadProfileImage('candidate', photo)
      setForm((current) => ({
        ...current,
        photoAssetId: data.asset.id,
      }))
      setPhoto(null)
      setPhotoInputKey((current) => current + 1)
      if (data.user) updateUser(data.user)
      else await refreshUser()
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  async function handleResumeUpload() {
    if (!resume) return
    setMessage(null)
    setIsUploadingResume(true)
    try {
      const data = await uploadCandidateResume(resume)
      setForm((current) => ({
        ...current,
        ...data.resume,
        resumeId: data.resume.id,
      }))
      setResume(null)
      setResumeInputKey((current) => current + 1)
      if (data.user) updateUser(data.user)
      else await refreshUser()
      setMessage({ type: 'success', text: data.message })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsUploadingResume(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    try {
      const data = await saveCandidatePlatformProfile({
        ...form,
        yearsExperience: Number(form.yearsExperience),
        salaryMin: form.salaryMin === '' ? null : Number(form.salaryMin),
        salaryMax: form.salaryMax === '' ? null : Number(form.salaryMax),
        noticePeriodDays:
          form.noticePeriodDays === '' ? null : Number(form.noticePeriodDays),
        desiredRoles: list(form.desiredRolesText),
        preferredWorkTypes: list(form.preferredWorkTypesText),
        preferredJobCategories: list(form.preferredJobCategoriesText),
        preferredLocations: list(form.preferredLocationsText),
        technicalSkills: list(form.technicalSkillsText),
        softSkills: list(form.softSkillsText),
        languages: list(form.languagesText),
        education: compactRows(form.education, 'institutionName'),
        workExperience: compactRows(form.workExperience, 'companyName'),
        certifications: compactRows(form.certifications, 'name'),
        projects: compactRows(form.projects, 'name'),
      })
      if (data.user) updateUser(data.user)
      setMessage({ type: 'success', text: data.message })
      await refreshUser()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <section className="route-loading">Loading your profile...</section>
  }

  return (
    <main className="profile-page candidate-profile-page">
      <section className="profile-card candidate-profile-card">
        <div className="workspace-heading">
          <div>
            <p className="auth-eyebrow">Candidate profile</p>
            <h1>Build your professional profile</h1>
            <p>
              This profile powers your recommendations, applications, employer
              discovery, and interview preparation.
            </p>
          </div>
          <span className="status-badge approved">
            {form.completion?.percentage ?? 0}% complete
          </span>
        </div>

        {message && (
          <div className={`auth-message ${message.type}`} role="alert">
            {message.text}
          </div>
        )}

        <form className="auth-form profile-form" onSubmit={handleSubmit}>
          <section className="profile-form-section">
            <h2>Photo and headline</h2>
            <div className="profile-photo-row">
              <div className="profile-avatar">
                {form.photoAssetId ? (
                  <img
                    alt=""
                    src={`/api/onboarding/assets/${form.photoAssetId}`}
                  />
                ) : (
                  <span>{form.fullName?.slice(0, 1) || 'H'}</span>
                )}
              </div>
              <div className="resume-field">
                <span className="field-label">Profile photo</span>
                <input
                  key={photoInputKey}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={(event) => setPhoto(event.target.files[0] ?? null)}
                />
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!photo || isUploadingPhoto}
                  onClick={handlePhotoUpload}
                >
                  {isUploadingPhoto ? 'Uploading...' : 'Upload photo'}
                </button>
              </div>
            </div>
            <div className="auth-field-grid">
              <label>
                <span>Full name</span>
                <input
                  name="fullName"
                  value={form.fullName ?? ''}
                  autoComplete="name"
                  required
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Email</span>
                <input value={form.email ?? ''} disabled />
              </label>
              <label>
                <span>Phone</span>
                <input
                  name="phone"
                  value={form.phone ?? ''}
                  autoComplete="tel"
                  required
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Professional headline</span>
                <input
                  name="headline"
                  value={form.headline ?? ''}
                  placeholder="Frontend developer focused on accessible products"
                  required
                  onChange={updateField}
                />
              </label>
            </div>
            <label>
              <span>Biography</span>
              <textarea
                name="bio"
                value={form.bio ?? ''}
                rows="5"
                onChange={updateField}
              />
            </label>
          </section>

          <section className="profile-form-section">
            <h2>Location and preferences</h2>
            <div className="auth-field-grid">
              <label>
                <span>Country</span>
                <input name="country" value={form.country ?? ''} onChange={updateField} />
              </label>
              <label>
                <span>City</span>
                <input name="city" value={form.city ?? ''} onChange={updateField} />
              </label>
              <label>
                <span>Availability</span>
                <select
                  name="availabilityStatus"
                  value={form.availabilityStatus ?? 'open'}
                  onChange={updateField}
                >
                  <option value="open">Open</option>
                  <option value="interviewing">Interviewing</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label>
                <span>Notice period days</span>
                <input
                  type="number"
                  min="0"
                  max="365"
                  name="noticePeriodDays"
                  value={form.noticePeriodDays ?? ''}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Salary minimum</span>
                <input
                  type="number"
                  min="0"
                  name="salaryMin"
                  value={form.salaryMin ?? ''}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Salary maximum</span>
                <input
                  type="number"
                  min="0"
                  name="salaryMax"
                  value={form.salaryMax ?? ''}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Currency</span>
                <input
                  name="salaryCurrency"
                  value={form.salaryCurrency ?? 'USD'}
                  maxLength="3"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Profile visibility</span>
                <select
                  name="profileVisibility"
                  value={form.profileVisibility ?? 'employers'}
                  onChange={updateField}
                >
                  <option value="private">Private</option>
                  <option value="employers">Verified employers</option>
                  <option value="public">Public</option>
                </select>
              </label>
            </div>
            <label className="candidate-checkbox">
              <input
                type="checkbox"
                name="openToRelocation"
                checked={Boolean(form.openToRelocation)}
                onChange={updateField}
              />
              <span>Open to relocation</span>
            </label>
            <label>
              <span>Availability notes</span>
              <textarea
                name="availabilityNotes"
                value={form.availabilityNotes ?? ''}
                rows="3"
                onChange={updateField}
              />
            </label>
          </section>

          <section className="profile-form-section">
            <h2>Education</h2>
            <div className="auth-field-grid">
              <label>
                <span>Education level</span>
                <input
                  name="educationLevel"
                  value={form.educationLevel ?? ''}
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Experience level</span>
                <select
                  name="experienceLevel"
                  value={form.experienceLevel ?? ''}
                  onChange={updateField}
                >
                  <option value="">Select</option>
                  <option value="student">Student</option>
                  <option value="internship">Internship</option>
                  <option value="entry_level">Entry level</option>
                  <option value="mid_level">Mid level</option>
                  <option value="senior_level">Senior level</option>
                </select>
              </label>
              <label>
                <span>Years of experience</span>
                <input
                  type="number"
                  min="0"
                  max="80"
                  name="yearsExperience"
                  value={form.yearsExperience ?? 0}
                  onChange={updateField}
                />
              </label>
            </div>
            {form.education.map((item, index) => (
              <div className="profile-repeat-card" key={`education-${index}`}>
                <div className="auth-field-grid">
                  <label>
                    <span>Institution</span>
                    <input
                      value={item.institutionName ?? ''}
                      onChange={(event) =>
                        updateRow('education', index, 'institutionName', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Degree</span>
                    <input
                      value={item.degree ?? ''}
                      onChange={(event) =>
                        updateRow('education', index, 'degree', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Field of study</span>
                    <input
                      value={item.fieldOfStudy ?? ''}
                      onChange={(event) =>
                        updateRow('education', index, 'fieldOfStudy', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Grade</span>
                    <input
                      value={item.grade ?? ''}
                      onChange={(event) =>
                        updateRow('education', index, 'grade', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Start date</span>
                    <input
                      type="date"
                      value={item.startDate ?? ''}
                      onChange={(event) =>
                        updateRow('education', index, 'startDate', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>End date</span>
                    <input
                      type="date"
                      value={item.endDate ?? ''}
                      onChange={(event) =>
                        updateRow('education', index, 'endDate', event.target.value)
                      }
                    />
                  </label>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => removeRow('education', index, emptyEducation)}
                >
                  Remove education
                </button>
              </div>
            ))}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => addRow('education', emptyEducation)}
            >
              Add education
            </button>
          </section>

          <section className="profile-form-section">
            <h2>Work experience</h2>
            {form.workExperience.map((item, index) => (
              <div className="profile-repeat-card" key={`work-${index}`}>
                <div className="auth-field-grid">
                  <label>
                    <span>Company</span>
                    <input
                      value={item.companyName ?? ''}
                      onChange={(event) =>
                        updateRow('workExperience', index, 'companyName', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Job title</span>
                    <input
                      value={item.jobTitle ?? ''}
                      onChange={(event) =>
                        updateRow('workExperience', index, 'jobTitle', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Employment type</span>
                    <select
                      value={item.employmentType ?? ''}
                      onChange={(event) =>
                        updateRow('workExperience', index, 'employmentType', event.target.value)
                      }
                    >
                      <option value="">Select</option>
                      <option value="full_time">Full-time</option>
                      <option value="part_time">Part-time</option>
                      <option value="contract">Contract</option>
                      <option value="internship">Internship</option>
                      <option value="temporary">Temporary</option>
                    </select>
                  </label>
                  <label>
                    <span>Location</span>
                    <input
                      value={item.location ?? ''}
                      onChange={(event) =>
                        updateRow('workExperience', index, 'location', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Start date</span>
                    <input
                      type="date"
                      value={item.startDate ?? ''}
                      onChange={(event) =>
                        updateRow('workExperience', index, 'startDate', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>End date</span>
                    <input
                      type="date"
                      value={item.endDate ?? ''}
                      disabled={Boolean(item.isCurrent)}
                      onChange={(event) =>
                        updateRow('workExperience', index, 'endDate', event.target.value)
                      }
                    />
                  </label>
                </div>
                <label className="candidate-checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(item.isCurrent)}
                    onChange={(event) =>
                      updateRow('workExperience', index, 'isCurrent', event.target.checked)
                    }
                  />
                  <span>Current role</span>
                </label>
                <label>
                  <span>Description</span>
                  <textarea
                    value={item.description ?? ''}
                    rows="3"
                    onChange={(event) =>
                      updateRow('workExperience', index, 'description', event.target.value)
                    }
                  />
                </label>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => removeRow('workExperience', index, emptyWork)}
                >
                  Remove experience
                </button>
              </div>
            ))}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => addRow('workExperience', emptyWork)}
            >
              Add work experience
            </button>
          </section>

          <section className="profile-form-section">
            <h2>Skills and links</h2>
            <div className="auth-field-grid">
              <label>
                <span>Desired roles</span>
                <input
                  name="desiredRolesText"
                  value={form.desiredRolesText}
                  placeholder="Frontend developer, Data analyst"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Preferred work types</span>
                <input
                  name="preferredWorkTypesText"
                  value={form.preferredWorkTypesText}
                  placeholder="Full-time, Internship"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Preferred job categories</span>
                <input
                  name="preferredJobCategoriesText"
                  value={form.preferredJobCategoriesText}
                  placeholder="Software, Data, Design"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Preferred locations</span>
                <input
                  name="preferredLocationsText"
                  value={form.preferredLocationsText}
                  placeholder="Beirut, Remote"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Technical skills</span>
                <input
                  name="technicalSkillsText"
                  value={form.technicalSkillsText}
                  placeholder="React, Node.js, SQL"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Soft skills</span>
                <input
                  name="softSkillsText"
                  value={form.softSkillsText}
                  placeholder="Communication, ownership"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Languages</span>
                <input
                  name="languagesText"
                  value={form.languagesText}
                  placeholder="Arabic, English, French"
                  onChange={updateField}
                />
              </label>
              <label>
                <span>GitHub URL</span>
                <input
                  type="url"
                  name="githubUrl"
                  value={form.githubUrl ?? ''}
                  placeholder="https://github.com/..."
                  onChange={updateField}
                />
              </label>
              <label>
                <span>LinkedIn URL</span>
                <input
                  type="url"
                  name="linkedinUrl"
                  value={form.linkedinUrl ?? ''}
                  placeholder="https://linkedin.com/in/..."
                  onChange={updateField}
                />
              </label>
              <label>
                <span>Portfolio URL</span>
                <input
                  type="url"
                  name="portfolioUrl"
                  value={form.portfolioUrl ?? ''}
                  placeholder="https://"
                  onChange={updateField}
                />
              </label>
            </div>
          </section>

          <section className="profile-form-section">
            <h2>Certifications</h2>
            {form.certifications.map((item, index) => (
              <div className="profile-repeat-card" key={`certification-${index}`}>
                <div className="auth-field-grid">
                  <label>
                    <span>Name</span>
                    <input
                      value={item.name ?? ''}
                      onChange={(event) =>
                        updateRow('certifications', index, 'name', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Issuer</span>
                    <input
                      value={item.issuer ?? ''}
                      onChange={(event) =>
                        updateRow('certifications', index, 'issuer', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Issued on</span>
                    <input
                      type="date"
                      value={item.issuedOn ?? ''}
                      onChange={(event) =>
                        updateRow('certifications', index, 'issuedOn', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Expires on</span>
                    <input
                      type="date"
                      value={item.expiresOn ?? ''}
                      onChange={(event) =>
                        updateRow('certifications', index, 'expiresOn', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Credential URL</span>
                    <input
                      type="url"
                      value={item.credentialUrl ?? ''}
                      onChange={(event) =>
                        updateRow('certifications', index, 'credentialUrl', event.target.value)
                      }
                    />
                  </label>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    removeRow('certifications', index, emptyCertification)
                  }
                >
                  Remove certification
                </button>
              </div>
            ))}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => addRow('certifications', emptyCertification)}
            >
              Add certification
            </button>
          </section>

          <section className="profile-form-section">
            <h2>Projects and portfolio</h2>
            {form.projects.map((item, index) => (
              <div className="profile-repeat-card" key={`project-${index}`}>
                <div className="auth-field-grid">
                  <label>
                    <span>Project name</span>
                    <input
                      value={item.name ?? ''}
                      onChange={(event) =>
                        updateRow('projects', index, 'name', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Project URL</span>
                    <input
                      type="url"
                      value={item.projectUrl ?? ''}
                      onChange={(event) =>
                        updateRow('projects', index, 'projectUrl', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Repository URL</span>
                    <input
                      type="url"
                      value={item.repositoryUrl ?? ''}
                      onChange={(event) =>
                        updateRow('projects', index, 'repositoryUrl', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Started</span>
                    <input
                      type="date"
                      value={item.startedAt ?? ''}
                      onChange={(event) =>
                        updateRow('projects', index, 'startedAt', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Completed</span>
                    <input
                      type="date"
                      value={item.completedAt ?? ''}
                      onChange={(event) =>
                        updateRow('projects', index, 'completedAt', event.target.value)
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>Description</span>
                  <textarea
                    value={item.description ?? ''}
                    rows="3"
                    onChange={(event) =>
                      updateRow('projects', index, 'description', event.target.value)
                    }
                  />
                </label>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => removeRow('projects', index, emptyProject)}
                >
                  Remove project
                </button>
              </div>
            ))}
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => addRow('projects', emptyProject)}
            >
              Add project
            </button>
          </section>

          <section className="profile-form-section">
            <h2>CV upload</h2>
            <div className="resume-field">
              <span className="field-label">Resume / CV</span>
              <input
                key={resumeInputKey}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => setResume(event.target.files[0] ?? null)}
              />
              <div className="resume-field-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!resume || isUploadingResume}
                  onClick={handleResumeUpload}
                >
                  {isUploadingResume ? 'Uploading...' : 'Upload CV'}
                </button>
                {form.resumeId && (
                  <a className="btn btn-secondary" href="/api/auth/profile/resume">
                    Download current CV
                  </a>
                )}
              </div>
              <small>
                {form.resumeId
                  ? `${form.resumeFilename} (${Math.ceil((form.resumeFileSize ?? 0) / 1024)} KB)`
                  : 'PDF, DOC, or DOCX. Maximum size: 5 MB.'}
              </small>
            </div>
          </section>

          <button
            className="btn btn-primary auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving profile...' : 'Save candidate profile'}
          </button>
        </form>
      </section>
    </main>
  )
}

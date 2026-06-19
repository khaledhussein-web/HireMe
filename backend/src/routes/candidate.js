import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { writeAuditLog } from '../services/audit.js'
import { publicUser } from '../services/auth.js'
import {
  getAuthUserState,
  getProfileCompletion,
  persistCompletion,
} from '../services/profileCompletion.js'

export const candidateRouter = Router()

candidateRouter.use(requireAuth, requireRole('candidate'))

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function optionalText(value, maxLength = 500) {
  const text = cleanText(value, maxLength)
  return text || null
}

function textArray(value, maxItems = 30, maxLength = 100) {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((item) => cleanText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems),
    ),
  ]
}

function optionalInteger(value, { min = 0, max = 1000000 } = {}) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) return null
  return number
}

function optionalDate(value) {
  const text = cleanText(value, 20)
  if (!text) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function validUrl(value) {
  const text = optionalText(value, 500)
  if (!text) return null
  const url = new URL(text)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  return url.toString()
}

function slugForSkill(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

async function saveSkillGroup(client, profileId, category, names) {
  await client.query(
    `
      DELETE FROM candidate_skills
      USING skills
      WHERE candidate_skills.skill_id = skills.id
        AND candidate_skills.candidate_profile_id = $1
        AND COALESCE(skills.category, 'technical') = $2
    `,
    [profileId, category],
  )

  for (const name of names) {
    const slug = slugForSkill(name)
    if (!slug) continue

    const { rows } = await client.query(
      `
        INSERT INTO skills (name, slug, category)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          deleted_at = NULL
        RETURNING id
      `,
      [name, slug, category],
    )
    await client.query(
      `
        INSERT INTO candidate_skills (candidate_profile_id, skill_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [profileId, rows[0].id],
    )
  }
}

async function replaceRows(client, table, profileId, rows, mapper) {
  await client.query(
    `UPDATE ${table} SET deleted_at = NOW() WHERE candidate_profile_id = $1`,
    [profileId],
  )

  for (const item of rows) {
    await mapper(item)
  }
}

async function candidateProfileId(client, userId) {
  const { rows } = await client.query(
    `
      SELECT id
      FROM candidate_profiles
      WHERE user_id = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )
  return rows[0]?.id ?? null
}

async function loadCandidateProfile(client, userId) {
  const { rows } = await client.query(
    `
      SELECT
        users.full_name AS "fullName",
        users.email,
        candidate_profiles.id,
        candidate_profiles.phone,
        candidate_profiles.location,
        candidate_profiles.country,
        candidate_profiles.city,
        candidate_profiles.headline,
        candidate_profiles.bio,
        candidate_profiles.years_experience AS "yearsExperience",
        candidate_profiles.education_level AS "educationLevel",
        candidate_profiles.experience_level AS "experienceLevel",
        candidate_profiles.desired_roles AS "desiredRoles",
        candidate_profiles.preferred_workplace AS "preferredWorkplace",
        candidate_profiles.preferred_work_types AS "preferredWorkTypes",
        candidate_profiles.preferred_job_categories AS "preferredJobCategories",
        candidate_profiles.preferred_locations AS "preferredLocations",
        candidate_profiles.github_url AS "githubUrl",
        candidate_profiles.linkedin_url AS "linkedinUrl",
        candidate_profiles.portfolio_url AS "portfolioUrl",
        candidate_profiles.availability_status AS "availabilityStatus",
        candidate_profiles.availability_notes AS "availabilityNotes",
        candidate_profiles.notice_period_days AS "noticePeriodDays",
        candidate_profiles.open_to_relocation AS "openToRelocation",
        candidate_profiles.salary_min AS "salaryMin",
        candidate_profiles.salary_max AS "salaryMax",
        candidate_profiles.salary_currency AS "salaryCurrency",
        candidate_profiles.profile_visibility AS "profileVisibility",
        profile_assets.id AS "photoAssetId",
        candidate_resumes.id AS "resumeId",
        candidate_resumes.original_filename AS "resumeFilename",
        candidate_resumes.file_size AS "resumeFileSize",
        candidate_resumes.updated_at AS "resumeUpdatedAt"
      FROM users
      LEFT JOIN candidate_profiles
        ON candidate_profiles.user_id = users.id
        AND candidate_profiles.deleted_at IS NULL
      LEFT JOIN profile_assets
        ON profile_assets.user_id = users.id
        AND profile_assets.asset_type = 'candidate_photo'
      LEFT JOIN candidate_resumes
        ON candidate_resumes.candidate_profile_id = candidate_profiles.id
      WHERE users.id = $1
        AND users.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )
  const profile = rows[0]
  if (!profile) return null

  if (!profile.id) {
    return {
      ...profile,
      desiredRoles: [],
      preferredWorkTypes: [],
      preferredJobCategories: [],
      preferredLocations: [],
      technicalSkills: [],
      softSkills: [],
      languages: [],
      education: [],
      workExperience: [],
      certifications: [],
      projects: [],
    }
  }

  const [
    skillsResult,
    educationResult,
    workResult,
    certificationResult,
    projectResult,
    completion,
  ] = await Promise.all([
    client.query(
      `
        SELECT skills.name, COALESCE(skills.category, 'technical') AS category
        FROM candidate_skills
        JOIN skills ON skills.id = candidate_skills.skill_id
        WHERE candidate_skills.candidate_profile_id = $1
          AND skills.deleted_at IS NULL
        ORDER BY skills.name
      `,
      [profile.id],
    ),
    client.query(
      `
        SELECT
          id,
          institution_name AS "institutionName",
          degree,
          field_of_study AS "fieldOfStudy",
          start_date AS "startDate",
          end_date AS "endDate",
          grade,
          description
        FROM education
        WHERE candidate_profile_id = $1 AND deleted_at IS NULL
        ORDER BY end_date DESC NULLS FIRST, id DESC
      `,
      [profile.id],
    ),
    client.query(
      `
        SELECT
          id,
          company_name AS "companyName",
          job_title AS "jobTitle",
          employment_type AS "employmentType",
          location,
          start_date AS "startDate",
          end_date AS "endDate",
          is_current AS "isCurrent",
          description
        FROM work_experience
        WHERE candidate_profile_id = $1 AND deleted_at IS NULL
        ORDER BY start_date DESC, id DESC
      `,
      [profile.id],
    ),
    client.query(
      `
        SELECT
          id,
          name,
          issuer,
          issued_on AS "issuedOn",
          expires_on AS "expiresOn",
          credential_url AS "credentialUrl"
        FROM candidate_certifications
        WHERE candidate_profile_id = $1 AND deleted_at IS NULL
        ORDER BY issued_on DESC NULLS LAST, id DESC
      `,
      [profile.id],
    ),
    client.query(
      `
        SELECT
          id,
          name,
          description,
          project_url AS "projectUrl",
          repository_url AS "repositoryUrl",
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM projects
        WHERE candidate_profile_id = $1 AND deleted_at IS NULL
        ORDER BY completed_at DESC NULLS FIRST, id DESC
      `,
      [profile.id],
    ),
    getProfileCompletion(client, userId, 'candidate'),
  ])

  const byCategory = (category) =>
    skillsResult.rows
      .filter((skill) => skill.category === category)
      .map((skill) => skill.name)

  return {
    ...profile,
    technicalSkills: byCategory('technical'),
    softSkills: byCategory('soft'),
    languages: byCategory('language'),
    education: educationResult.rows,
    workExperience: workResult.rows,
    certifications: certificationResult.rows,
    projects: projectResult.rows,
    completion,
  }
}

function mapJob(row) {
  return {
    ...row,
    isSaved: Boolean(row.isSaved),
  }
}

candidateRouter.get('/profile', async (request, response, next) => {
  try {
    const profile = await loadCandidateProfile(pool, Number(request.auth.sub))
    if (!profile) {
      return response.status(404).json({ message: 'Candidate profile not found.' })
    }
    return response.json({ profile })
  } catch (error) {
    return next(error)
  }
})

candidateRouter.put('/profile', async (request, response, next) => {
  const userId = Number(request.auth.sub)
  const fullName = cleanText(request.body.fullName, 150)
  const phone = optionalText(request.body.phone, 30)
  const country = optionalText(request.body.country, 120)
  const city = optionalText(request.body.city, 120)
  const location = optionalText(
    request.body.location,
    150,
  ) || (city && country ? `${city}, ${country}` : city || country)
  const headline = optionalText(request.body.headline, 180)
  const bio = optionalText(request.body.bio, 5000)
  const yearsExperience = optionalInteger(request.body.yearsExperience, {
    min: 0,
    max: 80,
  }) ?? 0
  const educationLevel = optionalText(request.body.educationLevel, 80)
  const experienceLevel = optionalText(request.body.experienceLevel, 30)
  const availabilityStatus =
    optionalText(request.body.availabilityStatus, 30) ?? 'open'
  const availabilityNotes = optionalText(request.body.availabilityNotes, 1000)
  const noticePeriodDays = optionalInteger(request.body.noticePeriodDays, {
    min: 0,
    max: 365,
  })
  const openToRelocation = Boolean(request.body.openToRelocation)
  const salaryMin = optionalInteger(request.body.salaryMin, {
    min: 0,
    max: 10000000,
  })
  const salaryMax = optionalInteger(request.body.salaryMax, {
    min: 0,
    max: 10000000,
  })
  const salaryCurrencyInput = cleanText(
    request.body.salaryCurrency || 'USD',
    3,
  ).toUpperCase()
  const salaryCurrency = /^[A-Z]{3}$/.test(salaryCurrencyInput)
    ? salaryCurrencyInput
    : 'USD'
  const profileVisibility =
    optionalText(request.body.profileVisibility, 20) ?? 'employers'
  const preferredWorkplace = optionalText(request.body.preferredWorkplace, 20)
  const desiredRoles = textArray(request.body.desiredRoles, 10, 120)
  const preferredWorkTypes = textArray(request.body.preferredWorkTypes, 10, 50)
  const preferredJobCategories = textArray(
    request.body.preferredJobCategories,
    20,
    100,
  )
  const preferredLocations = textArray(request.body.preferredLocations, 20, 100)

  if (fullName.length < 2 || !phone || !location || !headline) {
    return response.status(400).json({
      message: 'Full name, phone, location, and headline are required.',
    })
  }
  if (
    experienceLevel &&
    ![
      'student',
      'internship',
      'entry_level',
      'mid_level',
      'senior_level',
    ].includes(experienceLevel)
  ) {
    return response.status(400).json({ message: 'Select a valid experience level.' })
  }
  if (
    !['open', 'interviewing', 'unavailable'].includes(availabilityStatus) ||
    !['private', 'employers', 'public'].includes(profileVisibility)
  ) {
    return response.status(400).json({ message: 'Invalid profile preference.' })
  }
  if (
    preferredWorkplace &&
    !['remote', 'hybrid', 'on_site'].includes(preferredWorkplace)
  ) {
    return response.status(400).json({ message: 'Select a valid workplace preference.' })
  }
  if (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin) {
    return response.status(400).json({ message: 'Salary maximum must be greater than minimum.' })
  }

  let githubUrl = null
  let linkedinUrl = null
  let portfolioUrl = null
  try {
    githubUrl = validUrl(request.body.githubUrl)
    linkedinUrl = validUrl(request.body.linkedinUrl)
    portfolioUrl = validUrl(request.body.portfolioUrl)
  } catch {
    return response.status(400).json({ message: 'Links must use http or https.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE users SET full_name = $1 WHERE id = $2', [
      fullName,
      userId,
    ])
    const { rows } = await client.query(
      `
        INSERT INTO candidate_profiles (
          user_id,
          phone,
          location,
          country,
          city,
          headline,
          bio,
          years_experience,
          education_level,
          experience_level,
          desired_roles,
          preferred_workplace,
          preferred_work_types,
          preferred_job_categories,
          preferred_locations,
          github_url,
          linkedin_url,
          portfolio_url,
          availability_status,
          availability_notes,
          notice_period_days,
          open_to_relocation,
          salary_min,
          salary_max,
          salary_currency,
          profile_visibility
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
        )
        ON CONFLICT (user_id) DO UPDATE SET
          phone = EXCLUDED.phone,
          location = EXCLUDED.location,
          country = EXCLUDED.country,
          city = EXCLUDED.city,
          headline = EXCLUDED.headline,
          bio = EXCLUDED.bio,
          years_experience = EXCLUDED.years_experience,
          education_level = EXCLUDED.education_level,
          experience_level = EXCLUDED.experience_level,
          desired_roles = EXCLUDED.desired_roles,
          preferred_workplace = EXCLUDED.preferred_workplace,
          preferred_work_types = EXCLUDED.preferred_work_types,
          preferred_job_categories = EXCLUDED.preferred_job_categories,
          preferred_locations = EXCLUDED.preferred_locations,
          github_url = EXCLUDED.github_url,
          linkedin_url = EXCLUDED.linkedin_url,
          portfolio_url = EXCLUDED.portfolio_url,
          availability_status = EXCLUDED.availability_status,
          availability_notes = EXCLUDED.availability_notes,
          notice_period_days = EXCLUDED.notice_period_days,
          open_to_relocation = EXCLUDED.open_to_relocation,
          salary_min = EXCLUDED.salary_min,
          salary_max = EXCLUDED.salary_max,
          salary_currency = EXCLUDED.salary_currency,
          profile_visibility = EXCLUDED.profile_visibility,
          deleted_at = NULL
        RETURNING id
      `,
      [
        userId,
        phone,
        location,
        country,
        city,
        headline,
        bio,
        yearsExperience,
        educationLevel,
        experienceLevel,
        desiredRoles,
        preferredWorkplace,
        preferredWorkTypes,
        preferredJobCategories,
        preferredLocations,
        githubUrl,
        linkedinUrl,
        portfolioUrl,
        availabilityStatus,
        availabilityNotes,
        noticePeriodDays,
        openToRelocation,
        salaryMin,
        salaryMax,
        salaryCurrency,
        profileVisibility,
      ],
    )
    const profileId = rows[0].id

    if (Array.isArray(request.body.education)) {
      await replaceRows(client, 'education', profileId, request.body.education, async (item) => {
        const institutionName = optionalText(item.institutionName, 200)
        if (!institutionName) return
        await client.query(
          `
            INSERT INTO education (
              candidate_profile_id,
              institution_name,
              degree,
              field_of_study,
              start_date,
              end_date,
              grade,
              description
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            profileId,
            institutionName,
            optionalText(item.degree, 150),
            optionalText(item.fieldOfStudy, 150),
            optionalDate(item.startDate),
            optionalDate(item.endDate),
            optionalText(item.grade, 50),
            optionalText(item.description, 1000),
          ],
        )
      })
    }

    if (Array.isArray(request.body.workExperience)) {
      await replaceRows(
        client,
        'work_experience',
        profileId,
        request.body.workExperience,
        async (item) => {
          const companyName = optionalText(item.companyName, 200)
          const jobTitle = optionalText(item.jobTitle, 180)
          const startDate = optionalDate(item.startDate)
          if (!companyName || !jobTitle || !startDate) return
          await client.query(
            `
              INSERT INTO work_experience (
                candidate_profile_id,
                company_name,
                job_title,
                employment_type,
                location,
                start_date,
                end_date,
                is_current,
                description
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `,
            [
              profileId,
              companyName,
              jobTitle,
              item.employmentType || null,
              optionalText(item.location, 150),
              startDate,
              item.isCurrent ? null : optionalDate(item.endDate),
              Boolean(item.isCurrent),
              optionalText(item.description, 1500),
            ],
          )
        },
      )
    }

    if (Array.isArray(request.body.certifications)) {
      await replaceRows(
        client,
        'candidate_certifications',
        profileId,
        request.body.certifications,
        async (item) => {
          const name = optionalText(item.name, 180)
          if (!name) return
          let credentialUrl = null
          try {
            credentialUrl = validUrl(item.credentialUrl)
          } catch {
            credentialUrl = null
          }
          await client.query(
            `
              INSERT INTO candidate_certifications (
                candidate_profile_id,
                name,
                issuer,
                issued_on,
                expires_on,
                credential_url
              )
              VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
              profileId,
              name,
              optionalText(item.issuer, 180),
              optionalDate(item.issuedOn),
              optionalDate(item.expiresOn),
              credentialUrl,
            ],
          )
        },
      )
    }

    if (Array.isArray(request.body.projects)) {
      await replaceRows(client, 'projects', profileId, request.body.projects, async (item) => {
        const name = optionalText(item.name, 180)
        if (!name) return
        let projectUrl = null
        let repositoryUrl = null
        try {
          projectUrl = validUrl(item.projectUrl)
          repositoryUrl = validUrl(item.repositoryUrl)
        } catch {
          projectUrl = null
          repositoryUrl = null
        }
        await client.query(
          `
            INSERT INTO projects (
              candidate_profile_id,
              name,
              description,
              project_url,
              repository_url,
              started_at,
              completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            profileId,
            name,
            optionalText(item.description, 1500),
            projectUrl,
            repositoryUrl,
            optionalDate(item.startedAt),
            optionalDate(item.completedAt),
          ],
        )
      })
    }

    await saveSkillGroup(
      client,
      profileId,
      'technical',
      textArray(request.body.technicalSkills, 40),
    )
    await saveSkillGroup(
      client,
      profileId,
      'soft',
      textArray(request.body.softSkills, 30),
    )
    await saveSkillGroup(
      client,
      profileId,
      'language',
      textArray(request.body.languages, 20),
    )

    const completion = await persistCompletion(client, userId, 'candidate')
    const user = await getAuthUserState(client, userId)
    await writeAuditLog(client, request, {
      action: 'candidate.profile_saved',
      entityType: 'candidate_profile',
      entityId: profileId,
      newValues: { completionPercentage: completion.percentage },
    })
    await client.query('COMMIT')

    return response.json({
      message: 'Candidate profile saved.',
      completion,
      user: publicUser(user),
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

candidateRouter.get('/dashboard', async (request, response, next) => {
  const userId = Number(request.auth.sub)
  try {
    const profileId = await candidateProfileId(pool, userId)
    const [
      completion,
      recommendations,
      recentApplications,
      savedJobs,
      upcomingInterviews,
      notifications,
      profileViews,
    ] = await Promise.all([
      getProfileCompletion(pool, userId, 'candidate'),
      pool.query(
        `
          WITH candidate AS (
            SELECT id, desired_roles, preferred_workplace, years_experience
            FROM candidate_profiles
            WHERE user_id = $1 AND deleted_at IS NULL
          ),
          skill_matches AS (
            SELECT
              jobs.id AS job_id,
              COUNT(DISTINCT skills.id)::INTEGER AS matched_skill_count,
              ARRAY_AGG(skills.name ORDER BY skills.name) AS matched_skills
            FROM candidate
            JOIN candidate_skills
              ON candidate_skills.candidate_profile_id = candidate.id
            JOIN skills ON skills.id = candidate_skills.skill_id
            JOIN jobs
              ON CONCAT_WS(' ', jobs.title, jobs.description, jobs.requirements)
                ILIKE '%' || skills.name || '%'
            GROUP BY jobs.id
          )
          SELECT
            jobs.id,
            jobs.title,
            jobs.slug,
            jobs.employment_type AS "employmentType",
            jobs.workplace_type AS "workplaceType",
            jobs.experience_level AS "experienceLevel",
            jobs.city,
            jobs.country,
            jobs.salary_min AS "salaryMin",
            jobs.salary_max AS "salaryMax",
            jobs.salary_currency AS "salaryCurrency",
            jobs.description,
            companies.name AS company,
            COALESCE(skill_matches.matched_skills, '{}') AS "matchedSkills",
            LEAST(
              100,
              40 + COALESCE(skill_matches.matched_skill_count, 0) * 15
              + CASE WHEN candidate.preferred_workplace = jobs.workplace_type THEN 15 ELSE 0 END
            )::INTEGER AS "matchScore",
            EXISTS (
              SELECT 1 FROM saved_jobs
              WHERE saved_jobs.user_id = $1 AND saved_jobs.job_id = jobs.id
            ) AS "isSaved"
          FROM jobs
          JOIN companies ON companies.id = jobs.company_id
          CROSS JOIN candidate
          LEFT JOIN skill_matches ON skill_matches.job_id = jobs.id
          WHERE jobs.status = 'published'
            AND jobs.deleted_at IS NULL
            AND companies.deleted_at IS NULL
            AND companies.verification_status = 'approved'
            AND (jobs.expires_at IS NULL OR jobs.expires_at >= NOW())
            AND NOT EXISTS (
              SELECT 1
              FROM applications
              WHERE applications.job_id = jobs.id
                AND applications.candidate_user_id = $1
                AND applications.deleted_at IS NULL
            )
          ORDER BY "matchScore" DESC, jobs.published_at DESC
          LIMIT 4
        `,
        [userId],
      ),
      pool.query(
        `
          SELECT
            applications.id,
            applications.status,
            applications.submitted_at AS "submittedAt",
            jobs.title AS "jobTitle",
            jobs.slug AS "jobSlug",
            companies.name AS company
          FROM applications
          JOIN jobs ON jobs.id = applications.job_id
          JOIN companies ON companies.id = jobs.company_id
          WHERE applications.candidate_user_id = $1
            AND applications.deleted_at IS NULL
          ORDER BY applications.submitted_at DESC
          LIMIT 5
        `,
        [userId],
      ),
      pool.query(
        `
          SELECT
            jobs.id,
            jobs.title,
            jobs.slug,
            jobs.employment_type AS "employmentType",
            jobs.workplace_type AS "workplaceType",
            jobs.experience_level AS "experienceLevel",
            jobs.city,
            jobs.country,
            jobs.salary_min AS "salaryMin",
            jobs.salary_max AS "salaryMax",
            jobs.salary_currency AS "salaryCurrency",
            jobs.description,
            companies.name AS company,
            TRUE AS "isSaved",
            saved_jobs.saved_at AS "savedAt"
          FROM saved_jobs
          JOIN jobs ON jobs.id = saved_jobs.job_id
          JOIN companies ON companies.id = jobs.company_id
          WHERE saved_jobs.user_id = $1
            AND jobs.deleted_at IS NULL
            AND companies.deleted_at IS NULL
          ORDER BY saved_jobs.saved_at DESC
          LIMIT 4
        `,
        [userId],
      ),
      pool.query(
        `
          SELECT
            interviews.id,
            interviews.starts_at AS "startsAt",
            interviews.ends_at AS "endsAt",
            interviews.interview_type AS "interviewType",
            interviews.location_or_url AS "locationOrUrl",
            applications.id AS "applicationId",
            jobs.title AS "jobTitle",
            companies.name AS company
          FROM interviews
          JOIN applications ON applications.id = interviews.application_id
          JOIN jobs ON jobs.id = applications.job_id
          JOIN companies ON companies.id = jobs.company_id
          WHERE applications.candidate_user_id = $1
            AND interviews.deleted_at IS NULL
            AND interviews.status IN ('scheduled', 'confirmed')
            AND interviews.starts_at >= NOW()
          ORDER BY interviews.starts_at ASC
          LIMIT 4
        `,
        [userId],
      ),
      pool.query(
        `
          SELECT id, notification_type AS "type", title, body, read_at AS "readAt", created_at AS "createdAt"
          FROM notifications
          WHERE user_id = $1 AND in_app_visible = TRUE AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 6
        `,
        [userId],
      ),
      profileId
        ? pool.query(
            `
              SELECT
                COUNT(*)::INTEGER AS total,
                COUNT(*) FILTER (
                  WHERE viewed_at >= NOW() - INTERVAL '30 days'
                )::INTEGER AS "last30Days"
              FROM candidate_profile_views
              WHERE candidate_profile_id = $1
            `,
            [profileId],
          )
        : Promise.resolve({ rows: [{ total: 0, last30Days: 0 }] }),
    ])

    return response.json({
      completion,
      recommendations: recommendations.rows.map(mapJob),
      recentApplications: recentApplications.rows,
      savedJobs: savedJobs.rows.map(mapJob),
      upcomingInterviews: upcomingInterviews.rows,
      notifications: notifications.rows,
      profileViews: profileViews.rows[0],
    })
  } catch (error) {
    return next(error)
  }
})

candidateRouter.get('/saved-jobs', async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          jobs.id,
          jobs.title,
          jobs.slug,
          jobs.employment_type AS "employmentType",
          jobs.workplace_type AS "workplaceType",
          jobs.experience_level AS "experienceLevel",
          jobs.city,
          jobs.country,
          jobs.salary_min AS "salaryMin",
          jobs.salary_max AS "salaryMax",
          jobs.salary_currency AS "salaryCurrency",
          jobs.description,
          companies.name AS company,
          TRUE AS "isSaved",
          saved_jobs.saved_at AS "savedAt"
        FROM saved_jobs
        JOIN jobs ON jobs.id = saved_jobs.job_id
        JOIN companies ON companies.id = jobs.company_id
        WHERE saved_jobs.user_id = $1
          AND jobs.deleted_at IS NULL
          AND companies.deleted_at IS NULL
        ORDER BY saved_jobs.saved_at DESC
      `,
      [Number(request.auth.sub)],
    )
    return response.json({ jobs: rows.map(mapJob) })
  } catch (error) {
    return next(error)
  }
})

candidateRouter.post('/saved-jobs/:jobId', async (request, response, next) => {
  const jobId = Number(request.params.jobId)
  if (!Number.isInteger(jobId) || jobId < 1) {
    return response.status(400).json({ message: 'Invalid job ID.' })
  }

  try {
    const { rowCount } = await pool.query(
      `
        INSERT INTO saved_jobs (user_id, job_id)
        SELECT $1, jobs.id
        FROM jobs
        JOIN companies ON companies.id = jobs.company_id
        WHERE jobs.id = $2
          AND jobs.status = 'published'
          AND jobs.deleted_at IS NULL
          AND companies.deleted_at IS NULL
          AND companies.verification_status = 'approved'
        ON CONFLICT DO NOTHING
      `,
      [Number(request.auth.sub), jobId],
    )
    if (rowCount === 0) {
      return response.status(404).json({ message: 'Job not found or already saved.' })
    }
    return response.status(201).json({ message: 'Job saved.' })
  } catch (error) {
    return next(error)
  }
})

candidateRouter.delete('/saved-jobs/:jobId', async (request, response, next) => {
  const jobId = Number(request.params.jobId)
  if (!Number.isInteger(jobId) || jobId < 1) {
    return response.status(400).json({ message: 'Invalid job ID.' })
  }

  try {
    await pool.query(
      'DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
      [Number(request.auth.sub), jobId],
    )
    return response.status(204).end()
  } catch (error) {
    return next(error)
  }
})

candidateRouter.get('/notifications', async (request, response, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, notification_type AS "type", title, body, read_at AS "readAt", created_at AS "createdAt"
        FROM notifications
        WHERE user_id = $1 AND in_app_visible = TRUE AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [Number(request.auth.sub)],
    )
    return response.json({ notifications: rows })
  } catch (error) {
    return next(error)
  }
})

candidateRouter.patch('/notifications/:notificationId/read', async (request, response, next) => {
  const notificationId = Number(request.params.notificationId)
  if (!Number.isInteger(notificationId) || notificationId < 1) {
    return response.status(400).json({ message: 'Invalid notification ID.' })
  }
  try {
    const { rows } = await pool.query(
      `
        UPDATE notifications
        SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        RETURNING id, read_at AS "readAt"
      `,
      [notificationId, Number(request.auth.sub)],
    )
    if (!rows[0]) {
      return response.status(404).json({ message: 'Notification not found.' })
    }
    return response.json({ notification: rows[0] })
  } catch (error) {
    return next(error)
  }
})

candidateRouter.get('/applications/:applicationId/history', async (request, response, next) => {
  const applicationId = Number(request.params.applicationId)
  if (!Number.isInteger(applicationId) || applicationId < 1) {
    return response.status(400).json({ message: 'Invalid application ID.' })
  }
  try {
    const { rows } = await pool.query(
      `
        SELECT
          application_status_history.id,
          application_status_history.old_status AS "oldStatus",
          application_status_history.new_status AS "newStatus",
          application_status_history.notes,
          application_status_history.changed_at AS "changedAt"
        FROM application_status_history
        JOIN applications
          ON applications.id = application_status_history.application_id
        WHERE applications.id = $1
          AND applications.candidate_user_id = $2
          AND applications.deleted_at IS NULL
        ORDER BY application_status_history.changed_at DESC
      `,
      [applicationId, Number(request.auth.sub)],
    )
    return response.json({ history: rows })
  } catch (error) {
    return next(error)
  }
})

candidateRouter.patch('/applications/:applicationId/withdraw', async (request, response, next) => {
  const applicationId = Number(request.params.applicationId)
  const reason = optionalText(request.body.reason, 1000)
  if (!Number.isInteger(applicationId) || applicationId < 1) {
    return response.status(400).json({ message: 'Invalid application ID.' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `
        UPDATE applications
        SET
          status = 'withdrawn',
          withdrawn_at = NOW(),
          withdrawal_reason = $3
        WHERE id = $1
          AND candidate_user_id = $2
          AND deleted_at IS NULL
          AND status IN (
            'submitted',
            'in_review',
            'shortlisted',
            'interview',
            'offered'
          )
        RETURNING id, status, withdrawn_at AS "withdrawnAt"
      `,
      [applicationId, Number(request.auth.sub), reason],
    )
    if (!rows[0]) {
      await client.query('ROLLBACK')
      return response.status(409).json({
        message: 'This application cannot be withdrawn now.',
      })
    }
    await client.query(
      `
        INSERT INTO notifications (
          user_id,
          notification_type,
          title,
          body,
          related_entity_type,
          related_entity_id
        )
        VALUES (
          $1,
          'application_withdrawn',
          'Application withdrawn',
          'Your application was withdrawn successfully.',
          'application',
          $2
        )
      `,
      [Number(request.auth.sub), applicationId],
    )
    await writeAuditLog(client, request, {
      action: 'candidate.application_withdrawn',
      entityType: 'application',
      entityId: applicationId,
      newValues: { reason },
    })
    await client.query('COMMIT')
    return response.json({
      message: 'Application withdrawn.',
      application: rows[0],
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})

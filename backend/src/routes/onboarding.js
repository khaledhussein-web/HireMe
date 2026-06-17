import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { pool } from '../db/pool.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { writeAuditLog } from '../services/audit.js'
import { publicUser } from '../services/auth.js'
import {
  getAuthUserState,
  getProfileCompletion,
  persistCompletion,
} from '../services/profileCompletion.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IMAGE_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])
const TECHNICAL_TRACKS = new Set([
  'Frontend',
  'Backend',
  'Mobile',
  'AI and Data',
  'Cybersecurity',
  'DevOps',
  'UI/UX',
  'QA and Testing',
])
const assetUploadDirectory = path.resolve('private-uploads', 'profile-assets')

await fs.mkdir(assetUploadDirectory, { recursive: true })

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: assetUploadDirectory,
    filename: (_request, file, callback) => {
      callback(
        null,
        `${randomUUID()}${IMAGE_MIME_TYPES.get(file.mimetype) ?? ''}`,
      )
    },
  }),
  limits: {
    files: 1,
    fileSize: 3 * 1024 * 1024,
    fields: 2,
  },
  fileFilter: (_request, file, callback) => {
    if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
      return callback(
        new multer.MulterError(
          'LIMIT_UNEXPECTED_FILE',
          'Only JPEG, PNG, and WebP images are accepted.',
        ),
      )
    }
    return callback(null, true)
  },
})
const assetUploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many image uploads. Try again later.',
})

export const onboardingRouter = Router()

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function optionalText(value, maxLength) {
  const result = cleanText(value, maxLength)
  return result || null
}

function textArray(value, maxItems = 20, maxLength = 100) {
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

function validUrl(value) {
  if (!value) return null
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  return url.toString()
}

function slugFor(value, userId) {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180)
  return `${base || 'profile'}-${userId}`
}

async function saveSkillGroup(client, profileId, category, names) {
  await client.query(
    `
      DELETE FROM candidate_skills
      USING skills
      WHERE candidate_skills.skill_id = skills.id
        AND candidate_skills.candidate_profile_id = $1
        AND skills.category = $2
    `,
    [profileId, category],
  )

  for (const name of names) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100)
    if (!slug) continue

    const { rows } = await client.query(
      `
        INSERT INTO skills (name, slug, category)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          category = COALESCE(skills.category, EXCLUDED.category),
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

async function candidateProfile(userId) {
  const { rows } = await pool.query(
    `
      SELECT
        candidate_profiles.id,
        candidate_profiles.phone,
        candidate_profiles.country,
        candidate_profiles.city,
        candidate_profiles.headline,
        candidate_profiles.bio,
        candidate_profiles.education_level AS "educationLevel",
        candidate_profiles.experience_level AS "experienceLevel",
        candidate_profiles.preferred_work_types AS "preferredWorkTypes",
        candidate_profiles.preferred_job_categories AS "preferredJobCategories",
        candidate_profiles.preferred_locations AS "preferredLocations",
        candidate_profiles.github_url AS "githubUrl",
        candidate_profiles.linkedin_url AS "linkedinUrl",
        candidate_profiles.portfolio_url AS "portfolioUrl",
        candidate_profiles.onboarding_step AS "onboardingStep",
        education.institution_name AS university,
        education.field_of_study AS major,
        EXTRACT(YEAR FROM education.end_date)::INTEGER AS "graduationYear",
        profile_assets.id AS "photoAssetId",
        candidate_resumes.id AS "resumeId",
        candidate_resumes.original_filename AS "resumeFilename"
      FROM candidate_profiles
      LEFT JOIN LATERAL (
        SELECT *
        FROM education
        WHERE education.candidate_profile_id = candidate_profiles.id
          AND education.deleted_at IS NULL
        ORDER BY education.id DESC
        LIMIT 1
      ) AS education ON TRUE
      LEFT JOIN profile_assets
        ON profile_assets.user_id = candidate_profiles.user_id
        AND profile_assets.asset_type = 'candidate_photo'
      LEFT JOIN candidate_resumes
        ON candidate_resumes.candidate_profile_id = candidate_profiles.id
      WHERE candidate_profiles.user_id = $1
        AND candidate_profiles.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )
  const profile = rows[0] ?? null
  if (!profile) return null

  const skillsResult = await pool.query(
    `
      SELECT skills.name, COALESCE(skills.category, 'technical') AS category
      FROM candidate_skills
      JOIN skills ON skills.id = candidate_skills.skill_id
      WHERE candidate_skills.candidate_profile_id = $1
        AND skills.deleted_at IS NULL
      ORDER BY skills.name
    `,
    [profile.id],
  )
  profile.technicalSkills = skillsResult.rows
    .filter((skill) => skill.category === 'technical')
    .map((skill) => skill.name)
  profile.softSkills = skillsResult.rows
    .filter((skill) => skill.category === 'soft')
    .map((skill) => skill.name)
  profile.languages = skillsResult.rows
    .filter((skill) => skill.category === 'language')
    .map((skill) => skill.name)
  return profile
}

onboardingRouter.get(
  '/candidate',
  requireAuth,
  requireRole('candidate'),
  async (request, response, next) => {
    try {
      const profile = await candidateProfile(Number(request.auth.sub))
      const completion = await getProfileCompletion(
        pool,
        Number(request.auth.sub),
        'candidate',
      )
      return response.json({ profile, completion })
    } catch (error) {
      return next(error)
    }
  },
)

onboardingRouter.put(
  '/candidate',
  requireAuth,
  requireRole('candidate'),
  async (request, response, next) => {
    const userId = Number(request.auth.sub)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const existingResult = await client.query(
        `
          SELECT *
          FROM candidate_profiles
          WHERE user_id = $1 AND deleted_at IS NULL
          FOR UPDATE
        `,
        [userId],
      )
      const existing = existingResult.rows[0] ?? {}
      const phone =
        request.body.phone === undefined
          ? existing.phone
          : optionalText(request.body.phone, 30)
      const country =
        request.body.country === undefined
          ? existing.country
          : optionalText(request.body.country, 120)
      const city =
        request.body.city === undefined
          ? existing.city
          : optionalText(request.body.city, 120)
      const headline =
        request.body.headline === undefined
          ? existing.headline
          : optionalText(request.body.headline, 180)
      const bio =
        request.body.bio === undefined
          ? existing.bio
          : optionalText(request.body.bio, 5000)
      const educationLevel =
        request.body.educationLevel === undefined
          ? existing.education_level
          : optionalText(request.body.educationLevel, 80)
      const experienceLevel =
        request.body.experienceLevel === undefined
          ? existing.experience_level
          : optionalText(request.body.experienceLevel, 30)
      const allowedExperience = new Set([
        'student',
        'internship',
        'entry_level',
        'mid_level',
        'senior_level',
      ])
      if (experienceLevel && !allowedExperience.has(experienceLevel)) {
        await client.query('ROLLBACK')
        return response.status(400).json({
          message: 'Select a valid experience level.',
        })
      }

      let githubUrl = existing.github_url ?? null
      let linkedinUrl = existing.linkedin_url ?? null
      let portfolioUrl = existing.portfolio_url ?? null
      try {
        if (request.body.githubUrl !== undefined) {
          githubUrl = validUrl(optionalText(request.body.githubUrl, 500))
        }
        if (request.body.linkedinUrl !== undefined) {
          linkedinUrl = validUrl(optionalText(request.body.linkedinUrl, 500))
        }
        if (request.body.portfolioUrl !== undefined) {
          portfolioUrl = validUrl(optionalText(request.body.portfolioUrl, 500))
        }
      } catch {
        await client.query('ROLLBACK')
        return response.status(400).json({
          message: 'Professional links must use http or https.',
        })
      }

      const preferredWorkTypes =
        request.body.preferredWorkTypes === undefined
          ? existing.preferred_work_types ?? []
          : textArray(request.body.preferredWorkTypes, 10, 50)
      const preferredJobCategories =
        request.body.preferredJobCategories === undefined
          ? existing.preferred_job_categories ?? []
          : textArray(request.body.preferredJobCategories)
      const preferredLocations =
        request.body.preferredLocations === undefined
          ? existing.preferred_locations ?? []
          : textArray(request.body.preferredLocations)
      const onboardingStep = Math.min(
        5,
        Math.max(
          1,
          Number(request.body.onboardingStep ?? existing.onboarding_step ?? 1),
        ),
      )

      const profileResult = await client.query(
        `
          INSERT INTO candidate_profiles (
            user_id,
            phone,
            location,
            country,
            city,
            headline,
            bio,
            education_level,
            experience_level,
            preferred_work_types,
            preferred_job_categories,
            preferred_locations,
            github_url,
            linkedin_url,
            portfolio_url,
            onboarding_step
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16
          )
          ON CONFLICT (user_id) DO UPDATE SET
            phone = EXCLUDED.phone,
            location = EXCLUDED.location,
            country = EXCLUDED.country,
            city = EXCLUDED.city,
            headline = EXCLUDED.headline,
            bio = EXCLUDED.bio,
            education_level = EXCLUDED.education_level,
            experience_level = EXCLUDED.experience_level,
            preferred_work_types = EXCLUDED.preferred_work_types,
            preferred_job_categories = EXCLUDED.preferred_job_categories,
            preferred_locations = EXCLUDED.preferred_locations,
            github_url = EXCLUDED.github_url,
            linkedin_url = EXCLUDED.linkedin_url,
            portfolio_url = EXCLUDED.portfolio_url,
            onboarding_step = EXCLUDED.onboarding_step,
            deleted_at = NULL
          RETURNING id
        `,
        [
          userId,
          phone,
          city && country ? `${city}, ${country}` : city || country,
          country,
          city,
          headline,
          bio,
          educationLevel,
          experienceLevel,
          preferredWorkTypes,
          preferredJobCategories,
          preferredLocations,
          githubUrl,
          linkedinUrl,
          portfolioUrl,
          onboardingStep,
        ],
      )
      const profileId = profileResult.rows[0].id

      if (
        request.body.university !== undefined ||
        request.body.major !== undefined ||
        request.body.graduationYear !== undefined ||
        request.body.educationLevel !== undefined
      ) {
        const educationResult = await client.query(
          `
            SELECT id
            FROM education
            WHERE candidate_profile_id = $1 AND deleted_at IS NULL
            ORDER BY id DESC
            LIMIT 1
          `,
          [profileId],
        )
        const university = optionalText(request.body.university, 200)
        const major = optionalText(request.body.major, 150)
        const graduationYear = Number(request.body.graduationYear)
        const endDate =
          Number.isInteger(graduationYear) &&
          graduationYear >= 1950 &&
          graduationYear <= 2100
            ? `${graduationYear}-12-31`
            : null

        if (educationResult.rows[0]) {
          await client.query(
            `
              UPDATE education
              SET
                institution_name = $1,
                field_of_study = $2,
                degree = $3,
                end_date = $4
              WHERE id = $5
            `,
            [
              university || 'Not specified',
              major,
              educationLevel,
              endDate,
              educationResult.rows[0].id,
            ],
          )
        } else if (university || major || endDate || educationLevel) {
          await client.query(
            `
              INSERT INTO education (
                candidate_profile_id,
                institution_name,
                field_of_study,
                degree,
                end_date
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            [
              profileId,
              university || 'Not specified',
              major,
              educationLevel,
              endDate,
            ],
          )
        }
      }

      if (request.body.technicalSkills !== undefined) {
        await saveSkillGroup(
          client,
          profileId,
          'technical',
          textArray(request.body.technicalSkills, 30),
        )
      }
      if (request.body.softSkills !== undefined) {
        await saveSkillGroup(
          client,
          profileId,
          'soft',
          textArray(request.body.softSkills, 30),
        )
      }
      if (request.body.languages !== undefined) {
        await saveSkillGroup(
          client,
          profileId,
          'language',
          textArray(request.body.languages, 20),
        )
      }

      const completion = await persistCompletion(client, userId, 'candidate')
      await writeAuditLog(client, request, {
        action: completion.onboardingCompleted
          ? 'candidate.onboarding_completed'
          : 'candidate.onboarding_saved',
        entityType: 'candidate_profile',
        entityId: profileId,
        newValues: {
          onboardingStep,
          completionPercentage: completion.percentage,
        },
      })
      const user = await getAuthUserState(client, userId)
      await client.query('COMMIT')

      return response.json({
        message: completion.onboardingCompleted
          ? 'Candidate onboarding completed.'
          : 'Candidate onboarding progress saved.',
        completion,
        user: publicUser(user),
      })
    } catch (error) {
      await client.query('ROLLBACK')
      return next(error)
    } finally {
      client.release()
    }
  },
)

onboardingRouter.get(
  '/candidate/completion',
  requireAuth,
  requireRole('candidate'),
  async (request, response, next) => {
    try {
      return response.json({
        completion: await getProfileCompletion(
          pool,
          Number(request.auth.sub),
          'candidate',
        ),
      })
    } catch (error) {
      return next(error)
    }
  },
)

onboardingRouter.get(
  '/employer',
  requireAuth,
  requireRole('employer'),
  async (request, response, next) => {
    try {
      const { rows } = await pool.query(
        `
          SELECT
            companies.id,
            companies.name,
            companies.description,
            companies.industry,
            companies.website_url AS "websiteUrl",
            companies.country,
            companies.city,
            companies.company_size AS "companySize",
            companies.contact_email AS "contactEmail",
            companies.contact_phone AS "contactPhone",
            companies.registration_number AS "registrationNumber",
            companies.verification_status AS "verificationStatus",
            companies.rejection_reason AS "rejectionReason",
            companies.onboarding_step AS "onboardingStep",
            profile_assets.id AS "logoAssetId"
          FROM companies
          LEFT JOIN profile_assets
            ON profile_assets.user_id = companies.owner_user_id
            AND profile_assets.asset_type = 'company_logo'
          WHERE companies.owner_user_id = $1
            AND companies.deleted_at IS NULL
          LIMIT 1
        `,
        [Number(request.auth.sub)],
      )
      return response.json({
        profile: rows[0] ?? null,
        completion: await getProfileCompletion(
          pool,
          Number(request.auth.sub),
          'employer',
        ),
      })
    } catch (error) {
      return next(error)
    }
  },
)

onboardingRouter.put(
  '/employer',
  requireAuth,
  requireRole('employer'),
  async (request, response, next) => {
    const userId = Number(request.auth.sub)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const currentResult = await client.query(
        `
          SELECT *
          FROM companies
          WHERE owner_user_id = $1 AND deleted_at IS NULL
          FOR UPDATE
        `,
        [userId],
      )
      const current = currentResult.rows[0] ?? {}
      const name =
        request.body.name === undefined
          ? current.name
          : optionalText(request.body.name, 200)
      let websiteUrl = current.website_url ?? null
      try {
        if (request.body.websiteUrl !== undefined) {
          websiteUrl = validUrl(optionalText(request.body.websiteUrl, 500))
        }
      } catch {
        await client.query('ROLLBACK')
        return response.status(400).json({
          message: 'Company website must use http or https.',
        })
      }
      const description =
        request.body.description === undefined
          ? current.description
          : optionalText(request.body.description, 5000)
      const industry =
        request.body.industry === undefined
          ? current.industry
          : optionalText(request.body.industry, 120)
      const country =
        request.body.country === undefined
          ? current.country
          : optionalText(request.body.country, 120)
      const city =
        request.body.city === undefined
          ? current.city
          : optionalText(request.body.city, 120)
      const companySize =
        request.body.companySize === undefined
          ? current.company_size
          : optionalText(request.body.companySize, 40)
      const contactEmail =
        request.body.contactEmail === undefined
          ? current.contact_email
          : optionalText(request.body.contactEmail, 320)?.toLowerCase()
      const contactPhone =
        request.body.contactPhone === undefined
          ? current.contact_phone
          : optionalText(request.body.contactPhone, 40)
      const registrationNumber =
        request.body.registrationNumber === undefined
          ? current.registration_number
          : optionalText(request.body.registrationNumber, 120)
      const onboardingStep = Math.min(
        4,
        Math.max(
          1,
          Number(request.body.onboardingStep ?? current.onboarding_step ?? 1),
        ),
      )
      if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) {
        await client.query('ROLLBACK')
        return response.status(400).json({
          message: 'Enter a valid business email.',
        })
      }

      const { rows } = await client.query(
        `
          INSERT INTO companies (
            owner_user_id,
            name,
            slug,
            website_url,
            description,
            headquarters_location,
            country,
            city,
            industry,
            company_size,
            registration_number,
            contact_email,
            contact_phone,
            onboarding_step
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
          )
          ON CONFLICT (owner_user_id) WHERE owner_user_id IS NOT NULL
            AND deleted_at IS NULL
          DO UPDATE SET
            name = EXCLUDED.name,
            website_url = EXCLUDED.website_url,
            description = EXCLUDED.description,
            headquarters_location = EXCLUDED.headquarters_location,
            country = EXCLUDED.country,
            city = EXCLUDED.city,
            industry = EXCLUDED.industry,
            company_size = EXCLUDED.company_size,
            registration_number = EXCLUDED.registration_number,
            contact_email = EXCLUDED.contact_email,
            contact_phone = EXCLUDED.contact_phone,
            onboarding_step = EXCLUDED.onboarding_step
          RETURNING id
        `,
        [
          userId,
          name || 'Company profile',
          current.slug || slugFor(name || 'company', userId),
          websiteUrl,
          description,
          city && country ? `${city}, ${country}` : city || country,
          country,
          city,
          industry,
          companySize,
          registrationNumber,
          contactEmail,
          contactPhone,
          onboardingStep,
        ],
      )
      let completion = await persistCompletion(client, userId, 'employer')

      if (request.body.submit === true) {
        const documentResult = await client.query(
          `
            SELECT 1
            FROM company_documents
            WHERE company_id = $1 AND deleted_at IS NULL
            LIMIT 1
          `,
          [rows[0].id],
        )
        if (!completion.onboardingCompleted || !documentResult.rows[0]) {
          await client.query('ROLLBACK')
          return response.status(400).json({
            message:
              'Complete required company fields and upload a verification document before submitting.',
          })
        }
        await client.query(
          `
            UPDATE companies
            SET verification_status = 'pending', submitted_at = NOW()
            WHERE id = $1
          `,
          [rows[0].id],
        )
        completion = await persistCompletion(client, userId, 'employer')
      }

      const user = await getAuthUserState(client, userId)
      await client.query('COMMIT')
      return response.json({
        message:
          request.body.submit === true
            ? 'Company profile submitted for review.'
            : 'Company onboarding progress saved.',
        completion,
        user: publicUser(user),
      })
    } catch (error) {
      await client.query('ROLLBACK')
      return next(error)
    } finally {
      client.release()
    }
  },
)

onboardingRouter.get(
  '/employer/completion',
  requireAuth,
  requireRole('employer'),
  async (request, response, next) => {
    try {
      return response.json({
        completion: await getProfileCompletion(
          pool,
          Number(request.auth.sub),
          'employer',
        ),
      })
    } catch (error) {
      return next(error)
    }
  },
)

onboardingRouter.get(
  '/community',
  requireAuth,
  requireRole('tech_community'),
  async (request, response, next) => {
    try {
      const { rows } = await pool.query(
        `
          SELECT
            community_profiles.id,
            community_profiles.community_name AS "communityName",
            community_profiles.description,
            community_profiles.category,
            community_profiles.university_name AS "universityName",
            community_profiles.website_url AS "websiteUrl",
            community_profiles.country,
            community_profiles.city,
            community_profiles.technical_tracks AS "technicalTracks",
            community_profiles.contact_email AS "contactEmail",
            community_profiles.verification_status AS "verificationStatus",
            community_profiles.rejection_reason AS "rejectionReason",
            community_profiles.onboarding_step AS "onboardingStep",
            profile_assets.id AS "logoAssetId"
          FROM community_profiles
          LEFT JOIN profile_assets
            ON profile_assets.user_id = community_profiles.owner_user_id
            AND profile_assets.asset_type = 'community_logo'
          WHERE community_profiles.owner_user_id = $1
            AND community_profiles.deleted_at IS NULL
          LIMIT 1
        `,
        [Number(request.auth.sub)],
      )
      return response.json({
        profile: rows[0] ?? null,
        completion: await getProfileCompletion(
          pool,
          Number(request.auth.sub),
          'tech_community',
        ),
        availableTracks: [...TECHNICAL_TRACKS],
      })
    } catch (error) {
      return next(error)
    }
  },
)

onboardingRouter.put(
  '/community',
  requireAuth,
  requireRole('tech_community'),
  async (request, response, next) => {
    const userId = Number(request.auth.sub)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const currentResult = await client.query(
        `
          SELECT *
          FROM community_profiles
          WHERE owner_user_id = $1 AND deleted_at IS NULL
          FOR UPDATE
        `,
        [userId],
      )
      const current = currentResult.rows[0] ?? {}
      const communityName =
        request.body.communityName === undefined
          ? current.community_name
          : optionalText(request.body.communityName, 200)
      const description =
        request.body.description === undefined
          ? current.description
          : optionalText(request.body.description, 5000)
      const category =
        request.body.category === undefined
          ? current.category
          : optionalText(request.body.category, 120)
      const universityName =
        request.body.universityName === undefined
          ? current.university_name
          : optionalText(request.body.universityName, 200)
      let websiteUrl = current.website_url ?? null
      try {
        if (request.body.websiteUrl !== undefined) {
          websiteUrl = validUrl(optionalText(request.body.websiteUrl, 500))
        }
      } catch {
        await client.query('ROLLBACK')
        return response.status(400).json({
          message: 'Website or social link must use http or https.',
        })
      }
      const country =
        request.body.country === undefined
          ? current.country
          : optionalText(request.body.country, 120)
      const city =
        request.body.city === undefined
          ? current.city
          : optionalText(request.body.city, 120)
      const technicalTracks =
        request.body.technicalTracks === undefined
          ? current.technical_tracks ?? []
          : textArray(request.body.technicalTracks).filter((track) =>
              TECHNICAL_TRACKS.has(track),
            )
      const contactEmail =
        request.body.contactEmail === undefined
          ? current.contact_email
          : optionalText(request.body.contactEmail, 320)?.toLowerCase()
      const onboardingStep = Math.min(
        4,
        Math.max(
          1,
          Number(request.body.onboardingStep ?? current.onboarding_step ?? 1),
        ),
      )
      if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) {
        await client.query('ROLLBACK')
        return response.status(400).json({
          message: 'Enter a valid contact email.',
        })
      }

      const { rows } = await client.query(
        `
          INSERT INTO community_profiles (
            owner_user_id,
            community_name,
            description,
            category,
            university_name,
            website_url,
            country,
            city,
            technical_tracks,
            contact_email,
            onboarding_step
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (owner_user_id) DO UPDATE SET
            community_name = EXCLUDED.community_name,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            university_name = EXCLUDED.university_name,
            website_url = EXCLUDED.website_url,
            country = EXCLUDED.country,
            city = EXCLUDED.city,
            technical_tracks = EXCLUDED.technical_tracks,
            contact_email = EXCLUDED.contact_email,
            onboarding_step = EXCLUDED.onboarding_step,
            deleted_at = NULL
          RETURNING id
        `,
        [
          userId,
          communityName,
          description,
          category,
          universityName,
          websiteUrl,
          country,
          city,
          technicalTracks,
          contactEmail,
          onboardingStep,
        ],
      )
      let completion = await persistCompletion(
        client,
        userId,
        'tech_community',
      )
      if (request.body.submit === true) {
        if (!completion.onboardingCompleted) {
          await client.query('ROLLBACK')
          return response.status(400).json({
            message: 'Complete all required community fields before submitting.',
          })
        }
        await client.query(
          `
            UPDATE community_profiles
            SET verification_status = 'pending', submitted_at = NOW()
            WHERE id = $1
          `,
          [rows[0].id],
        )
        completion = await persistCompletion(
          client,
          userId,
          'tech_community',
        )
      }
      const user = await getAuthUserState(client, userId)
      await client.query('COMMIT')
      return response.json({
        message:
          request.body.submit === true
            ? 'Community profile submitted for review.'
            : 'Community onboarding progress saved.',
        completion,
        user: publicUser(user),
      })
    } catch (error) {
      await client.query('ROLLBACK')
      return next(error)
    } finally {
      client.release()
    }
  },
)

onboardingRouter.get(
  '/community/completion',
  requireAuth,
  requireRole('tech_community'),
  async (request, response, next) => {
    try {
      return response.json({
        completion: await getProfileCompletion(
          pool,
          Number(request.auth.sub),
          'tech_community',
        ),
      })
    } catch (error) {
      return next(error)
    }
  },
)

async function uploadAsset(request, response, next, role, assetType) {
  if (!request.file) {
    return response.status(400).json({ message: 'Select an image to upload.' })
  }

  const client = await pool.connect()
  let previousStoredFilename = null
  try {
    const buffer = await fs.readFile(request.file.path)
    const isJpeg =
      request.file.mimetype === 'image/jpeg' &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    const isPng =
      request.file.mimetype === 'image/png' &&
      buffer.subarray(0, 8).equals(pngSignature)
    const isWebp =
      request.file.mimetype === 'image/webp' &&
      buffer.subarray(0, 4).toString() === 'RIFF' &&
      buffer.subarray(8, 12).toString() === 'WEBP'

    if (!isJpeg && !isPng && !isWebp) {
      await fs.unlink(request.file.path).catch(() => {})
      return response.status(400).json({
        message: 'The uploaded image content does not match its file type.',
      })
    }

    await client.query('BEGIN')
    const previous = await client.query(
      `
        SELECT stored_filename
        FROM profile_assets
        WHERE user_id = $1 AND asset_type = $2
      `,
      [Number(request.auth.sub), assetType],
    )
    previousStoredFilename = previous.rows[0]?.stored_filename ?? null
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const { rows } = await client.query(
      `
        INSERT INTO profile_assets (
          user_id,
          asset_type,
          original_filename,
          stored_filename,
          mime_type,
          file_size,
          sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, asset_type) DO UPDATE SET
          original_filename = EXCLUDED.original_filename,
          stored_filename = EXCLUDED.stored_filename,
          mime_type = EXCLUDED.mime_type,
          file_size = EXCLUDED.file_size,
          sha256 = EXCLUDED.sha256
        RETURNING id, asset_type AS "assetType"
      `,
      [
        Number(request.auth.sub),
        assetType,
        path.basename(request.file.originalname).slice(0, 255),
        request.file.filename,
        request.file.mimetype,
        request.file.size,
        sha256,
      ],
    )
    const completion = await persistCompletion(
      client,
      Number(request.auth.sub),
      role,
    )
    const user = await getAuthUserState(client, Number(request.auth.sub))
    await client.query('COMMIT')

    if (previousStoredFilename) {
      await fs
        .unlink(
          path.join(
            assetUploadDirectory,
            path.basename(previousStoredFilename),
          ),
        )
        .catch(() => {})
    }
    return response.status(201).json({
      message: 'Image uploaded.',
      asset: rows[0],
      completion,
      user: publicUser(user),
    })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    await fs.unlink(request.file.path).catch(() => {})
    return next(error)
  } finally {
    client.release()
  }
}

onboardingRouter.post(
  '/candidate/photo',
  requireAuth,
  requireRole('candidate'),
  assetUploadRateLimit,
  imageUpload.single('image'),
  (request, response, next) =>
    uploadAsset(request, response, next, 'candidate', 'candidate_photo'),
)

onboardingRouter.post(
  '/employer/logo',
  requireAuth,
  requireRole('employer'),
  assetUploadRateLimit,
  imageUpload.single('image'),
  (request, response, next) =>
    uploadAsset(request, response, next, 'employer', 'company_logo'),
)

onboardingRouter.post(
  '/community/logo',
  requireAuth,
  requireRole('tech_community'),
  assetUploadRateLimit,
  imageUpload.single('image'),
  (request, response, next) =>
    uploadAsset(request, response, next, 'tech_community', 'community_logo'),
)

onboardingRouter.get(
  '/assets/:assetId',
  requireAuth,
  async (request, response, next) => {
    const assetId = Number(request.params.assetId)
    if (!Number.isInteger(assetId) || assetId < 1) {
      return response.status(400).json({ message: 'Invalid asset ID.' })
    }
    try {
      const { rows } = await pool.query(
        `
          SELECT original_filename, stored_filename, mime_type
          FROM profile_assets
          WHERE id = $1
          LIMIT 1
        `,
        [assetId],
      )
      const asset = rows[0]
      if (!asset) {
        return response.status(404).json({ message: 'Image not found.' })
      }
      const filePath = path.join(
        assetUploadDirectory,
        path.basename(asset.stored_filename),
      )
      response.type(asset.mime_type)
      response.set('Content-Disposition', 'inline')
      const stream = createReadStream(filePath)
      stream.on('error', next)
      return stream.pipe(response)
    } catch (error) {
      return next(error)
    }
  },
)

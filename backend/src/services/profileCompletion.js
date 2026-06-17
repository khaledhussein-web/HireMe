const roleRoutes = {
  candidate: {
    onboarding: '/onboarding/candidate',
    dashboard: '/candidate/dashboard',
  },
  employer: {
    onboarding: '/onboarding/employer',
    dashboard: '/employer/dashboard',
  },
  tech_community: {
    onboarding: '/onboarding/community',
    dashboard: '/community/dashboard',
  },
  admin: {
    dashboard: '/admin/dashboard',
  },
}

function hasText(value) {
  return Boolean(String(value ?? '').trim())
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0
}

function completionResult(items, requiredItems) {
  const completedItems = items
    .filter((item) => item.complete)
    .map((item) => item.code)
  const missingItems = items
    .filter((item) => !item.complete)
    .map((item) => item.code)
  const percentage = items.reduce(
    (total, item) => total + (item.complete ? item.weight : 0),
    0,
  )

  return {
    percentage,
    completedItems,
    missingItems,
    onboardingCompleted: requiredItems.every((item) =>
      completedItems.includes(item),
    ),
  }
}

async function candidateCompletion(client, userId) {
  const { rows } = await client.query(
    `
      SELECT
        candidate_profiles.id,
        candidate_profiles.headline,
        candidate_profiles.bio,
        candidate_profiles.phone,
        candidate_profiles.country,
        candidate_profiles.city,
        candidate_profiles.experience_level,
        candidate_profiles.preferred_work_types,
        candidate_profiles.preferred_job_categories,
        candidate_profiles.preferred_locations,
        candidate_profiles.github_url,
        candidate_profiles.linkedin_url,
        candidate_profiles.portfolio_url,
        candidate_profiles.onboarding_step,
        education.institution_name,
        education.field_of_study,
        education.degree,
        education.end_date,
        candidate_resumes.id AS resume_id,
        profile_assets.id AS photo_id,
        COUNT(DISTINCT candidate_skills.skill_id)::INTEGER AS skill_count,
        COUNT(DISTINCT projects.id)::INTEGER AS project_count
      FROM candidate_profiles
      LEFT JOIN LATERAL (
        SELECT *
        FROM education
        WHERE education.candidate_profile_id = candidate_profiles.id
          AND education.deleted_at IS NULL
        ORDER BY education.end_date DESC NULLS FIRST, education.id DESC
        LIMIT 1
      ) AS education ON TRUE
      LEFT JOIN candidate_resumes
        ON candidate_resumes.candidate_profile_id = candidate_profiles.id
      LEFT JOIN profile_assets
        ON profile_assets.user_id = candidate_profiles.user_id
        AND profile_assets.asset_type = 'candidate_photo'
      LEFT JOIN candidate_skills
        ON candidate_skills.candidate_profile_id = candidate_profiles.id
      LEFT JOIN projects
        ON projects.candidate_profile_id = candidate_profiles.id
        AND projects.deleted_at IS NULL
      WHERE candidate_profiles.user_id = $1
        AND candidate_profiles.deleted_at IS NULL
      GROUP BY
        candidate_profiles.id,
        education.institution_name,
        education.field_of_study,
        education.degree,
        education.end_date,
        candidate_resumes.id,
        profile_assets.id
      LIMIT 1
    `,
    [userId],
  )
  const profile = rows[0]
  if (!profile) {
    return {
      profileExists: false,
      percentage: 0,
      completedItems: [],
      missingItems: [
        'basic_information',
        'education',
        'career_preferences',
        'cv',
        'skills',
        'github_or_portfolio',
        'profile_photo',
        'linkedin',
        'featured_projects',
      ],
      onboardingCompleted: false,
      onboardingStep: 1,
    }
  }

  const basicInformation =
    hasText(profile.headline) &&
    hasText(profile.bio) &&
    hasText(profile.phone) &&
    hasText(profile.country) &&
    hasText(profile.city)
  const education =
    hasText(profile.institution_name) &&
    hasText(profile.field_of_study) &&
    hasText(profile.degree) &&
    Boolean(profile.end_date)
  const careerPreferences =
    hasText(profile.experience_level) &&
    hasItems(profile.preferred_work_types) &&
    hasItems(profile.preferred_job_categories) &&
    hasItems(profile.preferred_locations)

  return {
    profileExists: true,
    onboardingStep: profile.onboarding_step ?? 1,
    ...completionResult(
      [
        { code: 'basic_information', weight: 20, complete: basicInformation },
        { code: 'education', weight: 15, complete: education },
        {
          code: 'career_preferences',
          weight: 15,
          complete: careerPreferences,
        },
        { code: 'cv', weight: 15, complete: Boolean(profile.resume_id) },
        { code: 'skills', weight: 15, complete: profile.skill_count > 0 },
        {
          code: 'github_or_portfolio',
          weight: 10,
          complete:
            hasText(profile.github_url) || hasText(profile.portfolio_url),
        },
        {
          code: 'profile_photo',
          weight: 5,
          complete: Boolean(profile.photo_id),
        },
        { code: 'linkedin', weight: 5, complete: hasText(profile.linkedin_url) },
      ],
      [
        'basic_information',
        'education',
        'career_preferences',
        'cv',
        'skills',
      ],
    ),
    featuredProjectsComplete: profile.project_count > 0,
  }
}

async function employerCompletion(client, userId) {
  const { rows } = await client.query(
    `
      SELECT
        companies.id,
        companies.name,
        companies.description,
        companies.industry,
        companies.website_url,
        companies.country,
        companies.city,
        companies.company_size,
        companies.contact_email,
        companies.contact_phone,
        companies.verification_status,
        companies.onboarding_step,
        profile_assets.id AS logo_id,
        COUNT(company_documents.id)::INTEGER AS document_count
      FROM companies
      LEFT JOIN profile_assets
        ON profile_assets.user_id = companies.owner_user_id
        AND profile_assets.asset_type = 'company_logo'
      LEFT JOIN company_documents
        ON company_documents.company_id = companies.id
        AND company_documents.deleted_at IS NULL
      WHERE companies.owner_user_id = $1
        AND companies.deleted_at IS NULL
      GROUP BY companies.id, profile_assets.id
      LIMIT 1
    `,
    [userId],
  )
  const profile = rows[0]
  if (!profile) {
    return {
      profileExists: false,
      percentage: 0,
      completedItems: [],
      missingItems: [
        'company_information',
        'business_contact',
        'company_logo',
        'verification_document',
        'submitted_for_review',
      ],
      onboardingCompleted: false,
      onboardingStep: 1,
      verificationStatus: 'draft',
    }
  }

  const companyInformation =
    hasText(profile.name) &&
    hasText(profile.description) &&
    hasText(profile.industry) &&
    hasText(profile.country) &&
    hasText(profile.city) &&
    hasText(profile.company_size)
  const businessContact =
    hasText(profile.contact_email) && hasText(profile.contact_phone)

  return {
    profileExists: true,
    onboardingStep: profile.onboarding_step ?? 1,
    verificationStatus: profile.verification_status,
    ...completionResult(
      [
        {
          code: 'company_information',
          weight: 55,
          complete: companyInformation,
        },
        {
          code: 'business_contact',
          weight: 15,
          complete: businessContact,
        },
        {
          code: 'company_logo',
          weight: 10,
          complete: Boolean(profile.logo_id),
        },
        {
          code: 'verification_document',
          weight: 10,
          complete: profile.document_count > 0,
        },
        {
          code: 'submitted_for_review',
          weight: 10,
          complete: ['pending', 'approved'].includes(
            profile.verification_status,
          ),
        },
      ],
      ['company_information', 'business_contact'],
    ),
  }
}

async function communityCompletion(client, userId) {
  const { rows } = await client.query(
    `
      SELECT
        community_profiles.id,
        community_profiles.community_name,
        community_profiles.description,
        community_profiles.category,
        community_profiles.website_url,
        community_profiles.country,
        community_profiles.city,
        community_profiles.technical_tracks,
        community_profiles.contact_email,
        community_profiles.verification_status,
        community_profiles.onboarding_step,
        profile_assets.id AS logo_id
      FROM community_profiles
      LEFT JOIN profile_assets
        ON profile_assets.user_id = community_profiles.owner_user_id
        AND profile_assets.asset_type = 'community_logo'
      WHERE community_profiles.owner_user_id = $1
        AND community_profiles.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )
  const profile = rows[0]
  if (!profile) {
    return {
      profileExists: false,
      percentage: 0,
      completedItems: [],
      missingItems: [
        'community_information',
        'location',
        'technical_tracks',
        'contact',
        'community_logo',
        'submitted_for_review',
      ],
      onboardingCompleted: false,
      onboardingStep: 1,
      verificationStatus: 'draft',
    }
  }

  const communityInformation =
    hasText(profile.community_name) &&
    hasText(profile.description) &&
    hasText(profile.category)
  const location = hasText(profile.country) && hasText(profile.city)

  return {
    profileExists: true,
    onboardingStep: profile.onboarding_step ?? 1,
    verificationStatus: profile.verification_status,
    ...completionResult(
      [
        {
          code: 'community_information',
          weight: 35,
          complete: communityInformation,
        },
        { code: 'location', weight: 15, complete: location },
        {
          code: 'technical_tracks',
          weight: 20,
          complete: hasItems(profile.technical_tracks),
        },
        {
          code: 'contact',
          weight: 15,
          complete: hasText(profile.contact_email),
        },
        {
          code: 'community_logo',
          weight: 5,
          complete: Boolean(profile.logo_id),
        },
        {
          code: 'submitted_for_review',
          weight: 10,
          complete: ['pending', 'approved'].includes(
            profile.verification_status,
          ),
        },
      ],
      [
        'community_information',
        'location',
        'technical_tracks',
        'contact',
      ],
    ),
  }
}

export async function getProfileCompletion(client, userId, role) {
  if (role === 'candidate') return candidateCompletion(client, userId)
  if (role === 'employer') return employerCompletion(client, userId)
  if (role === 'tech_community') return communityCompletion(client, userId)

  return {
    profileExists: true,
    percentage: 100,
    completedItems: ['account'],
    missingItems: [],
    onboardingCompleted: true,
    onboardingStep: 1,
  }
}

export async function getAuthUserState(client, userId) {
  const { rows } = await client.query(
    `
      SELECT
        users.id,
        users.full_name,
        users.email,
        users.email_verified_at,
        users.account_status,
        users.is_active,
        roles.name AS role
      FROM users
      JOIN roles ON roles.id = users.role_id
      WHERE users.id = $1
        AND users.deleted_at IS NULL
      LIMIT 1
    `,
    [userId],
  )
  const user = rows[0]
  if (!user || !user.is_active || user.account_status === 'suspended') {
    return null
  }

  const completion = await getProfileCompletion(client, user.id, user.role)
  const routes = roleRoutes[user.role] ?? { dashboard: '/' }
  const nextRoute =
    user.role === 'admin' || completion.onboardingCompleted
      ? routes.dashboard
      : routes.onboarding

  return {
    ...user,
    ...completion,
    profile_complete: completion.onboardingCompleted,
    next_route: nextRoute,
  }
}

export async function persistCompletion(client, userId, role) {
  const completion = await getProfileCompletion(client, userId, role)
  const table =
    role === 'candidate'
      ? 'candidate_profiles'
      : role === 'employer'
        ? 'companies'
        : role === 'tech_community'
          ? 'community_profiles'
          : null
  const ownerColumn =
    role === 'candidate'
      ? 'user_id'
      : role === 'employer' || role === 'tech_community'
        ? 'owner_user_id'
        : null

  if (table && ownerColumn && completion.profileExists) {
    await client.query(
      `
        UPDATE ${table}
        SET
          profile_completion_percentage = $1,
          onboarding_completed = $2
        WHERE ${ownerColumn} = $3
      `,
      [completion.percentage, completion.onboardingCompleted, userId],
    )
  }

  return completion
}

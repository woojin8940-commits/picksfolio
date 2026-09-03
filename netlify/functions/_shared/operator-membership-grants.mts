import { getDatabase } from '@picks/netlify-database'

export type OperatorMembershipPlan = 'standard' | 'standard_ai' | 'commerce' | 'pro'

export interface OperatorMembershipGrant {
  auth_user_id: string
  username: string
  plan: OperatorMembershipPlan
  active: boolean
  granted_by: string
  granted_at: string
  revoked_at: string | null
  updated_at: string
}

const toGrant = (row: any): OperatorMembershipGrant => ({
  auth_user_id: String(row.auth_user_id || ''),
  username: String(row.username || ''),
  plan: row.plan as OperatorMembershipPlan,
  active: row.active === true,
  granted_by: String(row.granted_by || ''),
  granted_at: String(row.granted_at || ''),
  revoked_at: row.revoked_at ? String(row.revoked_at) : null,
  updated_at: String(row.updated_at || ''),
})

export async function listOperatorMembershipGrants(): Promise<OperatorMembershipGrant[]> {
  const db = getDatabase()
  const rows = await db.sql`
    SELECT auth_user_id, username, plan, active, granted_by, granted_at, revoked_at, updated_at
    FROM operator_membership_grants
  `
  return rows.map(toGrant)
}

export async function getOperatorMembershipGrant(input: {
  authUserId?: string | null
  username?: string | null
}): Promise<OperatorMembershipGrant | null> {
  const db = getDatabase()
  const authUserId = String(input.authUserId || '').trim()
  const username = String(input.username || '').trim().toLowerCase()

  let rows: any[] = []
  if (authUserId) {
    rows = await db.sql`
      SELECT auth_user_id, username, plan, active, granted_by, granted_at, revoked_at, updated_at
      FROM operator_membership_grants
      WHERE auth_user_id = ${authUserId}
      LIMIT 1
    `
  } else if (username) {
    rows = await db.sql`
      SELECT auth_user_id, username, plan, active, granted_by, granted_at, revoked_at, updated_at
      FROM operator_membership_grants
      WHERE LOWER(username) = ${username}
      LIMIT 1
    `
  }

  const grant = rows.length > 0 ? toGrant(rows[0]) : null
  if (grant && authUserId && username && grant.username.toLowerCase() !== username) {
    await db.sql`
      UPDATE operator_membership_grants
      SET username = ${username}, updated_at = NOW()
      WHERE auth_user_id = ${authUserId}
    `
    grant.username = username
  }
  return grant
}

export async function setOperatorMembershipGrant(input: {
  authUserId: string
  username?: string | null
  plan: OperatorMembershipPlan | null
  grantedBy?: string | null
}): Promise<OperatorMembershipGrant> {
  const db = getDatabase()
  const username = String(input.username || '').trim().toLowerCase()
  const grantedBy = String(input.grantedBy || '').trim()
  const plan = input.plan || 'standard'
  const rows = await db.sql`
    INSERT INTO operator_membership_grants (
      auth_user_id, username, plan, active, granted_by, granted_at, revoked_at, updated_at
    ) VALUES (
      ${input.authUserId}, ${username}, ${plan}, ${input.plan !== null}, ${grantedBy},
      NOW(), ${input.plan === null ? new Date().toISOString() : null}, NOW()
    )
    ON CONFLICT (auth_user_id) DO UPDATE SET
      username = EXCLUDED.username,
      plan = CASE WHEN EXCLUDED.active THEN EXCLUDED.plan ELSE operator_membership_grants.plan END,
      active = EXCLUDED.active,
      granted_by = EXCLUDED.granted_by,
      granted_at = CASE WHEN EXCLUDED.active THEN NOW() ELSE operator_membership_grants.granted_at END,
      revoked_at = CASE WHEN EXCLUDED.active THEN NULL ELSE NOW() END,
      updated_at = NOW()
    RETURNING auth_user_id, username, plan, active, granted_by, granted_at, revoked_at, updated_at
  `
  return toGrant(rows[0])
}

export function applyOperatorMembershipGrant<T extends Record<string, any> | null | undefined>(
  record: T,
  grant: OperatorMembershipGrant | null | undefined,
): T extends null | undefined ? Record<string, any> | T : T {
  if (!grant?.active) return record as any
  return {
    ...(record || {}),
    membership_active: true,
    membership_plan: grant.plan,
    membership_started_at: grant.granted_at,
    membership_source: 'operator',
  } as any
}

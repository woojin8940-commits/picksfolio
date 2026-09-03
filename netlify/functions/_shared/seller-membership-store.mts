import type { getStore } from '@netlify/blobs'

export interface SellerMembershipRecord {
  membership_active?: boolean
  membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | 'live' | null
  membership_started_at?: string | null
  live_plan_active?: boolean
  [key: string]: any
}

type BlobStore = ReturnType<typeof getStore>

const LEGACY_MEMBERSHIP_FIELDS = [
  'membership_active',
  'membership_plan',
  'membership_started_at',
  'membership_amount_krw',
  'last_billing_at',
  'next_billing_date',
  'billing_failures',
  'billing_key',
  'billing_key_issued_at',
  'billing_provider',
  'billing_history',
  'live_plan_active',
  'live_plan_started_at',
  'live_plan_amount_krw',
  'live_plan_last_billing_at',
  'live_plan_next_billing_date',
  'live_plan_billing_failures',
] as const

export function mergeLegacyMembershipRecord(
  canonical: SellerMembershipRecord,
  legacy: SellerMembershipRecord,
): { record: SellerMembershipRecord; changed: boolean } {
  const merged = { ...canonical }
  let changed = false

  for (const field of LEGACY_MEMBERSHIP_FIELDS) {
    if (
      !Object.prototype.hasOwnProperty.call(canonical, field) &&
      Object.prototype.hasOwnProperty.call(legacy, field)
    ) {
      merged[field] = legacy[field]
      changed = true
    }
  }

  if (changed) merged.updated_at = new Date().toISOString()
  return { record: merged, changed }
}

export async function readSellerMembership(
  store: BlobStore,
  username: string,
): Promise<SellerMembershipRecord | null> {
  const clean = username.trim().toLowerCase()
  if (!clean) return null

  const canonicalKey = `seller_${clean}`
  const [canonical, legacy] = await Promise.all([
    store.get(canonicalKey, { type: 'json' }) as Promise<SellerMembershipRecord | null>,
    store.get(clean, { type: 'json' }) as Promise<SellerMembershipRecord | null>,
  ])

  if (!legacy) return canonical

  if (!canonical) {
    await store.setJSON(canonicalKey, legacy)
    try { await store.delete(clean) } catch {}
    return legacy
  }

  const merged = mergeLegacyMembershipRecord(canonical, legacy)
  if (merged.changed) await store.setJSON(canonicalKey, merged.record)
  try { await store.delete(clean) } catch {}
  return merged.record
}

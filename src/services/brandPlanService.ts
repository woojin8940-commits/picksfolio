import { authHeaders } from './apiService';
import type { BrandPlanTier } from '../utils/membershipTiers';

export interface BrandPlanOverview {
  viewer: { teamRole: 'owner' | 'member' };
  plan: {
    planActive: boolean;
    tier: BrandPlanTier | null;
    scheduledTier: BrandPlanTier | null;
    includedSeats: number;
    extraSeats: number;
    scheduledSeats: number | null;
    seatPriceKrw: number;
    baseMonthlyKrw: number;
    nextMonthlyKrw: number;
    nextBillingDate: string | null;
    cancelAtPeriodEnd: boolean;
    chargePending: boolean;
    granted?: boolean;
  };
  quota: {
    tier: BrandPlanTier | null;
    enforced: boolean;
    pastDue: boolean;
    cycle: { start: string; end: string };
    limits: { campaigns: number; selected: number };
    addons: { campaigns: number; selected: number };
    used: { campaigns: number; selected: number };
    remaining: { campaigns: number; selected: number };
  } | null;
  catalog: {
    tiers: { tier: BrandPlanTier; priceKrw: number; includedSeats: number; campaigns: number; selected: number }[];
    seatPriceKrw: number;
    addons: { selected: { unit: number; priceKrw: number } };
  };
}

type Result<T> = ({ success: true } & T) | { success: false; error: string };

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<Result<T>> {
  try {
    const res = await fetch('/api/brand-plan', {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      return { success: false, error: String(json?.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
    }
    return json as Result<T>;
  } catch {
    return { success: false, error: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' };
  }
}

export const brandPlanService = {
  overview: () => call<BrandPlanOverview>('overview'),
  upgrade: (tier: BrandPlanTier) => call<BrandPlanOverview & { chargedKrw?: number }>('upgrade', { tier }),
  schedule: (tier: BrandPlanTier) => call<BrandPlanOverview>('schedule', { tier }),
  addon: (kind: 'selected', units: number) =>
    call<BrandPlanOverview & { chargedKrw?: number }>('addon', { kind, units }),
};

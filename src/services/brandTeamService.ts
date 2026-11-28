import { authHeaders } from './apiService';
import type { MembershipBillingHistoryEntry } from '../types';


export interface TeamMember {
  id: number;
  memberUsername: string;
  displayName: string;
  department: string;
  isAdmin: boolean;
  joinedAt: string;
  seated: boolean;
}

export interface SeatInvite {
  id: number;
  label: string;
  createdAt: string;
  expiresAt: string;
}

export interface TeamOverview {
  viewer: { teamRole: 'owner' | 'member'; teamAdmin?: boolean; memberUsername: string | null };
  plan: {
    planActive: boolean;
    includedSeats: number;
    extraSeats: number;
    scheduledSeats: number | null;
    seatPriceKrw: number;
    baseMonthlyKrw: number;
    nextMonthlyKrw: number;
    nextBillingDate: string | null;
    cancelAtPeriodEnd: boolean;
    chargePending: boolean;
  };
  seats: { total: number; included: number; extra: number; capacity: number; used: number; available: number };
  members: TeamMember[];
  invites: SeatInvite[];
  billingHistory: MembershipBillingHistoryEntry[];
}

type Result<T> = ({ success: true } & T) | { success: false; error: string };

async function call<T>(action: string, payload: Record<string, unknown> = {}, signedIn = true): Promise<Result<T>> {
  try {
    const headers = signedIn
      ? await authHeaders({ 'Content-Type': 'application/json' })
      : { 'Content-Type': 'application/json' };
    const res = await fetch('/api/brand-team', {
      method: 'POST',
      headers,
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

export const brandTeamService = {
  overview: () => call<TeamOverview>('overview'),
  createInvite: (label: string) =>
    call<{ invite: SeatInvite; url: string }>('create_invite', { label }),
  revokeInvite: (inviteId: number) => call<{}>('revoke_invite', { inviteId }),
  removeMember: (memberId: number) => call<{}>('remove_member', { memberId }),
  setAdmin: (memberId: number, isAdmin: boolean) => call<TeamOverview>('set_admin', { memberId, isAdmin }),
  addSeats: (count: number) => call<TeamOverview & { chargedKrw?: number }>('add_seats', { count }),
  scheduleSeats: (seats: number) => call<TeamOverview>('schedule_seats', { seats }),
  inviteInfo: (token: string) =>
    call<{ invite: { companyName: string; label: string; expiresAt: string } }>('invite_info', { token }, false),
  join: (input: { token: string; username: string; password: string; name: string; department: string }) =>
    call<{
      username: string;
      company_name: string;
      role: string;
      team_role: 'member';
      member_username: string;
      member_name: string;
      access_token: string;
      refresh_token: string;
    }>('join', input, false),
};

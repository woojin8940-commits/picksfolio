/**
 * 브랜드 회사 계정에서 지금 로그인한 사람의 역할.
 *
 * 회사 관리자 계정(결제한 계정)은 'owner', 초대 링크로 들어온 직원은 'admin'(팀 관리자) 또는
 * 'member'. 로그인할 때 서버(business-auth)가 알려 준 값을 저장해 두고 화면이 메뉴 · 버튼을
 * 가르는 데만 쓴다 — 실제 권한은 서버가 토큰으로 다시 확인한다.
 */
export type BusinessTeamRole = 'owner' | 'admin' | 'member';

export const BUSINESS_TEAM_ROLE_KEY = 'picks_business_team_role';
export const BUSINESS_MEMBER_KEY = 'picks_business_member';

const read = (key: string): string => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

export function getBusinessTeamRole(): BusinessTeamRole {
  const v = read(BUSINESS_TEAM_ROLE_KEY);
  return v === 'admin' || v === 'member' ? v : 'owner';
}

/** 초대로 들어온 직원 계정인지(결제 · 해지는 못 한다). */
export const isBusinessTeamMember = (): boolean => getBusinessTeamRole() !== 'owner';

/** 직원 계정이면 직원 자신의 아이디 · 이름. */
export function getBusinessMember(): { username: string; name: string } | null {
  try {
    const parsed = JSON.parse(read(BUSINESS_MEMBER_KEY) || 'null');
    return parsed && typeof parsed.username === 'string' ? { username: parsed.username, name: String(parsed.name || '') } : null;
  } catch {
    return null;
  }
}

/** 로그인 응답의 팀 정보를 저장한다. 회사 관리자 계정이면 직원 정보를 지운다. */
export function rememberBusinessTeam(result: { team_role?: unknown; member_username?: unknown; member_name?: unknown }): void {
  try {
    const role = result.team_role === 'admin' || result.team_role === 'member' ? result.team_role : 'owner';
    localStorage.setItem(BUSINESS_TEAM_ROLE_KEY, role);
    if (role !== 'owner' && typeof result.member_username === 'string') {
      localStorage.setItem(BUSINESS_MEMBER_KEY, JSON.stringify({ username: result.member_username, name: String(result.member_name || '') }));
    } else {
      localStorage.removeItem(BUSINESS_MEMBER_KEY);
    }
  } catch {
    // 저장하지 못해도 서버가 권한을 다시 확인한다.
  }
}

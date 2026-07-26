/**
 * 캠페인 협업 — 모집 마감 판정(클라이언트 측).
 *
 * 서버(`netlify/functions/_shared/campaign-recruit.mts`)와 동일한 기준을 쓴다.
 * 목록 API가 이미 마감된 캠페인을 걸러 주지만, 캐시된 응답이나 이전에 열어둔
 * 화면 때문에 마감된 캠페인이 남아 있을 수 있어 화면에서도 한 번 더 확인한다.
 *
 * 판정 기준
 *   - 브랜드가 직접 마감(status !== 'active')
 *   - 모집 종료일(end_date)이 지남 — 한국 시간 기준, 종료일 당일까지는 모집중
 *
 * 모집 인원(max_applicants)은 마감 기준이 **아니다**. 정원이 차도 지원은 계속
 * 받는다 — 지원자가 많을수록 브랜드가 더 나은 크리에이터를 고를 수 있다.
 */

type CampaignLike = {
  status?: string | null;
  end_date?: string | null;
  max_applicants?: number | string | null;
  application_count?: number | string | null;
  recruit_closed?: boolean;
};

/** 오늘 날짜(Asia/Seoul)를 'YYYY-MM-DD'로 반환. */
export const todayInSeoul = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

const toDateKey = (value?: string | null): string | null => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

/** 모집 종료일이 지났는지 여부. 종료일이 없으면 상시 모집으로 본다. */
export const isPastDeadline = (endDate?: string | null): boolean => {
  const deadline = toDateKey(endDate);
  if (!deadline) return false;
  return todayInSeoul() > deadline;
};

/**
 * 마감까지 남은 일수. 종료일이 없으면 null, 오늘이 종료일이면 0.
 * 이미 지났으면 음수를 돌려주므로 표시 전에 isPastDeadline로 걸러야 한다.
 */
export const daysUntilDeadline = (endDate?: string | null): number | null => {
  const deadline = toDateKey(endDate);
  if (!deadline) return null;
  const today = todayInSeoul();
  const diff = Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(diff)) return null;
  return Math.round(diff / 86400000);
};

/** 모집 인원을 채웠는지 여부. 마감 판정이 아니라 "정원 달성" 표시에만 쓴다. */
export const isQuotaReached = (campaign: CampaignLike): boolean => {
  const max = Number(campaign.max_applicants ?? 0);
  if (!Number.isFinite(max) || max <= 0) return false;
  const count = Number(campaign.application_count ?? 0);
  if (!Number.isFinite(count)) return false;
  return count >= max;
};

/** 종료일이 지났으면 true (브랜드가 누른 마감은 별도). */
export const isRecruitClosed = (campaign: CampaignLike): boolean =>
  campaign.recruit_closed === true || isPastDeadline(campaign.end_date);

/** 지원을 받을 수 없는 상태이면 true. 목록 노출 여부의 최종 기준. */
export const isCampaignClosed = (campaign: CampaignLike): boolean =>
  (campaign.status !== undefined && campaign.status !== null && campaign.status !== 'active') ||
  isRecruitClosed(campaign);

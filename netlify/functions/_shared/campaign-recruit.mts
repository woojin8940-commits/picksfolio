/**
 * 캠페인 협업 — 모집 마감 판정 헬퍼.
 *
 * `campaigns.status`는 브랜드가 직접 "마감" 버튼을 눌렀을 때만 'inactive'로 바뀐다.
 * 여기에 더해 **모집 종료일(end_date)이 지난** 캠페인도 지원을 받을 수 없으므로
 * 목록에서 노출하지 않는다. 종료일 경과 건은 예약 함수
 * (`scheduled-campaign-close`)가 하루 한 번 status까지 정리하지만, 그 사이에
 * 노출되지 않도록 조회 시점에도 같은 기준으로 한 번 더 판정한다.
 *
 * 모집 인원(max_applicants)은 **마감 기준이 아니다.** 정원이 차더라도 지원은 계속
 * 받는다 — 지원자가 많을수록 브랜드가 더 나은 크리에이터를 고를 수 있기 때문이다.
 * 정원은 "이만큼 뽑겠다"는 목표치이자 화면 표시용 값으로만 쓴다.
 *
 * 날짜 비교는 서비스 기준 시간대인 한국 시간(Asia/Seoul)으로 한다.
 * end_date는 TEXT 컬럼이고 값은 <input type="date">가 만든 'YYYY-MM-DD'
 * 형식이거나 과거 데이터의 ISO 타임스탬프이므로, 앞 10자리만 잘라
 * 문자열끼리 비교한다(사전순 비교 = 날짜순 비교).
 */

export type CampaignRecruitFields = {
  end_date?: string | null;
  max_applicants?: number | string | null;
  application_count?: number | string | null;
};

/** 오늘 날짜(Asia/Seoul)를 'YYYY-MM-DD'로 반환. */
export function todayInSeoul(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** end_date 값에서 'YYYY-MM-DD' 부분만 추출. 형식이 다르면 null. */
export function toDateKey(value?: string | null): string | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * 모집 종료일이 지났는지 여부.
 * 종료일 당일까지는 지원 가능하며, 종료일이 없으면(상시 모집) 마감되지 않는다.
 */
export function isPastDeadline(endDate?: string | null, today: string = todayInSeoul()): boolean {
  const deadline = toDateKey(endDate);
  if (!deadline) return false;
  return today > deadline;
}

/**
 * 모집 인원을 채웠는지 여부.
 * 마감 판정에는 쓰지 않고(정원이 차도 지원은 계속 받는다) "정원 달성" 표시에만 쓴다.
 */
export function isQuotaReached(campaign: CampaignRecruitFields): boolean {
  const max = Number(campaign.max_applicants ?? 0);
  if (!Number.isFinite(max) || max <= 0) return false;
  const count = Number(campaign.application_count ?? 0);
  if (!Number.isFinite(count)) return false;
  return count >= max;
}

/** 모집이 끝났는지 여부 = 종료일 경과. 목록 노출·지원 접수의 공통 기준. */
export function isRecruitClosed(campaign: CampaignRecruitFields, today: string = todayInSeoul()): boolean {
  return isPastDeadline(campaign.end_date, today);
}

import { getStore } from "@netlify/blobs";
import { mutateBlobJSON, BlobWriteConflictError } from "./blob-write.mts";

/**
 * 협업 현황(정산금 / 협업 내역)이 쓰는 Blobs 키와, 배열 한 덩어리를 통째로
 * 읽고 다시 쓰는 코드가 여러 함수에 흩어져 있었다. 같은 로직을 각자 복사해
 * 두면 파싱 규칙이나 동시성 처리가 한쪽만 고쳐지므로 여기로 모았다.
 */

export const SETTLEMENTS_STORE = "settlements";
export const COLLABS_STORE = "collabs";

export const settlementBizKey = (username: string) =>
  `settlements_biz_${username.toLowerCase().replace(/^biz\//, "")}`;
export const settlementInfKey = (username: string) =>
  `settlements_inf_${username.toLowerCase()}`;
export const collabsKey = (username: string) => `collabs_${username.toLowerCase()}`;

/**
 * 금액 파싱. 화면에서 입력된 값은 "500,000" 이나 "500,000원" 처럼 표시용
 * 서식이 붙은 문자열로 저장될 수 있는데, parseInt는 첫 콤마에서 멈춰서
 * 500,000이 500이 된다. 숫자만 남긴 뒤 파싱한다.
 */
export function parseAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : 0;
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 과거에 저장된 { records: [] } / { settlements: [] } 형태도 배열로 받아준다. */
export function toRecordArray(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.records)) return obj.records;
    if (Array.isArray(obj.settlements)) return obj.settlements;
  }
  return [];
}

export async function readRecords(storeName: string, key: string): Promise<any[]> {
  const store = getStore(storeName);
  return toRecordArray(await store.get(key, { type: "json" }));
}

export class RecordWriteConflictError extends Error {
  constructor(key: string) {
    super(`Concurrent write conflict on "${key}"`);
    this.name = "RecordWriteConflictError";
  }
}

/**
 * 배열 전체를 읽어 수정하고 다시 쓰는 방식은, 두 요청이 겹치면 나중에 쓴 쪽이
 * 앞선 변경을 덮어써서 조용히 사라진다(정산 항목 추가와 상태 변경이 동시에
 * 일어나는 경우). ETag 조건부 쓰기로 그 사이 값이 바뀌었는지 확인하고,
 * 바뀌었으면 최신 값으로 다시 계산한다.
 *
 * mutate가 null을 반환하면 쓰지 않고 끝낸다(변경할 것이 없는 경우).
 */
export async function mutateRecords(
  storeName: string,
  key: string,
  mutate: (records: any[]) => any[] | null,
  attempts = 4,
): Promise<any[]> {
  try {
    const next = await mutateBlobJSON<any>(
      storeName,
      key,
      (current) => mutate(toRecordArray(current)),
      attempts,
    );
    return toRecordArray(next);
  } catch (err) {
    if (err instanceof BlobWriteConflictError) throw new RecordWriteConflictError(key);
    throw err;
  }
}

/**
 * 제안/캠페인 수락 시 만들어지는 정산 항목. 업체와 인플루언서 양쪽 키에 같은
 * 내용을 넣는데, proposal_id로 중복을 막는다.
 */
export async function addSettlementForProposal(settlement: {
  proposal_id: string;
  business_username: string;
  influencer_username: string;
  [key: string]: unknown;
}): Promise<void> {
  const dedupe = (records: any[]) =>
    records.some((s: any) => s.proposal_id === settlement.proposal_id) ? null : [...records, settlement];

  const targets: string[] = [];
  // business_username이 비어 있으면 `settlements_biz_` 라는 공용 키에 남의
  // 정산이 섞여 들어간다. 주인이 없는 정산은 인플루언서 쪽에만 남긴다.
  if (settlement.business_username) targets.push(settlementBizKey(settlement.business_username));
  if (settlement.influencer_username) targets.push(settlementInfKey(settlement.influencer_username));

  for (const key of targets) {
    await mutateRecords(SETTLEMENTS_STORE, key, dedupe);
  }
}

/** 제안이 삭제되면 그 제안에서 파생된 정산 항목도 같이 지운다. */
export async function removeSettlementsForProposal(
  proposalId: string,
  businessUsername: string,
  influencerUsername: string,
): Promise<void> {
  const filterOut = (records: any[]) => {
    const next = records.filter((s: any) => s.proposal_id !== proposalId);
    return next.length === records.length ? null : next;
  };

  const targets: string[] = [];
  if (businessUsername) targets.push(settlementBizKey(businessUsername));
  if (influencerUsername) targets.push(settlementInfKey(influencerUsername));

  for (const key of targets) {
    await mutateRecords(SETTLEMENTS_STORE, key, filterOut);
  }
}

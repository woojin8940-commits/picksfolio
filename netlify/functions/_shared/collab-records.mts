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

/**
 * 이미 있는 정산 항목을 고친다. 없으면 만든다.
 *
 * `addSettlementForProposal` 은 proposal_id 로 중복만 막고 값은 절대 건드리지 않는다
 * — 업로드 확인 때 한 번 예약하고 끝나는 용도라서 그렇게 두었다. 담당자가 실제
 * 지급일과 지급 완료를 나중에 적어 넣으려면 같은 줄을 갱신해야 한다.
 *
 * 업체 키와 인플루언서 키 양쪽에 같은 내용을 쓴다. 한쪽만 고치면 "브랜드는 지급했다는데
 * 나는 예정으로 보인다"가 화면 차이에서 생긴다.
 *
 * @param patch 덮어쓸 필드. undefined 인 필드는 기존 값을 그대로 둔다.
 * @param fallback 항목이 아직 없을 때 새로 만들 때 쓰는 나머지 필드.
 */
export async function upsertSettlementForProposal(
  proposalId: string,
  businessUsername: string,
  influencerUsername: string,
  patch: Record<string, unknown>,
  fallback: Record<string, unknown> = {},
): Promise<void> {
  if (!proposalId) return;
  const now = new Date().toISOString();
  // undefined 를 그대로 펼치면 기존 값을 지운다. 값이 있는 필드만 남긴다.
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

  const apply = (records: any[]) => {
    const idx = records.findIndex((s: any) => s?.proposal_id === proposalId);
    if (idx === -1) {
      return [
        ...records,
        {
          id: `stl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          proposal_id: proposalId,
          business_username: businessUsername,
          influencer_username: influencerUsername,
          status: "scheduled",
          created_at: now,
          ...fallback,
          ...changes,
          updated_at: now,
        },
      ];
    }
    const next = [...records];
    next[idx] = { ...records[idx], ...changes, updated_at: now };
    return next;
  };

  const targets: string[] = [];
  if (businessUsername) targets.push(settlementBizKey(businessUsername));
  if (influencerUsername) targets.push(settlementInfKey(influencerUsername));

  for (const key of targets) {
    await mutateRecords(SETTLEMENTS_STORE, key, apply);
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

/**
 * 캠페인 협업에서 확정된 일정을 협업 내역(협업 현황 → 협업 내역 · 캘린더)에 올린다.
 *
 * 협업 내역은 원래 사용자가 직접 남기는 기록과 정산 항목에서 파생된 항목으로만
 * 채워졌다. 정산 항목은 업로드 확인 뒤에야 생기므로, 협업이 확정된 시점부터 몇 주
 * 동안은 캘린더에 그 협업이 존재하지 않았다. 담당자가 기간을 확인해 체크하면 그
 * 즉시 이 함수가 협업 내역에 한 줄을 만든다.
 *
 * 같은 협업은 언제 다시 체크해도 한 줄이어야 하므로 `collab_id` 로 찾아 갱신한다
 * (id 는 처음 만든 값을 유지한다 — 사용자가 그 줄을 수정·삭제한 적이 있어도
 * 가리키는 대상이 바뀌지 않는다).
 */
export type CollabScheduleRecordInput = {
  collabId: string;
  influencerUsername: string;
  title: string;
  companyName: string;
  category: "광고" | "커머스" | "기타";
  /** 협업 시작일 (YYYY-MM-DD). */
  date: string;
  /** 협업 종료일 (YYYY-MM-DD). 비면 하루짜리로 본다. */
  endDate?: string;
  fee: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  memo?: string;
  confirmedBy: string;
  /**
   * 이 일정이 어느 경로에서 왔는지. 담당자 리스트업/지원으로 진행되는 캠페인
   * 협업은 "campaign_collab", 비즈니스 제안 수락으로 성사된 협업은
   * "business_proposal". 화면은 CollabRecord 필드만 읽으므로 표시에는 영향이
   * 없고, 나중에 어느 경로가 일정을 만들었는지 확인할 때 쓴다.
   */
  source?: "campaign_collab" | "business_proposal";
};

export async function upsertCollabScheduleRecord(
  input: CollabScheduleRecordInput,
): Promise<{ record: any; created: boolean } | null> {
  const username = input.influencerUsername.toLowerCase().replace(/^biz\//, "");
  if (!username) return null;

  const now = new Date().toISOString();
  let created = false;
  let saved: any = null;

  await mutateRecords(COLLABS_STORE, collabsKey(username), (records) => {
    const idx = records.findIndex((r: any) => r?.collab_id === input.collabId);
    const base = idx === -1 ? null : records[idx];
    created = idx === -1;

    const record = {
      ...(base || {}),
      id: base?.id || `collab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: input.title,
      company_name: input.companyName,
      category: input.category,
      date: input.date,
      end_date: input.endDate || "",
      fee: parseAmount(input.fee),
      status: input.status,
      memo: input.memo || "",
      // 출처 표시. 협업 내역 화면은 CollabRecord 필드만 읽으므로 화면에는 영향이
      // 없고, 담당자가 다시 체크할 때 같은 줄을 찾는 근거가 된다.
      collab_id: input.collabId,
      source: input.source || "campaign_collab",
      schedule_confirmed_by: input.confirmedBy,
      schedule_confirmed_at: now,
      created_at: base?.created_at || base?.createdAt || now,
      updated_at: now,
    };

    saved = record;
    if (idx === -1) return [...records, record];
    const next = [...records];
    next[idx] = record;
    return next;
  });

  return saved ? { record: saved, created } : null;
}

/**
 * 자동 등록된 일정을 지운다(제안이 삭제될 때).
 *
 * 사람이 직접 적은 협업 내역은 절대 건드리지 않는다 — collab_id 가 붙은 줄,
 * 즉 이 함수/`upsertCollabScheduleRecord` 가 만든 줄만 찾아서 지운다.
 */
export async function removeCollabScheduleRecord(
  collabId: string,
  influencerUsername: string,
): Promise<void> {
  const username = influencerUsername.toLowerCase().replace(/^biz\//, "");
  if (!username || !collabId) return;

  await mutateRecords(COLLABS_STORE, collabsKey(username), (records) => {
    const next = records.filter((r: any) => r?.collab_id !== collabId);
    return next.length === records.length ? null : next;
  });
}


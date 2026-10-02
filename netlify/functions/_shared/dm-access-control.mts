/**
 * 인플루언서 자동 디엠 이용 자격.
 *
 * 인플루언서의 자동 디엠은 결제가 아니라 **브랜드 매칭받기 등록**으로 열린다. 매칭
 * 풀에 들어와 캠페인 제안을 받을 사람에게 주는 혜택이라, 등록서를 내면 바로 쓰고
 * 등록을 취소하면(행이 지워진다) 함께 멈춘다.
 *
 * 시간이 지났다고 자동으로 막지는 않는다. 제안을 못 받은 것은 담당자가 리스트업을
 * 못 해 준 운영 쪽 사정일 수 있기 때문이다. 대신 제안을 계속 거절하는 사람은 담당자가
 * 관리 화면(api-manager-dm-access)에서 받은 제안 · 거절 · 디엠 사용량을 보고 직접
 * 중단한다. 중단한 사람이 담당자가 리스트업한 **유가시딩(광고비 지급형)** 제안을
 * 수락하면 자동으로 다시 열린다(reopenDmAccessOnPaidListupAccept). 제품 협찬 · 공동구매 ·
 * 직접 지원으로 성사된 협업은 다시 여는 근거가 되지 않는다.
 *
 * 조회가 실패하면 막는다(fail-closed) — 판정 근거를 읽지 못한 채 여는 쪽보다, 잠시
 * 안내 화면을 보고 다시 여는 쪽이 낫다.
 */

import { getDatabase } from "@picks/netlify-database";
import { normalizeRewardMode } from "./reward-mode.mts";

const clean = (username: string | null | undefined) =>
  String(username || "").trim().toLowerCase().replace(/^biz\//, "").replace(/^@+/, "");

export type InfluencerDmAccess = {
  /** 브랜드 매칭받기(인플루언서) 등록서가 있는지. */
  registered: boolean;
  /** 담당자가 중단했는지. */
  suspended: boolean;
  /** 중단 사유(인플루언서 화면에 그대로 보여 준다). */
  reason: string;
  /** 지금 자동 디엠을 쓸 수 있는지(registered && !suspended). */
  allowed: boolean;
};

/** 인플루언서 자동 디엠 자격을 읽는다. 조회 실패는 null. */
export async function readInfluencerDmAccess(
  username: string | null | undefined,
): Promise<InfluencerDmAccess | null> {
  const name = clean(username);
  if (!name) return { registered: false, suspended: false, reason: "", allowed: false };
  try {
    const db = getDatabase();
    const [registration, control] = await Promise.all([
      db.sql`
        SELECT 1 FROM collab_directory_applications
        WHERE role = 'influencer' AND LOWER(applicant_username) = ${name}
        LIMIT 1
      `,
      db.sql`
        SELECT suspended, reason FROM dm_access_controls WHERE username = ${name} LIMIT 1
      `,
    ]);
    const registered = registration.length > 0;
    const suspended = !!control[0]?.suspended;
    return {
      registered,
      suspended,
      reason: suspended ? String(control[0]?.reason || "") : "",
      allowed: registered && !suspended,
    };
  } catch (e) {
    console.warn("[dm-access-control] lookup failed:", (e as Error)?.message);
    return null;
  }
}

/** 담당자가 자동 디엠을 중단한다. */
export async function suspendDmAccess(username: string, reason: string, actor: string): Promise<void> {
  const name = clean(username);
  const db = getDatabase();
  await db.sql`
    INSERT INTO dm_access_controls (username, suspended, reason, suspended_by, suspended_at, updated_at)
    VALUES (${name}, TRUE, ${reason}, ${actor}, NOW(), NOW())
    ON CONFLICT (username) DO UPDATE SET
      suspended = TRUE, reason = EXCLUDED.reason, suspended_by = EXCLUDED.suspended_by,
      suspended_at = NOW(), updated_at = NOW()
  `;
  await db.sql`
    INSERT INTO dm_access_events (username, action, reason, actor)
    VALUES (${name}, 'suspend', ${reason}, ${actor})
  `;
}

/** 담당자가 (또는 제안 수락으로 자동으로) 자동 디엠을 다시 연다. 중단 상태였을 때만 true. */
export async function reopenDmAccess(username: string, actor: string, reason = ""): Promise<boolean> {
  const name = clean(username);
  const db = getDatabase();
  const rows = await db.sql`
    UPDATE dm_access_controls
    SET suspended = FALSE, reopened_by = ${actor}, reopened_at = NOW(), updated_at = NOW()
    WHERE username = ${name} AND suspended = TRUE
    RETURNING username
  `;
  if (rows.length === 0) return false;
  await db.sql`
    INSERT INTO dm_access_events (username, action, reason, actor)
    VALUES (${name}, ${actor.startsWith("auto:") ? "auto_reopen" : "reopen"}, ${reason}, ${actor})
  `;
  return true;
}

/** 담당자 메모를 남긴다(중단 여부는 바꾸지 않는다). */
export async function saveDmAccessNote(username: string, note: string, actor: string): Promise<void> {
  const name = clean(username);
  const db = getDatabase();
  await db.sql`
    INSERT INTO dm_access_controls (username, note, updated_at)
    VALUES (${name}, ${note}, NOW())
    ON CONFLICT (username) DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()
  `;
  await db.sql`
    INSERT INTO dm_access_events (username, action, reason, actor)
    VALUES (${name}, 'note', ${note}, ${actor})
  `;
}

/**
 * 리스트업 제안을 수락했을 때 부른다. 그 캠페인이 유가시딩(광고비 지급형)이고 이
 * 사람이 중단 상태였다면 다시 연다. 수락 처리 자체를 막지 않도록 실패는 삼킨다.
 *
 * 리스트업은 담당자가 후보를 찾아 올리는 경로뿐이므로, 여기로 들어온 수락은 곧
 * "담당자가 리스트업한 캠페인 수락"이다. 제품 협찬 · 공동구매는 다시 여는 근거가
 * 아니다.
 */
export async function reopenDmAccessOnPaidListupAccept(input: {
  username: string;
  rewardMode: unknown;
  campaignTitle?: string;
}): Promise<void> {
  // 알 수 없는 값은 예전 캠페인과 같게 광고비 지급형으로 본다(reward-mode 규칙).
  if (normalizeRewardMode(input.rewardMode) !== "paid") return;
  try {
    await reopenDmAccess(
      input.username,
      "auto:listup",
      `유가시딩 제안 수락${input.campaignTitle ? ` · ${input.campaignTitle}` : ""}`,
    );
  } catch (e) {
    console.warn("[dm-access-control] auto reopen failed:", (e as Error)?.message);
  }
}

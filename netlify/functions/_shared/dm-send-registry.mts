import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

/**
 * DM 발송 대장(누구에게 무엇을 이미 보냈는지).
 *
 * 두 가지 문제를 같은 기록으로 해결한다.
 *
 * 1) 중복 발송 — 웹훅은 Meta 가 같은 댓글 이벤트를 재전송(재시도)하면 여러 번
 *    실행된다. 수동 일괄 발송도 사용자가 버튼을 다시 누르면 같은 댓글 작성자에게
 *    또 보낸다. 대장을 먼저 확인하면 같은 내용이 두 번 도착하지 않는다.
 *
 * 2) 실패 오판 — 인스타그램은 댓글 1건당 비공개 답장(private reply)을 1회만
 *    허용한다. 이미 보낸 댓글에 다시 시도하면 Graph API 가 오류를 돌려주는데,
 *    이걸 "발송 실패"로 표시하면 사용자는 이미 도착한 DM 을 보면서 화면의 빨간
 *    실패 메시지를 읽게 된다. 우리가 보냈다는 사실을 기록해 두면 그 상황을
 *    "이미 발송됨"으로 정확히 구분할 수 있다.
 *
 * 키 형식: `sent_<사용자명>/<종류>_<댓글ID>[_<내용해시>]`
 *   - `reply_<댓글ID>`            : 이 댓글에 비공개 답장을 이미 썼다.
 *   - `pubreply_<댓글ID>`         : 이 댓글에 공개 답글을 이미 달았다.
 *   - `dm_<댓글ID>_<내용해시>`     : 이 댓글 작성자에게 이 내용을 이미 보냈다.
 *
 * 내용해시를 함께 쓰기 때문에 "같은 사람에게 새로운 안내문을 다시 보내는" 정상
 * 사용은 막지 않는다. 막는 것은 같은 내용의 중복 발송뿐이다.
 *
 * 기록 자체가 실패하면(블롭 장애 등) 발송을 막지 않는다. 중복 위험보다 아예 안
 * 보내지는 쪽이 더 나쁘기 때문이다.
 */

const STORE = "dm-automation-sent";
/** 사용자당 보관할 최대 기록 수. */
const KEEP = 3000;
/** 정리를 시도할 확률. 매 발송마다 목록을 훑지 않기 위한 장치. */
const PRUNE_CHANCE = 0.05;

const prefixFor = (username: string) => `sent_${username.toLowerCase()}/`;

const store = () => getStore({ name: STORE, consistency: "strong" });

/** 비공개 답장(댓글 1건당 1회)을 이미 썼는지 표시하는 키. */
export const privateReplyKey = (commentId: string) => `reply_${commentId}`;

/** 공개 답글을 이미 달았는지 표시하는 키. */
export const publicReplyKey = (commentId: string) => `pubreply_${commentId}`;

/** 이 댓글 작성자에게 "이 내용"을 이미 보냈는지 표시하는 키. */
export const dmContentKey = (commentId: string, contentHash: string) =>
  `dm_${commentId}_${contentHash}`;

/**
 * 이 댓글에 자동 DM 을 이미 한 번 보냈는지 표시하는 키(내용과 무관).
 *
 * 내용해시 키만으로는 막지 못하는 구멍이 있다. Meta 는 응답이 늦으면 같은 댓글
 * 이벤트를 몇 시간 뒤까지 다시 보내는데, 그 사이 사용자가 문구를 고쳤다면
 * 내용해시가 달라져 선점이 통과된다. 게다가 비공개 답장은 이미 써버린 상태라
 * IGSID 직접 발송으로 넘어가므로 인스타그램의 "댓글당 1회" 제한에도 걸리지
 * 않는다. 결과는 댓글 하나에 예전 문구와 새 문구가 나란히 도착하는 것이다.
 *
 * 댓글 하나가 만들어 낼 수 있는 자동 DM 은 어떤 경우에도 1통이므로, 내용과
 * 무관한 댓글 단위 선점으로 막는다.
 */
export const commentDmKey = (commentId: string) => `cdm_${commentId}`;

/** 보낼 메시지 페이로드로부터 내용 해시를 만든다. */
export function contentHashOf(messages: unknown): string {
  return createHash("sha256").update(JSON.stringify(messages ?? null)).digest("hex").slice(0, 12);
}

/**
 * 문구 지문. 앞뒤 공백과 연속 공백 차이는 무시한다 — 인스타그램이 돌려주는
 * 에코 본문은 우리가 보낸 문자열과 공백 처리가 다를 수 있다.
 */
export function textFingerprint(text: string): string {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

const sentTextKey = (text: string) => `text_${textFingerprint(text)}`;

/**
 * 이 문구를 우리가 보냈다고 남긴다.
 *
 * 계정이 보낸 DM 에코를 웹훅으로 받았을 때 "우리가 보낸 것인지"를 판별하는 데
 * 쓴다(`_shared/dm-foreign-dm.mts`). 발송 직전에 남겨야 한다 — 에코가 발송
 * 응답보다 먼저 도착할 수 있다.
 */
export async function noteSentText(username: string, text: string): Promise<void> {
  const body = (text || "").trim();
  if (!username || !body) return;
  try {
    await store().set(
      `${prefixFor(username)}${sentTextKey(body)}`,
      JSON.stringify({ at: new Date().toISOString() }),
    );
  } catch (e) {
    console.warn("[dm-registry] note text failed:", (e as Error)?.message);
  }
}

/** 이 문구를 우리가 보낸 적이 있는지. 조회 실패 시 true(경고를 띄우지 않는다). */
export async function wasSentByUs(username: string, text: string): Promise<boolean> {
  const body = (text || "").trim();
  if (!username || !body) return true;
  try {
    const found = await store().get(`${prefixFor(username)}${sentTextKey(body)}`);
    return found !== null && found !== undefined;
  } catch {
    return true;
  }
}

/**
 * 아직 아무도 선점하지 않았다면 선점하고 true 를 돌려준다.
 * 이미 기록이 있으면 false — 호출부는 발송을 건너뛰어야 한다.
 *
 * 블롭의 조건부 쓰기(`onlyIfNew`)를 쓰기 때문에 웹훅이 동시에 여러 번 실행돼도
 * 한 쪽만 true 를 받는다.
 *
 * `setJSON` 이 아니라 `set` 을 쓰는 이유: 현재 `@netlify/blobs` 버전의 `setJSON`
 * 은 조건을 요청에 실어 보내지 않아 항상 `modified: true` 를 돌려준다(조건부
 * 쓰기가 무시된다). `set` 은 조건을 제대로 전달하므로 여기서는 값을 직접
 * 문자열로 만들어 넘긴다. 기록의 값은 아무도 읽지 않으므로 형식은 무관하다.
 */
export async function claimIfNew(username: string, key: string): Promise<boolean> {
  if (!username || !key) return true;
  try {
    const res = await store().set(
      `${prefixFor(username)}${key}`,
      JSON.stringify({ at: new Date().toISOString() }),
      { onlyIfNew: true },
    );
    if (res?.modified === false) return false;
    if (Math.random() < PRUNE_CHANCE) await pruneSentRegistry(username);
    return true;
  } catch (e) {
    console.warn("[dm-registry] claim failed:", (e as Error)?.message);
    return true;
  }
}

/** 선점을 되돌린다. 결국 아무것도 못 보낸 경우에 호출해 다음 시도를 막지 않는다. */
export async function release(username: string, key: string): Promise<void> {
  if (!username || !key) return;
  try {
    await store().delete(`${prefixFor(username)}${key}`);
  } catch (e) {
    console.warn("[dm-registry] release failed:", (e as Error)?.message);
  }
}

/**
 * 보관 한도를 넘긴 오래된 기록을 지운다.
 *
 * 인스타그램 댓글 ID 는 대체로 증가하므로 사전순 정렬이 대략 시간순이다. 한도를
 * 넘겨 지워지는 기록은 이미 아주 오래된 댓글이라, 그 시점에는 인스타그램 자체가
 * 비공개 답장·24시간 창을 이유로 재발송을 거부한다. 따라서 정리로 중복 발송이
 * 생길 위험은 사실상 없다.
 */
export async function pruneSentRegistry(username: string, keep = KEEP): Promise<void> {
  try {
    const s = store();
    const { blobs } = await s.list({ prefix: prefixFor(username) });
    if (blobs.length <= keep) return;
    const stale = blobs
      .map((b) => b.key)
      .sort()
      .slice(0, blobs.length - keep);
    await Promise.all(stale.map((key) => s.delete(key).catch(() => {})));
  } catch {
    // 정리는 실패해도 무방하다.
  }
}

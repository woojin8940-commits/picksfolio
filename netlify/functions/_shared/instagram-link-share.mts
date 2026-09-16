import { mutateBlobJSON } from "./blob-write.mts";
import { unindexDmAccount } from "./dm-webhook-index.mts";
import { unsubscribeInstagramWebhooks } from "./instagram-webhook-subscribe.mts";
import {
  deleteMetaLink,
  linkFeatureOff,
  linkIsUsable,
  loadMetaLink,
  type LinkFeature,
  type MetaLink,
} from "./instagram-metrics.mts";

/**
 * 세 화면(자동 디엠 · 인사이트 · 브랜드 매칭받기)이 인스타그램 연동 하나를 함께
 * 쓰게 하는 쓰기 쪽 절반.
 *
 * 예전에는 화면마다 연동을 따로 요구했다. 인사이트와 브랜드 매칭 등록에서 붙인
 * 연동은 캠페인용 보관함(collab)으로 들어가고 자동 디엠은 자기 보관함(dm)만 봤다.
 * 그래서 한 곳에서 연동을 마친 사람이 다른 화면에서 "계정을 먼저 연동해주세요"를
 * 다시 만났다 — 같은 계정에 같은 동의 화면을 세 번 지나고, 보관함마다 60일 만료를
 * 따로 세니 재연동도 세 번이었다.
 *
 * 이제 세 화면의 연동 버튼이 모두 공용 보관함(dm)에 쓰고, 읽는 쪽은
 * `resolveSharedLink` 가 두 보관함을 함께 본다. 이 파일은 그 전환의 나머지 절반이다.
 *
 *   adoptSharedInstagramLink   옛 collab 연동을 공용 보관함으로 옮겨 적는다.
 *                              바꾸기 전에 연동해 둔 사람이 다시 연동하지 않게.
 *   disconnectLinkFeature      해제는 누른 화면의 기능만 끈다. 연동이 하나가 됐어도
 *                              해제는 하나가 아니다.
 *
 * 연동은 하나인데 해제는 기능별인 이유는, 그 둘이 사람에게 다른 일이기 때문이다.
 * 연동은 번거로운 절차라 한 번으로 끝나는 것이 이득이지만, 해제는 "이 기능을
 * 그만 쓰겠다"는 뜻이다. 자동 디엠을 끊은 사람이 브랜드에게 보내던 숫자까지
 * 잃거나, 브랜드 매칭을 그만둔 사람의 자동 DM 이 함께 멈추면, 고르지도 않은 것을
 * 잃는다. 그래서 토큰은 남기고 꺼진 기능만 표시한다(`MetaLink.featuresOff`).
 */

/** 자동 디엠 설정 문서가 있는 곳. api-dm-automation 과 같아야 한다. */
const DM_STORE = "dm-automation";

/** 두 보관함이 공유하는 연동 필드. 자동화 규칙 같은 자동 디엠 고유 값은 건드리지 않는다. */
export interface SharedLinkFields {
  connected?: boolean;
  igUserId?: string;
  igAccountId?: string;
  igUsername?: string;
  accessToken?: string;
  tokenSource?: string;
  tokenExpiresAt?: string;
  needsReauth?: boolean;
  tokenInvalidAt?: string;
  webhookSubscribedAt?: string;
  webhookFields?: string;
  webhookHealedAt?: string;
  updatedAt?: string;
  /** 사람이 직접 끊은 기능 목록. `MetaLink.featuresOff` 와 같은 값이다. */
  featuresOff?: string[];
  /** 자동 디엠을 끊은 시각. 기록용이고 판단에는 쓰지 않는다. */
  disconnectedAt?: string;
}

/** 이 연동을 마지막으로 쓴 시각(없으면 0). 어느 쪽이 더 최근인지 가르는 값. */
const stampOf = (value: unknown): number => {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
};

/**
 * 캠페인·인사이트 쪽에 붙어 있는 연동을 자동 디엠 보관함으로 옮겨 적는다.
 *
 * 자동 디엠에 이미 쓸 수 있는 토큰이 있으면 아무 것도 하지 않는다. 사람이 자동
 * 디엠에서 직접 고른 계정이 다른 화면에서 붙인 계정으로 바뀌면, 자동 DM 이 본인이
 * 지정하지 않은 계정에서 나가게 된다.
 *
 * 자동 디엠 쪽 토큰이 죽어 있는 경우(needsReauth)에는 한 가지를 더 본다 — 가져올
 * 토큰이 그 죽음보다 나중에 받은 것인지다. 같은 계정을 두 화면에서 연동해 둔 사람은
 * 두 보관함에 사실상 같은 토큰을 갖고 있고, 그 토큰이 만료되면 죽은 쪽만 표시가
 * 남는다. 표시 없는 쪽을 "살아 있는 연동"으로 읽고 옮겨 적으면, 화면은 "연결됨"인데
 * 발송은 전부 실패하는 상태가 된다 — 정직한 "다시 연동해 주세요"보다 나쁘다.
 *
 * 웹훅 구독 기록(webhookFields 등)은 비워 둔다. 구독은 계정마다 따로 걸어야 하고
 * (`subscribed_apps`) 캠페인 연동은 그것을 걸지 않으므로, 기록을 지워 두면 곧바로
 * 뒤따르는 자기치유(healWebhookSubscription)가 댓글·메시지 구독을 새로 건다.
 * 그 구독이 없으면 화면은 "연동됨"인데 댓글에 자동 DM 이 나가지 않는다.
 *
 * 자동 디엠을 직접 끊어 둔 사람에게는 아무 것도 옮겨 적지 않는다. 옮겨 적으면 다음
 * 조회에서 방금 끊은 계정이 되살아나고, 해제 버튼은 눌러도 되돌아오는 버튼이 된다.
 *
 * @param current 방금 읽은 자동 디엠 설정.
 * @returns 이번 응답에 쓸 설정. 옮겨 적을 것이 없으면 받은 값 그대로.
 */
export async function adoptSharedInstagramLink<T extends SharedLinkFields>(
  username: string,
  current: T,
): Promise<T> {
  if (linkFeatureOff(current as MetaLink, "dm")) return current;
  if (linkIsUsable(current as MetaLink)) return current;

  const shared = await loadMetaLink(username, "collab");
  if (!linkIsUsable(shared)) return current;

  // 자동 디엠에 토큰이 남아 있다면 그것은 죽은 토큰이다(위에서 쓸 수 있는 경우를
  // 걸러 냈다). 가져올 토큰이 더 나중에 받은 것이라는 근거가 있어야 바꿔 끼운다.
  if (current.accessToken) {
    const deadAt = Math.max(stampOf(current.tokenInvalidAt), stampOf(current.updatedAt));
    if (stampOf(shared!.updatedAt) <= deadAt) return current;
  }

  const patch: SharedLinkFields = {
    connected: true,
    igUserId: String(shared!.igUserId || shared!.igAccountId || ""),
    igAccountId: String(shared!.igAccountId || shared!.igUserId || ""),
    igUsername: String(shared!.igUsername || ""),
    accessToken: shared!.accessToken,
    tokenSource: shared!.tokenSource,
    tokenExpiresAt: (shared as SharedLinkFields).tokenExpiresAt,
    updatedAt: shared!.updatedAt || new Date().toISOString(),
    // 살아 있는 토큰을 받았으니 지난 토큰이 남긴 재연동 표시는 더 이상 사실이 아니다.
    needsReauth: undefined,
    tokenInvalidAt: undefined,
    // 구독은 이 계정에 아직 걸려 있지 않다. 위 설명 참고.
    webhookSubscribedAt: undefined,
    webhookFields: undefined,
    webhookHealedAt: undefined,
  };

  const saved = await mutateBlobJSON<T>(DM_STORE, `dm_${username}`, (stored) => {
    // 이 호출을 읽는 사이에 사람이 자동 디엠에서 직접 연동했을 수 있다. 그 쪽이 우선이다.
    if (linkIsUsable(stored as MetaLink | null)) return null;
    return { ...(stored || current), ...patch } as T;
  }).catch((e) => {
    // 옮겨 적기에 실패해도 이번 화면은 아래 반환값으로 정상 동작한다. 다음 조회에서
    // 다시 시도된다 — 연동을 잃는 쪽이 아니라 한 번 더 읽는 쪽으로 실패한다.
    console.warn("[ig-link-share] 연동 옮겨 적기 실패:", (e as Error)?.message);
    return null;
  });

  return (saved as T) || ({ ...current, ...patch } as T);
}

/**
 * 해제를 누른 화면의 기능 하나만 끊는다.
 *
 * 연동 토큰은 지우지 않는다. 세 화면이 그 하나를 함께 쓰고 있어서, 자동 디엠에서
 * 해제를 누른 사람의 토큰을 지우면 인사이트의 숫자와 브랜드가 보는 명단까지 함께
 * 멈춘다 — 그 사람이 고른 것은 자동 DM 을 멈추는 일 하나였다. 대신 꺼진 기능만
 * 연동 문서에 적어 두고(`featuresOff`), 읽는 쪽이 자기 기능을 확인한다
 * (`resolveSharedLink(username, feature)`).
 *
 * 기능별로 실제 정리해야 하는 것이 다르다.
 *
 *   dm     자동화를 내리고(`enabled:false`) 웹훅 구독과 역인덱스를 함께 푼다.
 *          표시만 남기면 인스타그램은 댓글·메시지 이벤트를 계속 보내고, 우리는 그것을
 *          매번 읽어 "꺼져 있다"를 확인하는 헛일을 한다. 자동 응답 문구는 남긴다 —
 *          다시 연동한 뒤 처음부터 만들게 할 이유가 없다.
 *   collab 옛 캠페인 전용 보관함(collab)을 비운다. 기능 표시는 공용 문서에만
 *          적히므로, 그 보관함에 옛 토큰이 남아 있으면 해제한 기능이 그대로 살아난다.
 *          브랜드가 보는 명단의 출처를 내리는 일은 부르는 쪽(api-creator-channel)이
 *          같은 요청 안에서 한다 — 거기에 이미 데이터베이스 연결이 있다.
 *
 * @returns 웹훅 역인덱스에서 빠진 인스타그램 계정 ID 들. 무엇을 정리했는지 로그로
 *   남기고 싶을 때만 본다.
 */
export async function disconnectLinkFeature(
  username: string,
  feature: LinkFeature,
): Promise<string[]> {
  const now = new Date().toISOString();
  let unsubscribed: string[] = [];
  let token = "";
  let tokenSource = "";
  let igId = "";

  await mutateBlobJSON<SharedLinkFields & Record<string, unknown>>(
    DM_STORE,
    `dm_${username}`,
    (current) => {
      // 문서가 없는 경우. 브랜드 매칭 해제는 아래 collab 보관함 정리만으로 성립하니
      // 빈 설정을 남길 이유가 없다. 자동 디엠은 다르다 — 옛 캠페인 보관함의 연동을
      // 옮겨 적어 쓰고 있었다면, 표시를 적어 둘 문서가 없으면 다음 조회에서 그
      // 연동이 다시 옮겨 적혀 방금 끊은 계정이 되살아난다.
      if (!current) {
        return feature === "dm"
          ? { enabled: false, connected: false, featuresOff: ["dm"], disconnectedAt: now }
          : null;
      }

      const off = new Set(Array.isArray(current.featuresOff) ? current.featuresOff : []);
      off.add(feature);
      const next: SharedLinkFields & Record<string, unknown> = {
        ...current,
        featuresOff: Array.from(off),
      };

      // `updatedAt` 은 건드리지 않는다. 그 값은 "연동을 언제 붙였나"를 재는 자리이고
      // (`resolveSharedLink` 가 두 보관함 중 최신을 고르는 근거), 해제로 도장을 다시
      // 찍으면 방금 다른 화면에서 붙인 연동이 끊어 둔 쪽에 가려질 수 있다.
      if (feature === "dm") {
        unsubscribed = Array.from(
          new Set([current.igUserId, current.igAccountId].filter(Boolean) as string[]),
        );
        token = String(current.accessToken || "");
        tokenSource = String(current.tokenSource || "");
        igId = String(current.igUserId || current.igAccountId || "");
        // 보낼 곳 없는 자동화가 켜져 있으면 이벤트마다 조용히 실패한다.
        next.enabled = false;
        // 다시 연동할 때 구독을 새로 걸도록 기록도 비운다. 아래에서 실제 구독을 내린다.
        next.webhookSubscribedAt = undefined;
        next.webhookFields = undefined;
        next.webhookHealedAt = undefined;
        next.disconnectedAt = now;
      }
      return next;
    },
  );

  if (feature === "collab") {
    // 옛 캠페인 전용 연동. 여기에는 토큰과 계정 아이디밖에 없어 통째로 지운다.
    await deleteMetaLink(username, "collab").catch((e) => {
      console.warn("[ig-link-share] 옛 캠페인 연동 삭제 실패:", (e as Error)?.message);
    });
    return [];
  }

  // 역인덱스에서 자기 이름을 뺀다. 남겨 두면 연동을 끊은 뒤에도 이벤트가 들어올
  // 때마다 설정을 읽어 보는 헛일이 계속된다. 키를 통째로 지우지는 않는다 — 같은
  // 인스타그램 계정을 연동한 다른 사용자가 남아 있을 수 있다.
  let othersLeft: string[] = [];
  if (unsubscribed.length > 0) {
    othersLeft = await unindexDmAccount(username, unsubscribed).catch((e) => {
      console.warn("[ig-link-share] 웹훅 인덱스 정리 실패:", (e as Error)?.message);
      // 정리 상태를 모르는 채로 구독까지 내리면 남의 자동 DM 을 끊을 수 있다.
      // 모를 때는 내리지 않는 쪽으로 실패한다 — 이벤트는 위 표시로 이미 걸러진다.
      return ["unknown"];
    });
  }

  // 메타 쪽 구독을 실제로 내린다. 토큰이 남아 있는 해제라 이번에는 내릴 수 있다.
  // 같은 계정을 연동해 둔 다른 사용자가 남아 있으면 내리지 않는다 — 계정별 구독은
  // 계정 하나에 하나뿐이라, 내리면 그 사람의 자동 DM 까지 함께 멈춘다.
  if (token && othersLeft.length === 0) {
    const off = await unsubscribeInstagramWebhooks({ accessToken: token, tokenSource, igId });
    if (!off.ok) console.warn("[ig-link-share] 웹훅 구독 해제 실패:", off.error);
  }

  return unsubscribed;
}

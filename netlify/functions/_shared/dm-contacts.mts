import { getStore } from "@netlify/blobs";

/**
 * DM 을 보내온 사람들의 명단.
 *
 * 두 기능이 이 명단에 의존한다.
 *
 * 1) "처음 받은 DM 에만 인사말" — 인스타그램 웹훅은 "이 사람이 처음 보낸
 *    메시지인지"를 알려주지 않는다. 우리가 본 적 있는 상대인지 직접 기억해야
 *    하는데, 기억이 없으면 대화할 때마다 인사말이 다시 날아가 스팸처럼 읽힌다.
 *
 * 2) 예약 발송 대상 선택 — 인스타그램은 **상대가 마지막으로 메시지를 보낸 뒤
 *    24시간 안에만** 자유 형식 DM 을 허용한다(그 밖의 발송은 정책 위반이고
 *    Graph API 도 거부한다). 그래서 예약 발송은 IGSID 를 손으로 입력받는 게
 *    아니라, 최근에 DM 을 보내온 사람 중에서 고르게 해야 한다. 화면이 "언제까지
 *    보낼 수 있는지"를 계산할 수 있도록 마지막 수신 시각을 함께 보관한다.
 *
 * 키 형식: `contact_<사용자명>/<IGSID>` — 한 사람당 블롭 하나라 동시에 여러
 * 이벤트가 도착해도 서로의 기록을 덮어쓰지 않는다.
 */

const STORE = "dm-contacts";
/** 자유 형식 DM 이 허용되는 시간(인스타그램 24시간 창). */
export const DM_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DmContact {
  igsid: string;
  /** 조회에 성공한 경우의 표시 이름·아이디. 실패하면 비어 있다(IGSID 로 표시한다). */
  name?: string;
  username?: string;
  /** 처음 메시지를 받은 시각. */
  firstAt: string;
  /** 마지막으로 메시지를 받은 시각 — 24시간 창 계산의 기준. */
  lastAt: string;
  /** 마지막으로 받은 메시지 일부(대상을 알아보기 쉽게 화면에 보여준다). */
  lastText?: string;
  count: number;
  /**
   * 아직 이 상대에게서 "메시지"를 받은 적은 없다는 표시.
   *
   * 질문 버튼 클릭(postback)만으로 만들어진 기록에 붙는다. 버튼 클릭도 24시간 창을
   * 열어주므로 명단에는 있어야 하지만, 그것을 "처음 대화"로 소진해 버리면 이 사람이
   * 실제로 첫 메시지를 보낼 때 인사말이 나가지 않는다. 그래서 첫 메시지가 도착하면
   * 그때를 처음으로 보고 이 표시를 지운다.
   */
  awaitingFirstMessage?: boolean;
}

const prefixFor = (username: string) => `contact_${username.toLowerCase()}/`;
const keyFor = (username: string, igsid: string) => `${prefixFor(username)}${igsid}`;

const store = () => getStore({ name: STORE, consistency: "strong" });

export interface NoteContactResult {
  /** 이 계정에서 처음 보는 상대인지. 인사말 발송 여부를 이 값으로 정한다. */
  first: boolean;
  /**
   * 이번 메시지 **직전**에 이 상대에게서 마지막으로 메시지를 받은 시각.
   *
   * "한동안 조용했던 대화가 다시 시작됐는지"를 판단하려면 갱신 전 값이 필요하다.
   * 갱신 후 값(`contact.lastAt`)은 언제나 방금이므로 쓸 수 없다.
   */
  prevLastAt?: string;
  contact: DmContact | null;
}

/**
 * 메시지를 받았다는 사실을 기록하고, 처음 보는 상대인지 알려준다.
 *
 * 처음인지 판정은 조건부 쓰기(`onlyIfNew`)로 한다. 읽어서 없으면 쓰는 방식은 같은
 * 사람이 메시지를 연달아 보낼 때 두 실행이 동시에 "처음"이라고 판정해 인사말이
 * 두 번 나간다.
 */
export async function noteDmContact(args: {
  username: string;
  igsid: string;
  text?: string;
  name?: string;
  igHandle?: string;
  /**
   * 무엇을 받았는지.
   *  `message`(기본) — 실제로 도착한 DM.
   *  `postback`      — 질문 버튼 클릭. 24시간 창은 열리지만 "처음 대화"로는 세지
   *                    않는다(위 `awaitingFirstMessage` 참고).
   */
  kind?: "message" | "postback";
}): Promise<NoteContactResult> {
  const { username, igsid } = args;
  if (!username || !igsid) return { first: false, contact: null };
  const now = new Date().toISOString();
  const text = (args.text || "").slice(0, 120);
  const fromPostback = args.kind === "postback";

  const fresh: DmContact = {
    igsid,
    name: args.name || undefined,
    username: args.igHandle || undefined,
    firstAt: now,
    lastAt: now,
    lastText: text || undefined,
    count: 1,
    awaitingFirstMessage: fromPostback || undefined,
  };

  try {
    const s = store();
    const key = keyFor(username, igsid);
    const created = await s.set(key, JSON.stringify(fresh), { onlyIfNew: true });
    if (created?.modified !== false) return { first: !fromPostback, contact: fresh };

    const prev = ((await s.get(key, { type: "json" })) as DmContact | null) || null;
    // 버튼 클릭만 있던 상대가 드디어 메시지를 보냈다 — 이번이 "처음 대화"다.
    const firstMessage = !fromPostback && prev?.awaitingFirstMessage === true;
    const merged: DmContact = {
      ...(prev || fresh),
      igsid,
      name: args.name || prev?.name,
      username: args.igHandle || prev?.username,
      firstAt: prev?.firstAt || now,
      lastAt: now,
      lastText: text || prev?.lastText,
      count: (prev?.count || 0) + 1,
      awaitingFirstMessage: fromPostback ? prev?.awaitingFirstMessage : undefined,
    };
    await s.setJSON(key, merged);
    return { first: firstMessage, prevLastAt: prev?.lastAt, contact: merged };
  } catch (e) {
    // 기록에 실패했다면 "처음"이라고 단정하지 않는다 — 인사말 중복 발송이
    // 아무 인사말도 안 보내는 것보다 나쁘다.
    console.warn("[dm-contacts] note failed:", (e as Error)?.message);
    return { first: false, contact: null };
  }
}

export async function getDmContact(username: string, igsid: string): Promise<DmContact | null> {
  if (!username || !igsid) return null;
  try {
    return ((await store().get(keyFor(username, igsid), { type: "json" })) as DmContact) || null;
  } catch {
    return null;
  }
}

/** 최근에 메시지를 보내온 순서로 명단을 돌려준다. */
export async function listDmContacts(username: string, limit = 60): Promise<DmContact[]> {
  if (!username) return [];
  try {
    const s = store();
    const { blobs } = await s.list({ prefix: prefixFor(username) });
    const contacts = await Promise.all(
      blobs.slice(0, 300).map(async (b) => {
        try {
          return (await s.get(b.key, { type: "json" })) as DmContact | null;
        } catch {
          return null;
        }
      }),
    );
    return (contacts.filter(Boolean) as DmContact[])
      .sort((a, b) => Date.parse(b.lastAt || "") - Date.parse(a.lastAt || ""))
      .slice(0, limit);
  } catch (e) {
    console.warn("[dm-contacts] list failed:", (e as Error)?.message);
    return [];
  }
}

/** 지금 이 상대에게 자유 형식 DM 을 보낼 수 있는지(24시간 창). */
export function withinDmWindow(contact: DmContact | null, at: Date = new Date()): boolean {
  if (!contact) return false;
  const last = Date.parse(contact.lastAt || "");
  if (Number.isNaN(last)) return false;
  return at.getTime() - last <= DM_WINDOW_MS;
}

/**
 * 상대의 표시 이름을 조회한다.
 *
 * 대화 이력이 있는 상대만 응답하고, 그마저도 계정 상태에 따라 실패할 수 있다.
 * 실패하면 조용히 비워 둔다 — 이름이 없어도 발송에는 아무 지장이 없다.
 */
export async function fetchContactProfile(args: {
  host: string;
  graphVersion: string;
  igsid: string;
  accessToken: string;
}): Promise<{ name?: string; username?: string }> {
  const { host, graphVersion, igsid, accessToken } = args;
  if (!igsid || !accessToken) return {};
  try {
    const res = await fetch(
      `https://${host}/${graphVersion}/${encodeURIComponent(igsid)}?fields=name,username`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error) return {};
    return {
      name: typeof data?.name === "string" ? data.name : undefined,
      username: typeof data?.username === "string" ? data.username : undefined,
    };
  } catch {
    return {};
  }
}

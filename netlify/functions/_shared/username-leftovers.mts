import { getStore } from "@netlify/blobs";

/**
 * 계정은 없는데 예전 계정의 기록이 아이디에 남아 있는지(지워진 계정의 이름).
 *
 * 아이디에 묶인 기록은 계정을 지워도 남는다 — 멤버십 · 정기결제(seller-verification,
 * 예전에는 접두사 없는 키에도 있었다), 디엠 자동화 연동(dm-automation), 캠페인 등록
 * 연동(collab-instagram). 이름만 비었다고 내주면 새 계정이 예전 계정의 정기결제 카드와
 * 인스타그램 연동 토큰을 그대로 이어받는다 — 남의 인스타그램 계정으로 DM 을 보내는
 * 자동화를 손에 넣는 셈이다.
 *
 * 페이지(site_data)는 호출부가 따로 본다. 가입 경로마다 이미 그 조회를 갖고 있다.
 * 확인하지 못하면 예외를 던진다 — 호출부는 가입을 막는다.
 */
export async function usernameHasBlobLeftovers(username: string): Promise<boolean> {
  const clean = username.trim().toLowerCase();
  if (!clean) return false;
  const found = await Promise.all([
    getStore("seller-verification").getMetadata(`seller_${clean}`),
    getStore("seller-verification").getMetadata(clean),
    getStore("dm-automation").getMetadata(`dm_${clean}`),
    getStore("collab-instagram").getMetadata(`ig_${clean}`),
  ]);
  return found.some(Boolean);
}

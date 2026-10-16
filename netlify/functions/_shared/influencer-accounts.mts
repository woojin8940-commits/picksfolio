import { getSupabaseServer } from "./supabase.mts";

/**
 * 이름 목록 가운데 픽스폴리오 인플루언서 계정으로 가입한 사람만 골라 준다.
 *
 * 담당자 후보 풀은 채널 지표(creator_channels)와 협업 등록서를 겹쳐 만든다. 그런데
 * creator_channels 에는 브랜드 계정이 연동한 인스타도 같이 쌓이고, 등록서에는 가입
 * 없이(또는 탈퇴 뒤에) 남은 이름도 있다. 브랜드 계정에 제안을 보내거나 회원정보가
 * 없어 연락할 수 없는 사람을 명단에 올리면 안 되므로, 계정(profiles)이 있고 그
 * 역할이 인플루언서(role 이 비었거나 'user')인 이름만 남긴다. role 이 비어 있는
 * 계정을 인플루언서로 보는 규칙은 운영자 명부(api-admin-influencers)와 같다.
 *
 * 계정 조회가 실패하면 null 을 돌려준다. 그때는 부르는 쪽이 대신할 규칙을 고른다 —
 * 일시 장애로 후보 풀이 통째로 비면 담당자 일이 멈춘다.
 */
export async function influencerAccountsOf(usernames: string[]): Promise<Set<string> | null> {
  const names = Array.from(
    new Set(
      (usernames || [])
        .map((u) => String(u || "").trim().toLowerCase())
        .filter((u) => u && !u.startsWith("biz/")),
    ),
  );
  const out = new Set<string>();
  if (!names.length) return out;

  try {
    const supabase = getSupabaseServer();
    // 이름을 주소에 실어 보내므로 한 번에 너무 많이 묻지 않는다.
    for (let i = 0; i < names.length; i += 150) {
      const chunk = names.slice(i, i + 150);
      const { data, error } = await supabase
        .from("profiles")
        .select("username, role")
        .in("username", chunk);
      if (error) throw error;
      for (const row of data || []) {
        const role = String((row as any)?.role || "").trim();
        if (role && role !== "user") continue;
        const name = String((row as any)?.username || "").trim().toLowerCase();
        if (name) out.add(name);
      }
    }
    return out;
  } catch (e) {
    console.warn("[influencer-accounts] 계정 조회 실패:", (e as Error)?.message);
    return null;
  }
}

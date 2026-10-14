/**
 * 인스타그램 게시물 주소를 그 게시물 한 개를 여는 주소로 고친다.
 *
 * 저장된 주소에는 `/reels/코드/` 가 섞여 온다. 인플루언서가 릴스 탭에서 주소를
 * 복사해 붙여 넣으면 그 모양이 되는데, 이건 게시물 페이지가 아니라 "릴스 피드를
 * 이 영상부터 재생"하는 주소다. 웹에서는 이 주소가 자주 "문제가 발생했습니다"
 * 화면으로 열린다 — 옆 칸(`/reel/코드/`)은 멀쩡히 열리니 우리 링크가 고장 난
 * 것으로 보인다. `/tv/`, `계정/reel/코드` 처럼 오는 것도 있다.
 *
 * 게시물 코드만 꺼내 `/reel/코드/`(사진·캐러셀은 `/p/코드/`)로 다시 만든다. 뒤에
 * 붙은 `?igsh=` 같은 추적 파라미터도 같이 떨어진다. 인스타 게시물 주소가 아니면
 * 손대지 않고 돌려준다.
 */
const POST_PATH =
  /^(?:https?:)?\/\/(?:[a-z0-9-]+\.)?(?:instagram\.com|instagr\.am)\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)/i;

export const instagramPostUrl = (raw: string | null | undefined): string => {
  const value = String(raw || '').trim();
  if (!value) return '';
  const withScheme = /^(?:https?:)?\/\//i.test(value) ? value : `https://${value}`;
  const m = withScheme.match(POST_PATH);
  if (!m) return value;
  const kind = m[1].toLowerCase() === 'p' ? 'p' : 'reel';
  return `https://www.instagram.com/${kind}/${m[2]}/`;
};

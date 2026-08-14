/**
 * 다음(카카오) 우편번호 검색 — 필요할 때만 불러오는 공용 도우미.
 *
 * 주소를 손으로 적게 두면 우편번호가 비거나 도로명과 지번이 섞여 들어온다. 그 주소로
 * 택배를 부치는 쪽은 결국 되물어야 한다. 검색으로 받은 값만 우편번호·기본주소에 넣고
 * 사람은 상세주소만 적게 하면 그 왕복이 사라진다.
 *
 * SDK 는 화면이 뜰 때가 아니라 버튼을 누를 때 받는다 — 주소를 적는 화면은 몇 개
 * 안 되는데 번들에 항상 얹혀 있을 이유가 없다. 내려받지 못하면 조용히 실패하고
 * 직접 입력 칸이 그대로 남는다.
 */

export type PostcodeResult = {
  /** 5자리 우편번호. */
  postcode: string;
  /** 도로명 주소(없으면 지번 주소). */
  address: string;
};

let sdkPromise: Promise<any> | null = null;

const loadSdk = (): Promise<any> => {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if ((window as any).daum?.Postcode) return Promise.resolve((window as any).daum);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    script.onload = () => resolve((window as any).daum);
    // 실패한 약속을 남겨 두면 다음 클릭도 같은 실패를 되돌려준다.
    script.onerror = () => { sdkPromise = null; reject(new Error('postcode sdk load failed')); };
    document.head.appendChild(script);
  });
  return sdkPromise;
};

/**
 * 주소 검색 창을 띄우고 고른 주소를 돌려준다.
 *
 * 성공하면 true. SDK 를 못 받았으면 false 를 돌려주므로, 부르는 쪽은 "직접 입력해
 * 주세요" 한 줄만 띄우면 된다.
 */
export const openPostcodeSearch = async (onSelect: (result: PostcodeResult) => void): Promise<boolean> => {
  try {
    const daum = await loadSdk();
    new daum.Postcode({
      oncomplete: (data: any) => {
        onSelect({
          postcode: String(data?.zonecode || ''),
          address: String(data?.roadAddress || data?.jibunAddress || ''),
        });
      },
    }).open();
    return true;
  } catch {
    return false;
  }
};

/**
 * 업로드한 소재에서 목록에 쓸 작은 미리보기를 만든다.
 *
 * 직접 올린 소재로 만든 광고도 광고 현황에서 썸네일이 있어야 한다 — 카드가 소재 자리를
 * 비워 두면 목록에서 어느 광고가 무엇인지 그림으로 구분되지 않는다. 소재 원본은 메타
 * 광고 계정에만 올라가고(api-meta-ads-media), 우리 쪽 집행 기록에는 작게 줄인 이미지
 * 한 장만 남긴다.
 *
 * 창을 띄워 둔 동안의 미리보기는 blob URL 로 원본을 그대로 보여 주면 된다. 여기서 만드는
 * 것은 그다음 — 새로고침한 뒤에도 목록에 남아야 하는 쪽이다. blob URL 은 탭을 닫으면
 * 끊기므로 저장하면 깨진 이미지가 되고, 원본을 data URL 로 넣으면 집행 기록이 몇 MB 가
 * 된다. 240px 로 줄여 JPEG 로 굽는 이유가 그것이다.
 *
 * 영상 소재는 메타가 대표 이미지(썸네일)를 따로 요구해서, 같은 방법으로 큰 프레임을
 * 한 장 더 떠 광고 이미지로 올린다(maxEdge 를 크게 준다).
 */

/** 긴 변 기준 크기. 카드의 소재 자리는 56px 이라 레티나에서도 넉넉하다. */
const MAX_EDGE = 240;

const drawToDataUrl = (source: CanvasImageSource, width: number, height: number, maxEdge = MAX_EDGE): string => {
  if (!width || !height) return '';
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', maxEdge > MAX_EDGE ? 0.9 : 0.7);
};

const fromImage = (objectUrl: string, maxEdge?: number): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxEdge));
    img.onerror = () => resolve('');
    img.src = objectUrl;
  });

/** 영상은 첫 프레임을 한 장 떠서 쓴다. 못 뜨면 빈 값으로 두고 카드가 빈 자리로 그린다. */
const fromVideo = (objectUrl: string, maxEdge?: number): Promise<string> =>
  new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    video.muted = true;
    video.preload = 'metadata';
    video.onloadeddata = () => {
      // 0초 프레임은 검은 화면인 경우가 많아 살짝 넘겨서 뜬다.
      try {
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      } catch {
        finish(drawToDataUrl(video, video.videoWidth, video.videoHeight, maxEdge));
      }
    };
    video.onseeked = () => finish(drawToDataUrl(video, video.videoWidth, video.videoHeight, maxEdge));
    video.onerror = () => finish('');
    // 프레임을 못 뜨는 코덱(브라우저가 재생만 못 하는 경우)에서 영원히 기다리지 않는다.
    setTimeout(() => finish(''), 3000);
    video.src = objectUrl;
  });

/**
 * 파일에서 작은 미리보기 data URL 을 만든다. 실패는 빈 문자열로 돌려준다 —
 * 썸네일이 없다고 집행 요청을 막을 이유가 없다.
 */
export const makeCreativeThumbnail = async (file: File, objectUrl: string, maxEdge?: number): Promise<string> => {
  try {
    if (file.type.startsWith('video/')) return await fromVideo(objectUrl, maxEdge);
    if (file.type.startsWith('image/')) return await fromImage(objectUrl, maxEdge);
    return '';
  } catch {
    return '';
  }
};

/** 파일 크기를 사람이 읽는 단위로. 업로드 영역에 파일 이름과 같이 적는다. */
export const formatFileSize = (bytes: number): string => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

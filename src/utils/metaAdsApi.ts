import { authHeaders, fetchWithTimeout } from '../services/apiService';
import type { AdCta, AdObjective, AdPlacement } from './adBoosts';

/**
 * 메타 광고 집행·페이지 조회 — 화면에서 부르는 쪽.
 *
 * 서버 함수(netlify/functions/api-meta-ads-*)가 저장해 둔 토큰으로 메타 그래프를 부르고,
 * 여기서는 그 결과를 화면이 쓰는 모양으로 받는다. 화면이 스스로 만드는 값은 없다 —
 * 광고 상태·지표·페이지 목록·게시물 반응 모두 메타가 돌려준 그대로다(응답의 source 가
 * 'meta_graph_api' 이고 fetchedAt 이 조회 시각이다).
 */

const normalize = (username: string) => (username || '').replace(/^biz\//, '').toLowerCase().trim();

export type MetaApiError = { error: string; code?: string; metaErrorCode?: number; status: number };

/** 오류는 던지지 않고 값으로 돌려준다. 화면이 메타 문장을 그대로 보여 준다. */
export type MetaApiResult<T> = ({ ok: true } & T) | ({ ok: false } & MetaApiError);

async function call<T>(
  username: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<MetaApiResult<T>> {
  try {
    const res = await fetchWithTimeout(
      path,
      {
        ...init,
        headers: await authHeaders(
          init.body ? { 'Content-Type': 'application/json' } : {},
          { account: username },
        ),
      },
      timeoutMs,
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok && res.status !== 202) {
      // 단계 실패 응답에는 그때까지 만든 기록(record)이 같이 온다. 그대로 넘긴다.
      return {
        ...data,
        ok: false,
        status: res.status,
        error: String(data?.error || `요청에 실패했습니다. (HTTP ${res.status})`),
        code: data?.code,
        metaErrorCode: data?.metaErrorCode,
      };
    }
    return { ...(data as T), ok: true };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: aborted ? '응답이 늦어 요청을 멈췄습니다. 다시 시도해 주세요.' : '네트워크 오류로 요청하지 못했습니다.',
    };
  }
}

/** 토큰이 없거나 만료돼 다시 연동해야 하는 오류인지. */
export const needsReconnect = (res: { ok: boolean; code?: string }) =>
  !res.ok && typeof res.code === 'string' && res.code.startsWith('token_');

/* ---------------------------------------------------------------------------------------- */
/* 페이지                                                                                   */
/* ---------------------------------------------------------------------------------------- */

export type MetaPage = {
  id: string;
  name: string;
  category: string;
  link: string;
  pictureUrl: string;
  followers: number;
  instagramUserId: string;
  instagramUsername: string;
  /** 이 사람이 페이지에서 광고 작업(ADVERTISE) 권한을 가졌는지. */
  canAdvertise: boolean;
};

export const fetchMetaPages = (username: string) =>
  call<{ pages: MetaPage[]; fetchedAt: string; source: string }>(
    username,
    `/api/meta-ads/pages/${encodeURIComponent(normalize(username))}`,
  );

export type MetaPagePost = {
  id: string;
  message: string;
  createdTime: string;
  permalinkUrl: string;
  pictureUrl: string;
  reactions: number;
  comments: number;
  shares: number;
  engagement: number;
};

export type MetaPageEngagement = {
  page: { id: string; name: string; link: string; pictureUrl: string; followers: number };
  posts: MetaPagePost[];
  totals: { posts: number; reactions: number; comments: number; shares: number; engagement: number };
  fetchedAt: string;
  source: string;
};

export const fetchPageEngagement = (username: string, pageId: string) =>
  call<MetaPageEngagement>(
    username,
    `/api/meta-ads/pages/${encodeURIComponent(normalize(username))}/${encodeURIComponent(pageId)}/engagement`,
  );

/** 광고 현황과 캠페인 이력이 같은 페이지를 보도록 브라우저에 고른 페이지를 남긴다. */
const pageKey = (username: string) => `picks_meta_ad_page_${normalize(username)}`;
const PAGE_EVENT = 'picks:meta-ad-page-changed';

export const readSelectedPageId = (username: string): string => {
  try {
    return localStorage.getItem(pageKey(username)) || '';
  } catch {
    return '';
  }
};

export const writeSelectedPageId = (username: string, pageId: string) => {
  try {
    localStorage.setItem(pageKey(username), pageId);
  } catch {}
  try {
    window.dispatchEvent(new Event(PAGE_EVENT));
  } catch {}
};

export const subscribeSelectedPage = (onChange: () => void): (() => void) => {
  window.addEventListener(PAGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(PAGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};

/* ---------------------------------------------------------------------------------------- */
/* 소재 업로드                                                                              */
/* ---------------------------------------------------------------------------------------- */

const mediaPath = (username: string) => `/api/meta-ads/media/${encodeURIComponent(normalize(username))}`;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * 광고 이미지로 보낼 크기로 줄인다. 함수 요청 본문 상한(6MB) 안에 들어가야 하고,
 * 메타 피드 광고는 긴 변 1080~1440px 이면 충분하다.
 */
const MAX_AD_EDGE = 1440;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = src;
  });

async function imageForUpload(source: Blob | string): Promise<string> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_AD_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지를 줄이지 못했습니다.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9).replace(/^data:[^,]*,/, '');
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

/** 이미지 한 장을 광고 계정에 올리고 메타 이미지 해시를 받는다. */
export async function uploadAdImage(
  username: string,
  adAccountId: string,
  source: Blob | string,
): Promise<MetaApiResult<{ hash: string; url: string }>> {
  let bytes: string;
  try {
    bytes = await imageForUpload(source);
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error)?.message || '이미지를 준비하지 못했습니다.' };
  }
  return call(username, mediaPath(username), {
    method: 'POST',
    body: JSON.stringify({ kind: 'image', adAccountId, bytes }),
  }, 60_000);
}

/** 영상 조각 크기. base64 로 늘어나도(×4/3) 함수 본문 상한 안에 들어간다. */
const VIDEO_CHUNK = 4 * 1024 * 1024;

/**
 * 영상을 메타의 분할 업로드로 올린다. 조각마다 진행률을 알려 준다.
 * 메타가 다음 조각의 범위(start/end offset)를 정해 주므로 그 범위대로 자른다.
 */
export async function uploadAdVideo(
  username: string,
  adAccountId: string,
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<MetaApiResult<{ videoId: string }>> {
  const path = mediaPath(username);
  const start = await call<{ sessionId: string; videoId: string; startOffset: number; endOffset: number }>(
    username,
    path,
    { method: 'POST', body: JSON.stringify({ kind: 'video_start', adAccountId, fileSize: file.size }) },
  );
  if (!start.ok) return start;

  let startOffset = start.startOffset;
  let endOffset = start.endOffset;
  while (startOffset < endOffset) {
    const end = Math.min(endOffset, startOffset + VIDEO_CHUNK);
    const chunk = await blobToBase64(file.slice(startOffset, end));
    const res = await call<{ startOffset: number; endOffset: number }>(
      username,
      path,
      {
        method: 'POST',
        body: JSON.stringify({ kind: 'video_transfer', adAccountId, sessionId: start.sessionId, startOffset, chunk }),
      },
      120_000,
    );
    if (!res.ok) return res;
    startOffset = res.startOffset;
    endOffset = res.endOffset;
    onProgress?.(Math.min(1, startOffset / file.size));
  }

  const finish = await call<{ ok: boolean }>(username, path, {
    method: 'POST',
    body: JSON.stringify({ kind: 'video_finish', adAccountId, sessionId: start.sessionId, title: file.name }),
  });
  if (!finish.ok) return finish;
  onProgress?.(1);
  return { ok: true, videoId: start.videoId };
}

/* ---------------------------------------------------------------------------------------- */
/* 광고                                                                                     */
/* ---------------------------------------------------------------------------------------- */

export type MetaAdStep = 'campaign' | 'adset' | 'creative' | 'ad' | 'done';

export type MetaAdDisplayStatus = 'draft' | 'review' | 'active' | 'paused' | 'rejected' | 'issue' | 'ended';

/** 서버가 저장한 집행 기록(만든 메타 객체의 ID 와 픽스폴리오 쪽 맥락). */
export type MetaAdRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: 'partnership' | 'own';
  adAccountId: string;
  currency: string;
  step: MetaAdStep;
  error?: string;
  errorCode?: number;
  warnings: string[];
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
  initialStatus: 'ACTIVE' | 'PAUSED';
  objective: AdObjective;
  metaObjective?: string;
  name: string;
  headline?: string;
  bodyText?: string;
  cta?: AdCta;
  linkUrl?: string;
  pageId: string;
  pageName?: string;
  instagramUserId?: string;
  thumbnailUrl?: string;
  creativeKind?: 'image' | 'video';
  campaignTitle?: string;
  collabId?: string;
  campaignRef?: string;
  creatorHandle?: string;
  partnershipCode?: string;
  budgetKrw: number;
  startDate: string;
  endDate: string;
  ageBands: string[];
  regions: string[];
  placementMode: 'auto' | 'manual';
  placements: AdPlacement[];
};

/** 목록 조회 때 메타에서 새로 읽은 값. */
export type MetaAdLive = {
  displayStatus: MetaAdDisplayStatus;
  /** 메타의 effective_status 원문(광고 관리자와 같은 말). */
  effectiveStatus: string;
  configuredStatus?: string;
  campaignStatus?: string;
  reviewFeedback?: string[];
  issues?: string[];
  impressions?: number;
  clicks?: number;
  reach?: number;
  spend?: number;
  conversions?: number;
  conversionValue?: number;
};

export type MetaAdWithLive = MetaAdRecord & { meta: MetaAdLive };

const adsPath = (username: string) => `/api/meta-ads/ads/${encodeURIComponent(normalize(username))}`;

export const fetchMetaAds = (username: string, adAccountId?: string) =>
  call<{ ads: MetaAdWithLive[]; errors: string[]; fetchedAt: string; source: string }>(
    username,
    `${adsPath(username)}${adAccountId ? `?account=${encodeURIComponent(adAccountId)}` : ''}`,
  );

/** 집행하기에서 보내는 값. imageHash/videoId 는 업로드를 마친 뒤 채운다. */
export type MetaAdDraft = {
  source: 'partnership' | 'own';
  adAccountId: string;
  pageId: string;
  initialStatus: 'ACTIVE' | 'PAUSED';
  objective?: AdObjective;
  headline?: string;
  bodyText?: string;
  cta?: AdCta;
  linkUrl?: string;
  imageHash?: string;
  videoId?: string;
  creativeKind?: 'image' | 'video';
  thumbnailUrl?: string;
  campaignTitle?: string;
  collabId?: string;
  campaignRef?: string;
  creatorHandle?: string;
  partnershipCode?: string;
  budgetKrw: number;
  startDate: string;
  endDate: string;
  ageBands: string[];
  regions: string[];
  placementMode: 'auto' | 'manual';
  placements: string[];
};

type StepResult = MetaApiResult<{ record: MetaAdRecord; pending?: boolean }> & { record?: MetaAdRecord };

export const createMetaAd = (username: string, draft: MetaAdDraft) =>
  call<{ record: MetaAdRecord }>(username, adsPath(username), {
    method: 'POST',
    body: JSON.stringify({ action: 'create', draft }),
  }) as Promise<StepResult>;

export const continueMetaAd = (username: string, id: string) =>
  call<{ record: MetaAdRecord; pending?: boolean }>(username, adsPath(username), {
    method: 'POST',
    body: JSON.stringify({ action: 'continue', id }),
  }) as Promise<StepResult>;

/**
 * 멈춘 광고를 고친 설정으로 다시 만든다. 서버가 기록에 남은 캠페인을 지우고 캠페인부터
 * 다시 만들어 첫 단계 결과를 돌려준다 — 남은 단계는 runRemainingSteps 로 잇는다.
 * 직접 올린 소재는 파일을 바꾸지 않았으면 imageHash 를 비워 보낸다(기록의 소재를 쓴다).
 */
export const resumeMetaAd = (username: string, id: string, draft: Partial<MetaAdDraft>) =>
  call<{ record: MetaAdRecord }>(username, adsPath(username), {
    method: 'POST',
    body: JSON.stringify({ action: 'resume', id, draft }),
  }) as Promise<StepResult>;

/** 광고 기록을 지운다. removeFromMeta 면 메타 캠페인(아래 세트·광고 포함)도 지운다. */
export const deleteMetaAd = (username: string, id: string, removeFromMeta: boolean) =>
  call<{ ok: boolean }>(username, adsPath(username), {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', id, removeFromMeta }),
  });

export const setMetaAdStatus = (username: string, id: string, status: 'ACTIVE' | 'PAUSED') =>
  call<{ ok: boolean }>(username, adsPath(username), {
    method: 'POST',
    body: JSON.stringify({ action: 'status', id, status }),
  });

const ADS_EVENT = 'picks:meta-ads-changed';

/** 광고를 만들거나 상태를 바꾼 뒤, 광고 현황·캠페인 이력이 다시 읽도록 알린다. */
export const notifyMetaAdsChanged = () => {
  try {
    window.dispatchEvent(new Event(ADS_EVENT));
  } catch {}
};

export const subscribeMetaAds = (onChange: () => void): (() => void) => {
  window.addEventListener(ADS_EVENT, onChange);
  return () => window.removeEventListener(ADS_EVENT, onChange);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 기록이 만들어진 뒤 남은 단계(광고 세트 → 소재 → 광고)를 하나씩 진행한다.
 *
 * 영상 소재는 메타가 처리를 마칠 때까지 소재를 만들 수 없어서(202 pending), 잠시 기다렸다
 * 같은 단계를 다시 부른다. 실패하면 거기서 멈추고 기록을 돌려준다 — 광고 현황에서
 * '이어서 만들기' 로 같은 단계부터 다시 할 수 있다.
 */
export async function runRemainingSteps(
  username: string,
  record: MetaAdRecord,
  onStep: (record: MetaAdRecord, note?: string) => void,
): Promise<{ record: MetaAdRecord; error?: string }> {
  let current = record;
  let waits = 0;
  while (current.step !== 'done') {
    const res = await continueMetaAd(username, current.id);
    if (!res.ok) return { record: res.record || current, error: res.error };
    if (res.pending) {
      if (++waits > 40) return { record: current, error: 'Meta의 영상 처리가 길어지고 있습니다. 광고 현황에서 이어서 만들어 주세요.' };
      onStep(current, 'Meta가 영상을 처리하고 있습니다');
      await sleep(5000);
      continue;
    }
    current = res.record;
    onStep(current);
  }
  return { record: current };
}

/** 단계 이름(화면용). */
export const STEP_LABELS: { step: Exclude<MetaAdStep, 'done'>; label: string; idOf: (r: MetaAdRecord) => string | undefined }[] = [
  { step: 'campaign', label: '캠페인', idOf: (r) => r.campaignId },
  { step: 'adset', label: '광고 세트', idOf: (r) => r.adSetId },
  { step: 'creative', label: '광고 소재', idOf: (r) => r.creativeId },
  { step: 'ad', label: '광고', idOf: (r) => r.adId },
];

/** 메타 광고 관리자에서 이 캠페인을 여는 주소. */
export const adsManagerUrl = (r: Pick<MetaAdRecord, 'adAccountId' | 'campaignId'>) => {
  const act = r.adAccountId.replace(/^act_/, '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}${
    r.campaignId ? `&selected_campaign_ids=${r.campaignId}` : ''
  }`;
};

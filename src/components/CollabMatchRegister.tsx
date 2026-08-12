import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/apiService';
import { categoryOptions, joinCategoryList, parseCategoryList } from '../utils/creatorCategories';

// 캠페인 협업 "매칭 받기" 등록 버튼 + 모달.
// variant 로 역할을 고정한다:
//  - 'influencer' : 유저(크리에이터) 대시보드에서 사용. 항상 인플루언서로 지원하며
//    버튼/모달은 "브랜드 매칭 받기" 로 표시한다.
//  - 'brand'      : 비즈니스 대시보드에서 사용. 항상 브랜드(광고주)로 지원하며
//    버튼/모달은 "인플루언서 매칭 받기" 로 표시한다.
// 지원 유형 선택 UI 는 더 이상 노출하지 않는다(역할 고정).
//
// 인플루언서 등록은 이름·연락처를 받은 뒤 본인 인스타 계정을 연동하게 한다.
// 연동해 두면 팔로워·팔로잉과 최근 릴스 평균 조회수를 픽스폴리오가 직접 보관하므로,
// 브랜드가 명단에서 보는 숫자가 자기 입력값이 아니라 메타에서 확인한 값이 된다.
//
// 접수한 뒤에도 이 자리에서 두 가지를 계속 할 수 있어야 한다.
//  1) 연동한 계정의 팔로워·릴스 평균 조회수 확인(브랜드에게 전달되는 숫자다).
//  2) 광고 단가 수정 — 단가는 접수한 뒤에도 바뀐다(성수기·채널 성장·재계약).
//     고칠 방법이 "취소 후 재등록"뿐이면 접수 순서를 잃고, 운영자 명단에는 같은
//     사람이 두 번 지나간 것처럼 보인다. 그래서 접수한 등록서를 제자리에서 고친다.
interface Props {
  variant: 'influencer' | 'brand';
  applicantUsername: string;
  buttonClassName?: string;
}


const COPY = {
  influencer: {
    title: '브랜드 매칭 받기',
    subtitle: '내 채널 정보를 등록하면 조건에 맞는 브랜드를 매칭해 드립니다.',
  },
  brand: {
    title: '인플루언서 매칭 받기',
    subtitle: '원하는 조건을 등록하면 조건에 맞는 인플루언서를 매칭해 드립니다.',
  },
} as const;

/**
 * 인스타그램 연동은 메타로 나갔다 돌아오는 흐름이라 페이지가 새로 뜬다.
 * 작성 중이던 등록서를 잃지 않도록 나가기 전에 임시 저장하고, 돌아오면 복원한다.
 */
const DRAFT_KEY = 'picks_collab_match_draft';
/** 나가기 전에 수정 중이었는지. 돌아왔을 때 접수 화면 대신 수정 화면으로 되돌린다. */
const DRAFT_MODE_KEY = 'picks_collab_match_draft_mode';
/** 복귀 시 이 모달을 다시 열어야 한다는 표시. */
const RETURN_FLAG = 'collab_match';


/**
 * 접수 후 보여 줄 한 줄 안내. 키는 collab_directory_applications.status 값이다.
 * 'archived' 는 여기에 없다 — 보관 처리된 등록서는 다시 낼 수 있게 버튼을 되살린다.
 */
const SUBMITTED_NOTE: Record<string, string> = {
  pending: '등록이 완료되었습니다.',
  reviewed: '등록 정보를 확인했습니다.',
  contacted: '진행 중인 내용은 담당자와 확인해 주세요.',
};

interface InfluencerChannel {
  connected: boolean;
  handle: string;
  followers: number;
  following: number;
  avgViews: number;
  avgLikes: number;
  metricsSource: string;
  syncedAt: string;
  /**
   * 연동은 해 뒀지만 토큰이 죽어 다시 동의가 필요한 상태.
   *
   * 인스타그램 앱 권한을 지우거나 비밀번호를 바꾸면 저장해 둔 토큰이 무효가 된다.
   * 이때 갱신을 누르면 메타는 영문 오류로 답하는데, 그 문장을 그대로 띄우면 읽는
   * 사람은 자기가 뭘 잘못했는지 알 수 없다. 상태로 들고 있다가 "다시 연동"을 권한다.
   */
  needsReauth: boolean;
}

const emptyChannel: InfluencerChannel = {
  connected: false, handle: '', followers: 0, following: 0,
  avgViews: 0, avgLikes: 0, metricsSource: '', syncedAt: '', needsReauth: false,
};

const compact = (n: number) => {
  if (!n || n < 0) return '0';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}천`;
  return n.toLocaleString();
};

/** 토큰이 죽었을 때 하는 말. 카드와 안내 문구가 서로 다른 말을 하지 않도록 한 군데 둔다. */
const RECONNECT_TEXT = '인스타그램 연동이 만료되었어요. 아래 버튼으로 다시 연동하면 이어서 불러옵니다.';

/**
 * 화면에 올려도 되는 문구인지 마지막으로 거른다.
 *
 * 메타·네트워크 계층의 오류 원문은 영문이고, 앱 ID 같은 내부 값이 섞여 있다
 * ("Error validating access token: The user has not authorized application 45144…").
 * 그 문장은 읽는 사람에게 아무 것도 알려 주지 못하면서 화면만 고장 난 것처럼
 * 보이게 한다. 한글이 한 글자도 없으면 안내로 쓰지 않는다.
 */
const safeNotice = (raw: unknown) => {
  const text = String(raw || '').trim();
  if (!text || !/[가-힣]/.test(text)) {
    return '정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  return text;
};

const CollabMatchRegister: React.FC<Props> = ({ variant, applicantUsername, buttonClassName }) => {
  const copy = COPY[variant];
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [infForm, setInfForm] = useState({
    name: '', contact: '',
    instagram_url: '', instagram_followers: '',
    youtube_url: '', youtube_followers: '',
    tiktok_url: '', tiktok_followers: '',
    naver_blog_url: '',
    post_price: '', short_price: '', category: '',
  });
  const [brandForm, setBrandForm] = useState({
    name: '', contact: '', brand_homepage: '', brand_instagram: '', desired_count: '',
    desired_followers: '', budget_text: '', desired_schedule: '', desired_category: '', note: '',
  });

  // 인스타 연동 상태 — 연동 여부와 픽스폴리오가 보관 중인 지표.
  const [channel, setChannel] = useState<InfluencerChannel>(emptyChannel);
  const [channelLoading, setChannelLoading] = useState(false);

  /**
   * 이미 등록서를 낸 계정인지. null = 아직 확인 중.
   *
   * 낸 사람에게는 등록 버튼을 보여 주지 않는다 — 같은 정보를 또 받으면 운영자 목록에
   * 같은 사람이 두 줄로 쌓이고, 본인은 어느 쪽이 반영된 건지 알 수 없다. 확인 중에는
   * 버튼 자리를 비워 둔다: 버튼이 떴다가 사라지면 눌렀다 실패한 것처럼 보인다.
   */
  const [submitted, setSubmitted] = useState<boolean | null>(null);
  const [submittedStatus, setSubmittedStatus] = useState('');
  /** 접수한 등록서 내용. 수정 화면이 값을 되살리는 원본이다. */
  const [application, setApplication] = useState<Record<string, any> | null>(null);
  /** 접수한 등록서를 고치는 중인지. 켜져 있으면 모달이 접수 대신 수정으로 동작한다. */
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /**
   * 연동 직후 지표를 못 받고 돌아온 경우(ig_metrics=0) 한 번 더 받아 오기 위한 표시.
   * 연동은 끝났는데 팔로워·조회수가 비어 있으면 "연동이 안 됐다"로 읽히므로,
   * 사람이 버튼을 찾아 누르기 전에 화면이 먼저 채워 본다.
   */
  const [pendingSync, setPendingSync] = useState(false);
  /** 임시 저장(연동 후 복귀)으로 폼을 되살렸는지. 되살린 값을 접수 내용으로 덮지 않는다. */
  const draftRestored = useRef(false);

  /** 목록에 없는 분야를 직접 적는 칸. 추가하면 infForm.category 로 들어가고 비워진다. */
  const [customCategory, setCustomCategory] = useState('');
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const isInfluencer = variant === 'influencer';

  // 고른 카테고리는 infForm.category 문자열 한 칸이 원본이다. 별도 상태로 두면
  // 임시 저장(연동 후 복귀)과 초기화에서 두 값이 어긋난다.
  const selectedCategories = parseCategoryList(infForm.category);

  const toggleCategory = (name: string) => {
    const next = selectedCategories.includes(name)
      ? selectedCategories.filter(c => c !== name)
      : [...selectedCategories, name];
    setInfForm(f => ({ ...f, category: joinCategoryList(next) }));
  };

  const addCustomCategory = () => {
    // 쉼표는 저장 구분자다. 한 번에 여러 개를 붙여 넣어도 각각으로 갈라 준다.
    const added = parseCategoryList(customCategory);
    if (added.length === 0) return;
    setInfForm(f => ({ ...f, category: joinCategoryList([...parseCategoryList(f.category), ...added]) }));
    setCustomCategory('');
  };

  const loadChannel = useCallback(async () => {
    if (!isInfluencer || !applicantUsername) return;
    setChannelLoading(true);
    const result = await apiService.getCreatorChannel(applicantUsername);
    setChannelLoading(false);
    if (result?.error) return;
    const c = result?.channel || {};
    // metaLinked = 토큰이 살아 있다는 뜻. connected = 지표를 한 번이라도 받아 왔다는 뜻.
    setChannel({
      connected: !!result?.metaLinked || !!c.connected,
      handle: String(result?.igUsername || c.instagramHandle || ''),
      followers: Number(c.followers || 0),
      following: Number(c.following || 0),
      avgViews: Number(c.avgViews || 0),
      avgLikes: Number(c.avgLikes || 0),
      metricsSource: String(c.metricsSource || ''),
      syncedAt: String(c.syncedAt || ''),
      needsReauth: !!result?.needsReauth,
    });
  }, [applicantUsername, isInfluencer]);

  /** 접수한 등록서를 수정 폼으로 되살린다. 0 은 빈칸으로 둔다("0"이 적힌 칸은 오해를 부른다). */
  const prefillFrom = useCallback((app: Record<string, any>) => {
    const num = (v: unknown) => (Number(v || 0) > 0 ? String(Number(v)) : '');
    if (variant === 'influencer') {
      setInfForm({
        name: String(app.name || ''),
        contact: String(app.contact || ''),
        instagram_url: String(app.instagram_url || ''),
        instagram_followers: num(app.instagram_followers),
        youtube_url: String(app.youtube_url || ''),
        youtube_followers: num(app.youtube_followers),
        tiktok_url: String(app.tiktok_url || ''),
        tiktok_followers: num(app.tiktok_followers),
        naver_blog_url: String(app.naver_blog_url || ''),
        post_price: String(app.post_price || ''),
        short_price: String(app.short_price || ''),
        category: String(app.category || ''),
      });
      setCustomCategory('');
    } else {
      setBrandForm({
        name: String(app.name || ''),
        contact: String(app.contact || ''),
        brand_homepage: String(app.brand_homepage || ''),
        brand_instagram: String(app.brand_instagram || ''),
        desired_count: String(app.desired_count || ''),
        desired_followers: String(app.desired_followers || ''),
        budget_text: String(app.budget_text || ''),
        desired_schedule: String(app.desired_schedule || ''),
        desired_category: String(app.desired_category || ''),
        note: String(app.note || ''),
      });
    }
  }, [variant]);

  // 이미 접수한 등록서가 있는지 한 번 확인한다. 로그인 정보가 없으면 확인할 방법이
  // 없으므로 버튼을 그대로 둔다 — 제출 단계에서 걸러진다.
  useEffect(() => {
    let alive = true;
    if (!applicantUsername) {
      setSubmitted(false);
      return;
    }
    (async () => {
      const res = await apiService.getMyCollabDirectory(variant, applicantUsername);
      if (!alive) return;
      // 보관 처리된 등록서는 없는 것으로 본다. 운영자가 접어 둔 사람이 영원히 다시
      // 등록할 수 없게 되면, 문의할 곳이 없는 막힌 화면이 된다.
      setSubmitted(!!res.submitted && res.status !== 'archived');
      setSubmittedStatus(res.status || '');
      setApplication(res.application || null);
    })();
    return () => { alive = false; };
  }, [applicantUsername, variant]);

  // 연동 후 복귀 — 임시 저장한 등록서를 되살리고 모달을 다시 연다.
  useEffect(() => {
    if (!isInfluencer) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get(RETURN_FLAG)) return;

    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        setInfForm(f => ({ ...f, ...JSON.parse(raw) }));
        draftRestored.current = true;
      }
      if (sessionStorage.getItem(DRAFT_MODE_KEY) === 'edit') setEditing(true);
      sessionStorage.removeItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_MODE_KEY);
    } catch {
      // 임시 저장이 없거나 깨졌으면 빈 폼으로 이어간다.
    }

    if (params.get('ig_connected')) {
      const metricsMissing = params.get('ig_metrics') === '0';
      // 지표를 못 받고 돌아왔으면 이 화면이 한 번 더 받아 본다. 사람에게 버튼을
      // 찾아 누르라고 하기 전에 채워 보는 편이 빠르다.
      if (metricsMissing) setPendingSync(true);
      setNotice(
        metricsMissing
          ? { type: 'ok', text: '계정이 연동되었습니다. 팔로워·릴스 조회수를 불러오는 중입니다.' }
          : { type: 'ok', text: '인스타그램 계정이 연동되었습니다! 🎉' },
      );
    } else if (params.get('ig_error')) {
      setNotice({ type: 'err', text: '연동에 실패했어요. 다시 시도해 주세요.' });
    }

    setOpen(true);

    // 결과 파라미터는 한 번 읽고 지운다 — 새로고침 때 같은 안내가 다시 뜨지 않도록.
    params.delete(RETURN_FLAG);
    params.delete('ig_connected');
    params.delete('ig_error');
    params.delete('ig_metrics');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  // 모달을 열 때마다 연동 상태를 다시 확인한다(다른 화면에서 연동했을 수 있다).
  // 접수를 마친 사람에게도 확인한다 — 접수 카드가 팔로워·릴스 평균 조회수를 그대로
  // 보여 주기 때문이다. 브랜드에게 전달되는 숫자를 본인이 볼 수 있어야 한다.
  useEffect(() => {
    if (open || (isInfluencer && submitted === true)) loadChannel();
  }, [open, submitted, isInfluencer, loadChannel]);

  // 이미 접수한 사람이 모달을 열었다면 그것은 수정이다. 접수 화면으로 두면 같은
  // 등록서가 한 장 더 쌓인다(연동 후 복귀처럼 버튼을 거치지 않고 열리는 길이 있다).
  useEffect(() => {
    if (open && submitted === true && !editing) setEditing(true);
  }, [open, submitted, editing]);

  // 수정 화면은 접수한 내용에서 시작한다. 연동하러 나갔다 돌아오며 되살린 값이
  // 있으면 그것이 더 최신이므로 덮지 않는다.
  useEffect(() => {
    if (!editing || !application || draftRestored.current) return;
    prefillFrom(application);
  }, [editing, application, prefillFrom]);

  const reset = () => {
    setInfForm({
      name: '', contact: '', instagram_url: '', instagram_followers: '', youtube_url: '', youtube_followers: '',
      tiktok_url: '', tiktok_followers: '', naver_blog_url: '', post_price: '', short_price: '', category: '',
    });
    setCustomCategory('');
    setBrandForm({
      name: '', contact: '', brand_homepage: '', brand_instagram: '', desired_count: '',
      desired_followers: '', budget_text: '', desired_schedule: '', desired_category: '', note: '',
    });
  };

  /** 메타 authorize 로 이동. 나가기 전에 작성 중인 값을 임시 저장한다. */
  const linkInstagram = async () => {
    if (!applicantUsername) {
      setNotice({ type: 'err', text: '계정 연동은 로그인 후에 할 수 있어요.' });
      return;
    }
    setLinking(true);
    setNotice(null);
    // 접수 카드에서 바로 연동하러 나간 경우에는 작성 중인 폼이 없다. 빈 폼을 임시
    // 저장해 두면 돌아와서 그 빈 값이 접수 내용을 덮어쓸 수 있으므로 지운다.
    const fromSubmittedCard = submitted === true && !editing;
    try {
      if (fromSubmittedCard) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(infForm));
      // 수정 중(또는 이미 접수한 상태)에 연동하러 나갔다면 돌아와서도 수정이어야
      // 한다. 접수 화면으로 돌아오면 같은 등록서가 한 장 더 접수된다.
      sessionStorage.setItem(DRAFT_MODE_KEY, editing || submitted === true ? 'edit' : 'new');
    } catch {
      // 임시 저장이 안 되면 값만 잃을 뿐 연동 자체는 진행할 수 있다.
    }
    const returnTo = `${window.location.pathname}?${RETURN_FLAG}=1`;
    const result = await apiService.instagramConnectUrl(applicantUsername, returnTo);
    if (!result.url) {
      setLinking(false);
      setNotice({ type: 'err', text: result.error || '연동을 시작하지 못했습니다.' });
      return;
    }
    window.location.href = result.url;
  };

  /**
   * 이미 연동된 계정의 지표를 다시 받아온다.
   * silent = 화면이 스스로 시도한 경우. 누르지도 않은 버튼의 결과 문구가 뜨면
   * 사람이 방금 뭘 잘못했나 되짚게 되므로, 성공/실패 안내를 띄우지 않는다.
   */
  const resyncInstagram = useCallback(async (silent = false) => {
    if (!applicantUsername) return;
    setSyncing(true);
    if (!silent) setNotice(null);
    const result = await apiService.syncCreatorChannel(applicantUsername);
    setSyncing(false);
    if (result?.error) {
      // 토큰이 죽은 경우다. 카드를 재연동 상태로 바꿔 주지 않으면 사람은 같은 실패를
      // 부르는 갱신 버튼을 계속 누르게 된다. 이때는 실패가 아니라 다음 할 일을 말한다.
      if (result.code === 'META_TOKEN_INVALID') {
        setChannel(c => ({ ...c, needsReauth: true }));
        if (silent) return;
        setNotice({ type: 'err', text: RECONNECT_TEXT });
        return;
      }
      if (silent) return;
      setNotice({
        type: 'err',
        text: result.code === 'META_NOT_LINKED'
          ? '먼저 인스타그램 계정을 연동해 주세요.'
          // 서버는 사람이 읽을 수 있는 문구만 내려보내지만, 예상 못 한 경로로 영문
          // 원문이 올라오면 화면에서 한 번 더 거른다. 오류 문장은 안내가 아니다.
          : safeNotice(result.error),
      });
      return;
    }
    await loadChannel();
    if (silent) return;
    setNotice({
      type: 'ok',
      // 조회수 권한(인사이트)은 연동할 때 함께 받는다. 권한이 추가되기 전에 연동해 둔
      // 계정은 토큰에 그 권한이 없으므로, 다시 연동하라고 말해 주어야 값이 채워진다.
      text: result?.viewsAvailable === false
        ? '최신 정보를 불러왔어요. 릴스 조회수가 비어 있으면 계정을 다시 연동해 조회수 권한을 허용해 주세요.'
        : '최신 팔로워·릴스 정보를 불러왔어요.',
    });
  }, [applicantUsername, loadChannel]);

  // 연동은 됐는데 지표를 못 받고 돌아온 경우 화면이 한 번 더 받아 본다.
  // 메타 쪽 계정 정보가 연동 직후 잠깐 준비되지 않는 경우가 있어, 두 번째 호출에서
  // 채워지는 일이 흔하다.
  useEffect(() => {
    if (!pendingSync) return;
    setPendingSync(false);
    (async () => {
      await resyncInstagram(true);
    })();
  }, [pendingSync, resyncInstagram]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      const payload = variant === 'influencer'
        ? { role: 'influencer', applicant_username: applicantUsername, ...infForm }
        : { role: 'brand', applicant_username: applicantUsername, ...brandForm, budget: brandForm.budget_text };
      if (!payload.name?.trim()) {
        setNotice({ type: 'err', text: variant === 'influencer' ? '이름을 입력해 주세요.' : '담당자/브랜드명을 입력해 주세요.' });
        setSubmitting(false);
        return;
      }
      // 연락처가 없으면 매칭 결과를 안내할 방법이 없다.
      if (!payload.contact?.trim()) {
        setNotice({ type: 'err', text: '연락처를 입력해 주세요.' });
        setSubmitting(false);
        return;
      }
      // 분야가 비어 있으면 캠페인 후보로 추려지지 않는다. 등록만 되고 아무 연락도
      // 오지 않는 상태를 만들지 않으려면 여기서 막는 편이 낫다.
      if (variant === 'influencer' && selectedCategories.length === 0) {
        setNotice({ type: 'err', text: '카테고리를 최소 1개 골라 주세요. 캠페인은 분야로 인플루언서를 찾습니다.' });
        setSubmitting(false);
        return;
      }
      const result = editing
        ? await apiService.updateMyCollabDirectory(variant, applicantUsername, payload)
        : await apiService.submitCollabDirectory(payload);
      if (!result?.error) {
        setOpen(false);
        setNotice(null);
        draftRestored.current = false;
        // 서버에 다시 물어보지 않고 바로 감춘다. 접수는 방금 성공했고, 이 화면에
        // 버튼이 한 번 더 남아 있으면 같은 등록서를 두 번 내게 된다.
        setSubmitted(true);
        if (editing) {
          // 수정은 접수 상태를 건드리지 않는다. 검토 중이던 등록서가 수정했다고
          // 다시 대기로 돌아가면, 본인은 순서를 잃은 것처럼 보인다.
          setApplication((result as { application?: Record<string, any> | null }).application || null);
          setEditing(false);
          alert('수정되었습니다.');
        } else {
          reset();
          setSubmittedStatus('pending');
          // 접수 카드가 방금 낸 단가를 그대로 보여 줄 수 있게 내용을 한 번 받아 온다.
          const fresh = await apiService.getMyCollabDirectory(variant, applicantUsername);
          setApplication(fresh.application || null);
          alert('접수되었습니다.');
        }
      } else {
        setNotice({ type: 'err', text: result.error });
      }
    } catch {
      setNotice({ type: 'err', text: '서버 오류가 발생했습니다.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSubmission = async () => {
    if (!confirm(`${copy.title} 접수를 취소하시겠습니까?`)) return;
    setCancelling(true);
    const res = await apiService.cancelMyCollabDirectory(variant, applicantUsername);
    setCancelling(false);
    if (res.success) {
      setSubmitted(false);
      setSubmittedStatus('');
      setApplication(null);
      setEditing(false);
      setNotice({ type: 'ok', text: `${copy.title} 접수가 취소되었습니다.` });
      alert(`${copy.title} 접수가 취소되었습니다.`);
    } else {
      alert(res.error || '취소하지 못했습니다.');
    }
  };

  /** 모달 닫기 — 수정 화면이었다면 접수 카드로 돌아간다. */
  const closeModal = () => {
    if (submitting) return;
    setOpen(false);
    setEditing(false);
    setNotice(null);
    draftRestored.current = false;
    // 수정을 도중에 접었으면 고치던 값은 버린다. 다음에 열 때 접수된 내용에서
    // 다시 시작해야 화면이 실제 접수 상태와 같아진다.
    if (submitted === true) reset();
  };

  return (
    <>
      {submitted === false && (
        <button
          onClick={() => setOpen(true)}
          className={buttonClassName ?? 'w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-sm py-3 shadow-[0_12px_26px_-8px_rgba(37,99,235,0.65)] hover:shadow-[0_16px_32px_-8px_rgba(37,99,235,0.75)] hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.99] active:translate-y-0 transition-all'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
          {copy.title}
        </button>
      )}

      {/* 접수한 뒤에도 이 자리에서 계속 확인하고 고칠 수 있어야 한다.
          - 인플루언서: 연동 계정의 팔로워·릴스 평균 조회수(브랜드가 보는 숫자)
          - 공통: 단가·조건 수정. 단가는 접수 뒤에도 바뀐다. */}
      {submitted === true && !open && (
        <div className="w-full rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black text-blue-700">{copy.title} 접수 완료</p>
              <p className="mt-0.5 text-[11px] font-bold text-blue-500">{SUBMITTED_NOTE[submittedStatus] || SUBMITTED_NOTE.pending}</p>
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setNotice(null); setEditing(true); setOpen(true); }}
                className="text-xs font-bold text-blue-700 hover:text-blue-800 bg-white hover:bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 transition-colors"
              >
                수정하기
              </button>
              <button
                type="button"
                onClick={handleCancelSubmission}
                disabled={cancelling}
                className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {cancelling ? '취소 중...' : '취소하기'}
              </button>
            </div>
          </div>

          {/* 연동한 계정에서 확인된 숫자. 접수하고 나면 볼 곳이 없어서 "연동이 된 건가"
              하고 다시 연동하러 가는 일이 생긴다. 여기서 바로 보여 준다. */}
          {isInfluencer && (
            <div className="mt-3">
              <InstagramLinkCard
                channel={channel}
                loading={channelLoading}
                linking={linking}
                syncing={syncing}
                canLink={!!applicantUsername}
                onLink={linkInstagram}
                onResync={() => resyncInstagram()}
              />
            </div>
          )}

          {/* 접수된 단가를 그대로 보여 준다 — 브랜드에게 전달되는 값이 무엇인지 알아야
              고칠지 말지 판단할 수 있다. */}
          {isInfluencer && application && (application.post_price || application.short_price || application.ad_price) && (
            <div className="mt-2.5 rounded-xl border border-blue-100 bg-white px-3.5 py-2.5">
              <p className="text-[10px] font-black text-slate-400">접수된 광고 단가</p>
              <div className="mt-1 space-y-0.5">
                {application.post_price ? (
                  <p className="text-xs font-bold text-slate-700 break-words">게시물 <span className="text-slate-900 font-black">{application.post_price}</span></p>
                ) : null}
                {application.short_price ? (
                  <p className="text-xs font-bold text-slate-700 break-words">숏폼 <span className="text-slate-900 font-black">{application.short_price}</span></p>
                ) : null}
                {!application.post_price && !application.short_price && application.ad_price ? (
                  <p className="text-xs font-black text-slate-900 break-words">{application.ad_price}</p>
                ) : null}
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-1.5">단가가 바뀌었다면 "수정하기"로 고쳐 주세요.</p>
            </div>
          )}

          {notice && (
            <div
              className={`mt-2.5 rounded-xl px-3.5 py-2.5 text-xs font-bold ${
                notice.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-rose-50 text-rose-700 border border-rose-100'
              }`}
            >
              {notice.text}
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4" onClick={closeModal}>
          <div
            className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom md:fade-in duration-300 shadow-[0_-16px_40px_-16px_rgba(15,23,42,0.5)] md:shadow-[0_28px_60px_-20px_rgba(15,23,42,0.6)]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h3 className="text-base font-black text-slate-900">{editing ? '등록 정보 수정' : copy.title}</h3>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                  {editing ? '광고 단가 등 바뀐 내용을 고치고 저장하면 접수 순서는 그대로 유지됩니다.' : copy.subtitle}
                </p>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5">
              {notice && (
                <div
                  className={`mb-4 rounded-xl px-3.5 py-2.5 text-xs font-bold ${
                    notice.type === 'ok'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      : 'bg-rose-50 text-rose-700 border border-rose-100'
                  }`}
                >
                  {notice.text}
                </div>
              )}
              {variant === 'influencer' ? (
                <div className="space-y-3">
                  <Field label="이름" required value={infForm.name} onChange={v => setInfForm(f => ({ ...f, name: v }))} placeholder="홍길동" />
                  <Field label="연락처" required value={infForm.contact} onChange={v => setInfForm(f => ({ ...f, contact: v }))} placeholder="010-0000-0000 / 이메일" />

                  {/* 인스타 계정 연동 — 브랜드가 보는 숫자의 출처가 여기서 정해진다. */}
                  <div className="pt-1">
                    <p className="text-xs font-black text-slate-500 mb-2">인스타그램 계정 연동</p>
                    <InstagramLinkCard
                      channel={channel}
                      loading={channelLoading}
                      linking={linking}
                      syncing={syncing}
                      canLink={!!applicantUsername}
                      onLink={linkInstagram}
                      onResync={() => resyncInstagram()}
                    />
                  </div>

                  <div className="pt-1">
                    <p className="text-xs font-black text-slate-500 mb-2">유튜브 · 틱톡 추가 가능 (선택사항)</p>
                    <div className="space-y-2.5">
                      {channel.connected ? (
                        // 연동을 마쳤으면 인스타 항목은 손으로 적게 하지 않는다.
                        // 확인된 숫자 옆에 입력칸을 같이 두면 어느 쪽이 맞는지 알 수 없다.
                        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-500">인스타그램</span>
                            <span className="text-[11px] font-bold text-emerald-600">연동 계정에서 자동 확인</span>
                          </div>
                          <p className="text-sm font-black text-slate-900 mt-1">
                            {channel.handle ? `@${channel.handle}` : '연동된 계정'}
                          </p>
                        </div>
                      ) : (
                        <ChannelRow
                          label="인스타그램 프로필 (선택)" urlPlaceholder="https://instagram.com/..."
                          url={infForm.instagram_url} onUrl={v => setInfForm(f => ({ ...f, instagram_url: v }))}
                          followers={infForm.instagram_followers} onFollowers={v => setInfForm(f => ({ ...f, instagram_followers: v }))}
                        />
                      )}
                      <ChannelRow
                        label="유튜브 (선택사항)" urlPlaceholder="https://youtube.com/@..." followerPlaceholder="구독자"
                        url={infForm.youtube_url} onUrl={v => setInfForm(f => ({ ...f, youtube_url: v }))}
                        followers={infForm.youtube_followers} onFollowers={v => setInfForm(f => ({ ...f, youtube_followers: v }))}
                      />
                      <ChannelRow
                        label="틱톡 (선택사항)" urlPlaceholder="https://tiktok.com/@..."
                        url={infForm.tiktok_url} onUrl={v => setInfForm(f => ({ ...f, tiktok_url: v }))}
                        followers={infForm.tiktok_followers} onFollowers={v => setInfForm(f => ({ ...f, tiktok_followers: v }))}
                      />
                      <Field label="네이버 블로그 (선택사항)" value={infForm.naver_blog_url} onChange={v => setInfForm(f => ({ ...f, naver_blog_url: v }))} placeholder="https://blog.naver.com/..." />
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium leading-relaxed mt-2">
                      {channel.connected
                        ? '인스타그램은 연동된 계정에서 정보를 확인합니다. 유튜브나 틱톡 등 추가 채널이 있다면 선택사항으로 입력하세요.'
                        : '인스타그램 연동으로 채널 정보가 연동됩니다. 유튜브나 틱톡은 필요 시 선택사항으로 추가 입력해 주세요.'}
                    </p>
                  </div>

                  <div className="pt-1">
                    <p className="text-xs font-black text-slate-500 mb-2">광고 단가</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="게시물 단가" value={infForm.post_price} onChange={v => setInfForm(f => ({ ...f, post_price: v }))} placeholder="예: 30만원" />
                      <Field label="숏폼 단가" value={infForm.short_price} onChange={v => setInfForm(f => ({ ...f, short_price: v }))} placeholder="예: 50만원" />
                    </div>
                  </div>

                  {/* 카테고리 — 눌러서 고르고, 없는 분야는 직접 추가한다.
                      담당자가 캠페인에 맞는 사람을 추릴 때 쓰는 값이라 여러 개를
                      고를 수 있어야 한다(한 분야만 하는 인플루언서는 드물다).

                      최소 1개는 반드시 받는다. 캠페인은 "뷰티 인플루언서 5명" 같은
                      형태로 들어오므로, 분야가 비어 있으면 그 사람은 어느 캠페인
                      후보에도 걸리지 않는다 — 등록은 했는데 아무 연락도 오지 않는
                      상태가 된다. 운영자가 나중에 한 명씩 물어보게 만들지 않으려면
                      접수 시점에 받아 두는 편이 낫다. */}
                  <div className="pt-1">
                    <p className="text-xs font-black text-slate-500 mb-1">
                      내 카테고리<span className="text-rose-500 ml-0.5">*</span>
                    </p>
                    <p className="text-[11px] text-slate-400 font-medium mb-2">
                      최소 1개는 골라 주세요. 여러 개 고를 수 있고, 목록에 없는 분야는 아래에서 직접 추가하세요.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {categoryOptions(selectedCategories).map(name => {
                        const on = selectedCategories.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleCategory(name)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                              on
                                ? 'bg-blue-600 border-blue-600 text-white shadow-[0_6px_14px_-6px_rgba(37,99,235,0.7)]'
                                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      <input
                        type="text"
                        value={customCategory}
                        onChange={e => setCustomCategory(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            // 이 입력칸은 모달 안에 있다. 기본 동작을 막지 않으면
                            // 엔터가 접수 버튼까지 눌러 등록서가 바로 넘어간다.
                            e.preventDefault();
                            addCustomCategory();
                          }
                        }}
                        placeholder="직접 추가 (예: 홈카페)"
                        className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                      />
                      <button
                        type="button"
                        onClick={addCustomCategory}
                        disabled={!customCategory.trim()}
                        className="shrink-0 px-4 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 disabled:opacity-40"
                      >
                        추가
                      </button>
                    </div>
                    {/* 접수 버튼을 눌러 봐야 알게 되면 이미 한 번 막힌 것이다.
                        비어 있는 동안 미리 말해 둔다. */}
                    {selectedCategories.length === 0 && (
                      <p className="text-[11px] text-rose-500 font-bold mt-2">
                        카테고리를 최소 1개 골라 주세요.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="담당자 이름 / 브랜드명" required value={brandForm.name} onChange={v => setBrandForm(f => ({ ...f, name: v }))} placeholder="브랜드명 또는 담당자" />
                  <Field label="연락처" required value={brandForm.contact} onChange={v => setBrandForm(f => ({ ...f, contact: v }))} placeholder="010-0000-0000 / 이메일" />
                  <Field label="브랜드 홈페이지" value={brandForm.brand_homepage} onChange={v => setBrandForm(f => ({ ...f, brand_homepage: v }))} placeholder="https://..." />
                  <Field label="브랜드 인스타 링크" value={brandForm.brand_instagram} onChange={v => setBrandForm(f => ({ ...f, brand_instagram: v }))} placeholder="https://instagram.com/..." />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="희망 인원" value={brandForm.desired_count} onChange={v => setBrandForm(f => ({ ...f, desired_count: v }))} placeholder="예: 5명" />
                    <Field label="원하는 팔로워" value={brandForm.desired_followers} onChange={v => setBrandForm(f => ({ ...f, desired_followers: v }))} placeholder="예: 1만~5만" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="예산" value={brandForm.budget_text} onChange={v => setBrandForm(f => ({ ...f, budget_text: v }))} placeholder="예: 500만원" />
                    <Field label="원하는 일정" type="date" value={brandForm.desired_schedule} onChange={v => setBrandForm(f => ({ ...f, desired_schedule: v }))} />
                  </div>
                  <Field label="원하는 인플루언서 카테고리" value={brandForm.desired_category} onChange={v => setBrandForm(f => ({ ...f, desired_category: v }))} placeholder="뷰티, 패션, 푸드 등" />
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">추가 메모</label>
                    <textarea
                      value={brandForm.note}
                      onChange={e => setBrandForm(f => ({ ...f, note: e.target.value }))}
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
                      placeholder="캠페인 상세, 요청 사항 등"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full mt-5 rounded-xl bg-blue-600 text-white font-black text-sm py-3.5 shadow-[0_12px_26px_-10px_rgba(37,99,235,0.7)] hover:bg-blue-700 hover:shadow-[0_16px_32px_-10px_rgba(37,99,235,0.8)] active:scale-[0.99] transition-all disabled:opacity-60 disabled:shadow-none"
              >
                {submitting ? (editing ? '저장 중...' : '접수 중...') : (editing ? '수정 저장하기' : '지원하기')}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="w-full mt-2 rounded-xl border border-slate-200 bg-white text-slate-500 font-bold text-sm py-3 hover:bg-slate-50 transition-colors disabled:opacity-60"
                >
                  수정 취소
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * 인스타그램 연동 카드.
 *
 * 연동 전에는 "왜 연동하는지"를 먼저 말한다. 계정 로그인을 요구하는 화면에서 이유가
 * 없으면 사람들은 그냥 닫는다. 연동 후에는 픽스폴리오가 실제로 보관 중인 숫자를
 * 그대로 보여 준다 — 브랜드에게 전달되는 값이 무엇인지 본인이 확인할 수 있어야 한다.
 */
const InstagramLinkCard: React.FC<{
  channel: InfluencerChannel;
  loading: boolean;
  linking: boolean;
  syncing: boolean;
  canLink: boolean;
  onLink: () => void;
  onResync: () => void;
}> = ({ channel, loading, linking, syncing, canLink, onLink, onResync }) => {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 flex items-center gap-2.5">
        <div className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
        <span className="text-xs font-bold text-slate-400">연동 상태 확인 중...</span>
      </div>
    );
  }

  if (!channel.connected) {
    return (
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-fuchsia-50/60 to-indigo-50/60 px-4 py-4">
        <p className="text-sm font-black text-slate-900">본인 인스타그램으로 로그인해 연동</p>
        <p className="text-[11px] text-slate-500 font-medium leading-relaxed mt-1.5">
          연동하면 팔로워·팔로잉 수와 최근 릴스 평균 조회수를 픽스폴리오가 직접 확인해
          보관합니다. 브랜드는 직접 적은 숫자보다 확인된 숫자를 신뢰하기 때문에 매칭
          확률이 올라갑니다. 게시물 작성이나 DM 발송 권한은 사용하지 않습니다.
        </p>
        <button
          type="button"
          onClick={onLink}
          disabled={linking || !canLink}
          className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 via-rose-500 to-amber-500 text-white font-black text-sm py-3 shadow-[0_12px_26px_-10px_rgba(219,39,119,0.6)] hover:-translate-y-0.5 active:scale-[0.99] active:translate-y-0 transition-all disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.96.24 2.4.41.6.24 1.04.52 1.5.98.46.46.74.9.98 1.5.17.44.36 1.23.41 2.4.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.96-.41 2.4-.24.6-.52 1.04-.98 1.5-.46.46-.9.74-1.5.98-.44.17-1.23.36-2.4.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.96-.24-2.4-.41a4.04 4.04 0 01-1.5-.98 4.04 4.04 0 01-.98-1.5c-.17-.44-.36-1.23-.41-2.4C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.24-1.96.41-2.4.24-.6.52-1.04.98-1.5.46-.46.9-.74 1.5-.98.44-.17 1.23-.36 2.4-.41C8.42 2.17 8.8 2.16 12 2.16zm0 3.68a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zm0 10.16a4 4 0 110-8 4 4 0 010 8zm7.84-10.4a1.44 1.44 0 11-2.88 0 1.44 1.44 0 012.88 0z" />
          </svg>
          {linking ? '연동 창으로 이동 중...' : '인스타그램 계정 연동하기'}
        </button>
        {!canLink && (
          <p className="text-[11px] text-rose-500 font-bold mt-2">
            계정 연동은 로그인 후에 할 수 있어요.
          </p>
        )}
      </div>
    );
  }

  const verified = channel.metricsSource === 'meta_api';

  /**
   * 연동은 돼 있지만 토큰이 죽은 상태.
   *
   * 붉은 오류 상자로 보여 주지 않는다. 사람이 뭘 잘못한 것이 아니라 인스타그램
   * 권한이 만료된 것이고, 할 일은 버튼 하나를 다시 누르는 것뿐이다. 그리고 이미
   * 확인해 둔 숫자는 그대로 보여 준다 — 브랜드에게 전달되는 값은 여전히 그것이고,
   * 화면에서 지우면 연동이 통째로 사라진 것처럼 읽힌다.
   */
  if (channel.needsReauth) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v3.5m0 3.5h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-900">
              {channel.handle ? `@${channel.handle} 다시 연동이 필요해요` : '다시 연동이 필요해요'}
            </p>
            <p className="text-[11px] text-amber-800 font-medium leading-relaxed mt-1">
              인스타그램 연동 권한이 만료되었습니다. 비밀번호를 바꿨거나 인스타그램
              설정에서 픽스폴리오 연결을 해제하면 이렇게 됩니다. 아래 버튼으로 다시
              연동하면 팔로워·릴스 조회수를 이어서 불러옵니다.
            </p>
          </div>
        </div>

        {/* 마지막으로 확인된 숫자. 새로 못 받았을 뿐 브랜드가 보는 값은 아직 이것이다. */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Metric label="팔로워" value={compact(channel.followers)} />
          <Metric label="팔로잉" value={compact(channel.following)} />
          <Metric label="릴스 평균 조회" value={channel.avgViews ? compact(channel.avgViews) : '집계 전'} />
        </div>
        <p className="text-[10px] text-slate-400 font-bold mt-1.5">마지막으로 확인된 숫자입니다.</p>

        <button
          type="button"
          onClick={onLink}
          disabled={linking || !canLink}
          className="mt-3 w-full rounded-xl bg-gradient-to-r from-fuchsia-600 via-rose-500 to-amber-500 text-white font-black text-sm py-3 shadow-[0_12px_26px_-10px_rgba(219,39,119,0.6)] hover:-translate-y-0.5 active:scale-[0.99] active:translate-y-0 transition-all disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0"
        >
          {linking ? '연동 창으로 이동 중...' : '인스타그램 다시 연동하기'}
        </button>
        {!canLink && (
          <p className="text-[11px] text-rose-500 font-bold mt-2">
            계정 연동은 로그인 후에 할 수 있어요.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm font-black text-slate-900 truncate">
              {channel.handle ? `@${channel.handle}` : '인스타그램 연동 완료'}
            </p>
          </div>
          <p className="text-[11px] text-emerald-700 font-bold mt-0.5">
            {verified ? '메타에서 확인된 지표를 보관 중입니다.' : '연동됨 · 지표를 아직 받지 못했습니다.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onResync}
          disabled={syncing}
          className="shrink-0 rounded-lg border border-emerald-300 bg-white text-emerald-700 font-black text-[11px] px-2.5 py-1.5 hover:bg-emerald-50 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {syncing ? '불러오는 중' : '새로 불러오기'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Metric label="팔로워" value={compact(channel.followers)} />
        <Metric label="팔로잉" value={compact(channel.following)} />
        {/* 아직 못 받은 조회수를 "0" 으로 적으면 아무도 안 본 계정으로 읽힌다. */}
        <Metric label="릴스 평균 조회" value={channel.avgViews ? compact(channel.avgViews) : '집계 전'} />
      </div>
      {verified && channel.avgViews === 0 && (
        <p className="text-[11px] text-slate-500 font-medium mt-2 leading-relaxed">
          릴스 조회수를 아직 받지 못했습니다. "새로 불러오기"를 눌러도 비어 있으면 계정을
          다시 연동해 조회수(인사이트) 권한을 허용해 주세요. 팔로워 수는 정상적으로
          확인되었습니다.
        </p>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg bg-white border border-emerald-100 px-2 py-2 text-center">
    <p className="text-[10px] font-bold text-slate-400 whitespace-nowrap">{label}</p>
    <p className="text-sm font-black text-slate-900 mt-0.5">{value}</p>
  </div>
);

// 채널 링크(넓게) + 팔로워 수(좁게)를 한 줄에 배치하는 입력 행
const ChannelRow: React.FC<{
  label: string; url: string; onUrl: (v: string) => void;
  followers: string; onFollowers: (v: string) => void;
  urlPlaceholder?: string; followerPlaceholder?: string;
}> = ({ label, url, onUrl, followers, onFollowers, urlPlaceholder, followerPlaceholder = '팔로워' }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 mb-1.5">{label}</label>
    <div className="flex gap-2">
      <input
        value={url}
        onChange={e => onUrl(e.target.value)}
        placeholder={urlPlaceholder}
        className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
      />
      <input
        value={followers}
        onChange={e => onFollowers(e.target.value.replace(/[^\d]/g, ''))}
        inputMode="numeric"
        placeholder={followerPlaceholder}
        className="w-24 shrink-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
      />
    </div>
  </div>
);

const Field: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}> = ({ label, value, onChange, placeholder, type = 'text', required }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 mb-1.5">
      {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
    />
  </div>
);

export default CollabMatchRegister;

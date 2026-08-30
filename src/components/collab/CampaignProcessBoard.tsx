import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { openPostcodeSearch } from '../../utils/daumPostcode';
import { formatPhone, formatPhoneInput } from '../../utils/formatters';
import {
  StoryboardScene,
  emptyScene,
  normalizeScenes,
  parseAnchor,
  sceneAnchor,
  sceneIsEmpty,
} from '../../utils/collabScenes';
import {
  CollabStepTurn,
  collabStepTurns,
  nextCollabAction,
  waitingCollabStep,
} from '../../utils/collabNextAction';

/**
 * 캠페인 진행 프로세스 — 다섯 단계 하나의 화면.
 *
 *   1. 콘텐츠 가이드   브랜드가 가이드 파일을 올리고, 인플루언서가 확인한다
 *   2. 제품 배송       인플루언서가 주소를 적고, 브랜드가 보낸다
 *   3. 기획안 피드백   인플루언서 기획안 입력칸 "바로 밑"에 브랜드 피드백칸
 *   4. 영상 피드백     초안 영상 "바로 밑"에 브랜드 피드백칸
 *   5. 업로드          게시물 링크 · 업로드 확인 · 광고 파트너십 코드
 *
 * 브랜드와 인플루언서가 같은 컴포넌트를 쓴다. 예전에는 양쪽 화면이 따로 있어서 같은
 * 단계를 서로 다른 이름과 다른 순서로 보고 있었다 — 브랜드는 "대본 피드백", 인플루언서는
 * "구성안 제출"이 같은 칸이라는 걸 알 방법이 없었다. 한 파일에서 그리면 그 어긋남이
 * 생길 자리가 없다.
 *
 * 펼침은 한 번에 하나. 다섯 단계를 전부 펼쳐 두면 지금 할 일이 어느 것인지가 다시
 * 사라진다. 기본값은 "지금 단계"다.
 */

type BoardRole = 'influencer' | 'brand' | 'manager';

type Props = {
  collabId: string;
  role: BoardRole;
  detail: any;
  onRefresh: () => Promise<any> | void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** 이 단계를 펼친 채로 연다. 브랜드가 "제품 배송" 줄에서 들어왔는데 가이드가
   *  펼쳐져 있으면, 보러 온 것을 다시 찾아 눌러야 한다. */
  focusStep?: StepKey | '';
  /**
   * 이 단계 하나만 그린다.
   *
   * 보드의 "기획안" 칸에서 들어왔으면 그 화면에서 할 일은 기획안을 읽고 피드백을 쓰는
   * 것 하나다. 그런데 다섯 줄이 전부 남아 있으면, 펼쳐 둔 한 줄이 나머지 네 줄 사이에
   * 끼어 있어서 "내가 무엇을 보러 들어왔는지"를 화면이 다시 말해 주지 않는다. 보러 온
   * 단계만 남기면 그 줄이 곧 화면의 제목이 된다. 나머지 단계는 아래 "전체 단계 보기"
   * 한 번으로 되돌아온다 — 지난 단계를 되짚을 길까지 막지는 않는다.
   */
  onlyStep?: StepKey | '';
};

type StepKey = 'guide' | 'shipping' | 'plan' | 'video' | 'upload';

const STEPS: { key: StepKey; title: string; lead: string }[] = [
  { key: 'guide', title: '콘텐츠 가이드', lead: '브랜드가 올린 가이드를 확인합니다.' },
  { key: 'shipping', title: '제품 배송', lead: '받을 주소를 남기면 브랜드가 발송합니다.' },
  { key: 'plan', title: '기획안 피드백', lead: '기획안을 쓰면 바로 아래에 피드백이 붙습니다.' },
  { key: 'video', title: '영상 피드백', lead: '초안 영상에 브랜드가 피드백을 남깁니다.' },
  { key: 'upload', title: '업로드', lead: '게시물 링크와 광고 파트너십 코드를 남깁니다.' },
];

/** 예전 아홉 단계 협업의 단계 이름까지 같은 칸으로 끌어온다(서버와 같은 표). */
const STAGE_KEYS: Record<StepKey, string[]> = {
  guide: ['guide'],
  shipping: ['shipping'],
  plan: ['plan', 'script', 'script_review'],
  video: ['video', 'content', 'content_review'],
  upload: ['upload', 'confirm', 'settlement'],
};

const inputCls =
  'w-full text-xs font-medium border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-slate-400 transition-colors';

/**
 * 값이 들어간 칸은 눈에 다르게 보여야 한다.
 *
 * 배송 정보를 다 적고 저장한 뒤에도 칸이 전부 흰색이면 "저장이 된 건가, 비어 있는
 * 건가"를 알 수 없다 — 실제로 값이 들어 있는데도 빈칸처럼 읽혔다. 채워진 칸은
 * 옅은 초록 배경과 진한 글씨로 바꾼다.
 */
const fieldCls = (value: string) =>
  String(value || '').trim()
    ? 'w-full text-xs font-bold text-slate-900 border border-emerald-200 bg-emerald-50/60 rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-400 transition-colors'
    : inputCls;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] font-black text-slate-400 mb-1">{label}</span>
    {children}
  </label>
);

const fmtDate = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

const CampaignProcessBoard: React.FC<Props> = ({ collabId, role, detail, onRefresh, onNotify, focusStep, onlyStep }) => {
  const stages = useMemo(() => (Array.isArray(detail?.stages) ? detail.stages : []), [detail]);
  const deliverables = useMemo(() => (Array.isArray(detail?.deliverables) ? detail.deliverables : []), [detail]);
  const feedbacks = useMemo(() => (Array.isArray(detail?.feedbacks) ? detail.feedbacks : []), [detail]);
  const guideline = detail?.guideline || {};
  const guideFiles: any[] = Array.isArray(guideline.files) ? guideline.files : [];
  const shipping = detail?.shipping || {};
  const collab = detail?.collab || {};
  const isInfluencer = role === 'influencer';
  const isBrandSide = role === 'brand' || role === 'manager';
  /**
   * 인플루언서가 열어 볼 가이드가 실제로 있는가.
   *
   * 파일만 세면 안 된다. 가이드는 파일 · 메모 · 링크 세 가지로 오고, 메모만 적어 둔
   * 캠페인에서는 파일이 0개다 — 그러면 인플루언서 쪽에 확인 버튼이 서지 않아 이 단계가
   * 닫히지 않고, 브랜드는 영원히 "가이드를 올려 주세요"를 본다.
   */
  const guideReady =
    guideFiles.length > 0 ||
    Boolean(String(guideline.note || '').trim()) ||
    Boolean(String(guideline.url || '').trim());

  const stageOf = (step: StepKey) =>
    stages.find((s: any) => STAGE_KEYS[step].includes(String(s.stageKey))) || null;

  /** 그 단계의 마지막 제출물. 버전을 쌓으므로 항상 최신 하나만 본다. */
  const workOf = (step: StepKey) => {
    const rows = deliverables.filter(
      (d: any) => STAGE_KEYS[step].includes(String(d.stageKey)) || String(d.kind) === step,
    );
    return rows.length ? rows[rows.length - 1] : null;
  };

  const feedbacksOf = (step: StepKey) =>
    feedbacks.filter(
      (f: any) => String(f.anchor) === step || STAGE_KEYS[step].includes(String(f.stageKey)),
    );

  const doneOf = (step: StepKey): boolean => {
    const stage = stageOf(step);
    const stageDone = stage ? ['done', 'skipped'].includes(String(stage.status)) : false;
    if (step === 'guide') return stageDone;
    if (step === 'shipping') return stageDone || String(shipping.status) === 'shipped';
    if (step === 'upload') return stageDone || Boolean(collab.uploadConfirmedAt);
    return stageDone;
  };

  /** 브랜드가 이 단계에 피드백을 남겨 다시 인플루언서 차례가 된 상태. */
  const revisionOf = (step: StepKey): boolean => String(stageOf(step)?.status || '') === 'revision';

  /**
   * 입력을 마쳤고 상대의 차례가 된 단계인가.
   *
   * 완료(done)와는 다르다 — 기획안을 올려도 브랜드가 확인하기 전까지 단계는 닫히지
   * 않는다. 그런데 그 사이를 "진행 전"과 같은 회색으로 두면, 다 적어 놓고도 화면상
   * 아무 일도 일어나지 않은 것처럼 보인다. 채워 넣은 것이 있으면 색이 들어와야 한다.
   */
  const submittedOf = (step: StepKey): boolean => {
    if (doneOf(step) || revisionOf(step)) return false;
    const stageSubmitted = String(stageOf(step)?.status || '') === 'submitted';
    if (step === 'shipping') return Boolean(shipping.filled);
    if (step === 'plan') return Boolean(workOf('plan')) || stageSubmitted;
    if (step === 'video') return Boolean(workOf('video')) || stageSubmitted;
    if (step === 'upload') return Boolean(collab.uploadUrl) || stageSubmitted;
    return stageSubmitted;
  };

  /**
   * 지금 누가 무엇을 해야 하는가.
   *
   * 단계의 완료 여부와는 다른 값이다. 배송 단계는 "아직 안 끝났다"는 것만으로는 아무
   * 말도 하지 않는다 — 주소를 기다리는 중인지(인플루언서 차례) 발송을 기다리는
   * 중인지(브랜드 차례)에 따라 화면에 떠야 하는 문장이 정반대다. 판정은 목록 카드와
   * 같은 함수(collabNextAction)에서 가져온다. 카드에 "배송 정보 입력 필요"가 떠서
   * 들어왔는데 이 화면이 다른 단계를 펼쳐 두면 다시 찾아 눌러야 한다.
   */
  const actionInput = useMemo(
    () => ({
      steps: {
        guide: { status: String(stageOf('guide')?.status || ''), submitted: Boolean(workOf('guide')) },
        shipping: { status: String(stageOf('shipping')?.status || ''), submitted: Boolean(shipping.filled) },
        plan: { status: String(stageOf('plan')?.status || ''), submitted: Boolean(workOf('plan')) },
        video: { status: String(stageOf('video')?.status || ''), submitted: Boolean(workOf('video')) },
        upload: { status: String(stageOf('upload')?.status || ''), submitted: Boolean(collab.uploadUrl) },
      },
      shipping: { filled: Boolean(shipping.filled), status: String(shipping.status || '') },
      uploadUrl: String(collab.uploadUrl || ''),
      uploadConfirmedAt: collab.uploadConfirmedAt || null,
      guideReady,
      collabStatus: String(collab.status || ''),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail],
  );

  const turns = useMemo(() => collabStepTurns(actionInput, role), [actionInput, role]);
  const myAction = useMemo(() => nextCollabAction(actionInput, role), [actionInput, role]);
  const waitingStep = useMemo(() => waitingCollabStep(actionInput, role), [actionInput, role]);
  const turnOf = (step: StepKey): CollabStepTurn | null => turns[step] || null;

  const states = useMemo(() => {
    const done = STEPS.map(s => doneOf(s.key));
    const currentIndex = done.findIndex(d => !d);
    return STEPS.map((s, i) => ({
      ...s,
      done: done[i],
      submitted: submittedOf(s.key),
      revision: revisionOf(s.key),
      current: i === currentIndex,
      /** 내가 손대야 하는 단계 하나. 색과 배지가 여기에 붙는다. */
      action: myAction?.key === s.key,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, myAction?.key]);

  /**
   * 처음 펼쳐 둘 단계.
   *
   * 예전에는 "완료되지 않은 첫 단계"를 펼쳤다. 그러면 브랜드가 가이드를 올리지 않은
   * 협업에서는 인플루언서가 열 것이 없는 가이드 칸을 보게 되고, 정작 지금 적어야 하는
   * 배송지 칸은 접힌 채 회색으로 남았다. 내 차례인 단계를 펼친다.
   */
  const currentKey = myAction?.key || states.find(s => s.current)?.key || 'upload';
  const [open, setOpen] = useState<StepKey | ''>(focusStep || currentKey);
  useEffect(() => {
    setOpen(currentKey);
  }, [currentKey]);
  // 보러 온 단계가 있으면 그것이 이긴다. 브랜드가 배송 줄에서 열었는데 "지금 단계"가
  // 가이드라서 가이드가 펼쳐지면, 주소를 보려고 한 번 더 눌러야 한다.
  useEffect(() => {
    if (focusStep) setOpen(focusStep);
  }, [focusStep]);

  /**
   * 한 단계만 보고 있는 중인가.
   *
   * 들어온 단계가 바뀌면 다시 그 단계 하나로 돌아간다 — 기획안을 보다가 전체를 펼쳐 둔
   * 뒤 영상 초안 칸에서 다른 사람을 열면, 펼쳐 둔 상태가 따라와서 또 다섯 줄이 된다.
   */
  const [showAllSteps, setShowAllSteps] = useState(false);
  useEffect(() => {
    setShowAllSteps(false);
  }, [onlyStep, collabId]);

  const soloStep = onlyStep && STEPS.some(s => s.key === onlyStep) ? (onlyStep as StepKey) : '';
  const solo = Boolean(soloStep) && !showAllSteps;
  const visibleStates = solo ? states.filter(s => s.key === soloStep) : states;

  const [busy, setBusy] = useState(false);

  const act = async (action: string, payload: Record<string, any>, okMessage: string) => {
    setBusy(true);
    const res = await apiService.collabAction(collabId, action, payload, undefined, role);
    setBusy(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return false;
    }
    onNotify(okMessage);
    await onRefresh();
    return true;
  };

  // ── 1. 콘텐츠 가이드 ─────────────────────────────────────────────────
  const [guideFile, setGuideFile] = useState<File | null>(null);

  const uploadGuide = async () => {
    if (!guideFile) return;
    setBusy(true);
    const fileUrl = await apiService.uploadProposalAttachment(`collab-${collabId}`, guideFile);
    setBusy(false);
    if (!fileUrl) {
      onNotify('파일 업로드에 실패했습니다.', 'error');
      return;
    }
    const ok = await act(
      'add_asset',
      { kind: 'guide', title: guideFile.name, fileUrl, fileName: guideFile.name, mimeType: guideFile.type },
      '가이드 파일을 올렸습니다.',
    );
    if (ok) setGuideFile(null);
  };

  // ── 2. 제품 배송 ────────────────────────────────────────────────────
  const [ship, setShip] = useState({
    recipient: '', phone: '', postcode: '', address1: '', address2: '', memo: '',
  });
  const [tracking, setTracking] = useState({ courier: '', trackingNumber: '' });
  /** 주소 SDK 를 못 받았을 때만 켠다 — 그때는 직접 적어야 한다. */
  const [postcodeFailed, setPostcodeFailed] = useState(false);

  /**
   * 저장된 주소를 칸에 되돌려 놓는다.
   *
   * 예전에는 받는 분·연락처·주소만 의존성으로 걸어 두어서, 상세주소나 요청사항만
   * 바뀐 저장은 화면에 되돌아오지 않았다. 저장한 값 전체를 한 문자열로 묶어 비교하면
   * 그 구멍이 없어지고, 사람이 타자를 치는 중에는(저장값이 그대로이므로) 다시 덮어쓰지도
   * 않는다.
   */
  const shippingKey = [
    shipping.recipient, shipping.phone, shipping.postcode,
    shipping.address1, shipping.address2, shipping.memo,
    shipping.courier, shipping.trackingNumber, shipping.savedAt,
  ].join('|');

  useEffect(() => {
    setShip({
      recipient: shipping.recipient || '',
      phone: shipping.phone || '',
      postcode: shipping.postcode || '',
      address1: shipping.address1 || '',
      address2: shipping.address2 || '',
      memo: shipping.memo || '',
    });
    setTracking({ courier: shipping.courier || '', trackingNumber: shipping.trackingNumber || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingKey]);

  const searchAddress = async () => {
    const ok = await openPostcodeSearch(({ postcode, address }) => {
      setShip(prev => ({ ...prev, postcode, address1: address }));
      setPostcodeFailed(false);
      // 검색으로 받은 주소 뒤에 남는 것은 동·호수뿐이다. 그 칸으로 커서를 옮겨 준다.
      setTimeout(() => document.getElementById(`ship-detail-${collabId}`)?.focus(), 100);
    });
    if (!ok) setPostcodeFailed(true);
  };

  const saveShipping = async () => {
    if (!ship.recipient.trim()) { onNotify('받는 분 이름을 입력해 주세요.', 'error'); return; }
    if (!ship.phone.trim()) { onNotify('연락처를 입력해 주세요.', 'error'); return; }
    if (!ship.address1.trim()) { onNotify('주소 찾기로 주소를 선택해 주세요.', 'error'); return; }
    const ok = await act('save_shipping', ship, '배송 정보를 저장했습니다. 브랜드가 바로 확인합니다.');
    // 저장이 끝나면 단계를 접는다. 다 적은 칸을 계속 펼쳐 두면 아직 할 일이 남은
    // 것처럼 보인다.
    if (ok) setOpen('');
  };

  // ── 3·4·5. 기획안 · 영상 · 업로드 ────────────────────────────────────
  const planWork = workOf('plan');
  const videoWork = workOf('video');
  /**
   * 기획안은 장면 단위로 받는다.
   *
   * 예전에는 큰 글상자 하나였다. 그렇게 모인 기획안에는 브랜드가 의견을 붙일 자리가
   * 없다 — "두 번째 자막을 바꿔 달라"고 적어도 그 자막이라는 칸 자체가 없어서, 결국
   * 기획안 전체에 대한 한 덩어리 피드백이 되고 인플루언서는 어디를 고쳐야 하는지
   * 다시 물어야 했다. 장면 1의 설명과 자막부터 시작하고, + 를 누르면 장면 2가 생긴다.
   */
  const [scenes, setScenes] = useState<StoryboardScene[]>([emptyScene()]);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadLink, setUploadLink] = useState('');
  const [adCode, setAdCode] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  /** 지금 피드백 칸이 열려 있는 자리. 장면마다 칸을 늘 펴 두면 기획안이 안 보인다. */
  const [composer, setComposer] = useState('');

  useEffect(() => {
    const saved = normalizeScenes(planWork?.payload?.scenes);
    if (saved.length > 0) {
      setScenes(saved);
    } else {
      // 장면 없이 글상자로 낸 예전 기획안은 그 글을 장면 1의 설명으로 이어받는다.
      const legacy = String(planWork?.payload?.body || '');
      setScenes([{ ...emptyScene(), visual: legacy }]);
    }
    setVideoLink(String(videoWork?.payload?.link || ''));
    setUploadLink(String(collab.uploadUrl || ''));
    setAdCode(String(collab.adCode || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planWork?.id, videoWork?.id, collab.uploadUrl, collab.adCode]);

  const patchScene = (index: number, key: keyof StoryboardScene, value: string) =>
    setScenes(prev => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));
  const addScene = () => setScenes(prev => [...prev, emptyScene()]);
  const removeScene = (index: number) =>
    setScenes(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const savePlan = async () => {
    const filled = scenes.filter(s => !sceneIsEmpty(s));
    if (filled.length === 0 && !planFile) {
      onNotify('장면 1의 설명을 적어 주세요.', 'error');
      return;
    }
    const missing = filled.findIndex(s => !s.visual.trim());
    if (missing >= 0) {
      onNotify(`장면 ${missing + 1}의 설명을 적어 주세요.`, 'error');
      return;
    }
    // 장면을 줄글로도 함께 보낸다. 담당자 화면과 알림처럼 글로만 읽는 자리가 있다.
    const body = filled
      .map((s, i) => `장면 ${i + 1}\n설명: ${s.visual}${s.subtitle.trim() ? `\n자막: ${s.subtitle}` : ''}`)
      .join('\n\n');
    await saveWork('plan', { scenes: filled, body }, planFile);
  };

  const saveWork = async (step: 'plan' | 'video' | 'upload', extra: Record<string, any>, file: File | null) => {
    let fileUrl = '';
    let fileName = '';
    if (file) {
      setBusy(true);
      const url = await apiService.uploadProposalAttachment(`collab-${collabId}`, file);
      setBusy(false);
      if (!url) {
        onNotify('파일 업로드에 실패했습니다.', 'error');
        return;
      }
      fileUrl = url;
      fileName = file.name;
    }
    const ok = await act('save_step_work', { stepKey: step, fileUrl, fileName, ...extra }, '등록했습니다. 브랜드가 확인하면 알려 드릴게요.');
    if (ok) {
      if (step === 'plan') setPlanFile(null);
      if (step === 'video') setVideoFile(null);
      // 다 적은 칸은 접는다. 펼쳐진 채로 남으면 아직 할 일이 남은 것처럼 보이고,
      // 접힌 줄에 색이 들어오는 것으로 "올라갔다"가 한눈에 읽힌다.
      setOpen('');
    }
  };

  /**
   * 피드백 한 줄. anchor 가 있으면 그 자리(장면 번호)에 붙는다.
   *
   * 자리 없는 피드백은 기획안 전체에 대한 말이 되고, 그러면 "몇 번 장면"인지를
   * 본문에 적어야 한다 — 그 순간 장면으로 나눈 의미가 없어진다.
   */
  const sendFeedback = async (step: StepKey, anchor = '') => {
    const key = anchor ? `${step}:${anchor}` : step;
    const text = (reply[key] || '').trim();
    if (!text) return;
    const ok = await act('step_feedback', { stepKey: step, body: text, anchor }, '피드백을 전달했습니다.');
    if (ok) {
      setReply(prev => ({ ...prev, [key]: '' }));
      setComposer('');
    }
  };

  // ── 공통 조각 ───────────────────────────────────────────────────────
  // 컴포넌트가 아니라 함수로 둔다. 컴포넌트로 만들면 입력할 때마다 상태가 바뀌면서
  // 새 타입으로 인식돼 통째로 다시 마운트되고, 피드백을 한 글자 칠 때마다 커서가
  // 칸 밖으로 튀어나간다.
  const renderFeedbackThread = (step: StepKey, sceneIndex = -2) => {
    // sceneIndex 가 -2 면 그 단계의 "자리 없는" 피드백만, 0 이상이면 그 장면의 것만.
    const rows = feedbacksOf(step).filter((f: any) => {
      const parsed = parseAnchor(f.anchor);
      const at = parsed.kind === 'scene' ? parsed.sceneIndex : -1;
      return sceneIndex === -2 ? at === -1 : at === sceneIndex;
    });
    if (rows.length === 0) return null;
    return (
      <div className="space-y-1.5">
        {rows.map((f: any) => (
          <div key={f.id} className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-black text-amber-700">
                {f.authorType === 'brand' ? '브랜드 피드백' : '담당자 피드백'}
              </span>
              <span className="text-[10px] text-slate-400 font-bold">{fmtDate(f.createdAt)}</span>
              {f.status === 'applied' && <span className="text-[10px] font-black text-emerald-600">반영 완료</span>}
            </div>
            <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">{f.body}</p>
            {/* 반영 여부는 인플루언서가 표시한다. 피드백 밑에 두는 이유는, 다른 화면에
                모아 두면 "무엇에 대한 반영인지"가 사라지기 때문이다. */}
            {isInfluencer && ['open', 'relayed'].includes(String(f.status)) && (
              <div className="flex gap-1.5 mt-2">
                <button
                  onClick={() => act('resolve_feedback', { feedbackId: f.id, status: 'applied' }, '반영 완료로 표시했습니다.')}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-black disabled:opacity-40"
                >
                  반영했어요
                </button>
                <button
                  onClick={() => {
                    const note = window.prompt('반영이 어려운 이유를 적어 주세요.')?.trim();
                    if (note) act('resolve_feedback', { feedbackId: f.id, status: 'wont_apply', note }, '전달했습니다.');
                  }}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-600 text-[10px] font-black disabled:opacity-40"
                >
                  어려워요
                </button>
              </div>
            )}
            {f.resolutionNote && String(f.status) === 'wont_apply' && (
              <p className="text-[10px] text-slate-400 font-bold mt-1.5">미반영 사유: {f.resolutionNote}</p>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderFeedbackBox = (step: StepKey, placeholder: string) => (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <p className="text-[10px] font-black text-slate-500 mb-1.5">브랜드 피드백 남기기</p>
      <textarea
        value={reply[step] || ''}
        onChange={e => setReply(prev => ({ ...prev, [step]: e.target.value }))}
        rows={3}
        placeholder={placeholder}
        className={`${inputCls} resize-none`}
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => sendFeedback(step)}
          disabled={busy || !(reply[step] || '').trim()}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          피드백 보내기
        </button>
      </div>
    </div>
  );

  /** 아직 인플루언서가 반영하지 않은 피드백. 검토를 닫기 전에 세어 보는 값이다. */
  const openFeedbackCount = (step: StepKey) =>
    feedbacksOf(step).filter((f: any) => ['open', 'relayed'].includes(String(f.status))).length;

  /**
   * 브랜드가 이 단계를 닫는다 — "더 볼 것이 없다".
   *
   * 예전에는 이 동작이 피드백 칸 안에서 "피드백 보내기" 옆에 같은 크기로 붙어 있었다.
   * 그 두 버튼은 정반대의 일을 한다: 하나는 "고쳐 주세요"(공을 되돌려준다)이고, 다른
   * 하나는 "끝났습니다"(다음 단계로 넘긴다)다. 나란히 두면 어느 쪽이 진행이고 어느
   * 쪽이 되돌림인지 눌러 봐야 알고, 실제로 브랜드는 피드백만 남긴 채 단계를 닫지 않아
   * 인플루언서 쪽에는 "브랜드 확인 대기"가 그대로 남았다. 되돌리는 일은 피드백 칸에
   * 두고, 넘기는 일은 그 아래 따로 선다.
   *
   * 반영되지 않은 피드백이 남아 있어도 막지는 않는다 — 인플루언서가 "반영했어요"를
   * 누르지 않고 그냥 다시 올리는 경우가 흔해서, 막으면 진행이 여기서 멈춘다. 대신
   * 몇 개가 남았는지 세어 보여 주고 한 번 더 묻는다.
   */
  const completeReview = async (step: StepKey, stepName: string) => {
    const remaining = openFeedbackCount(step);
    const question = remaining > 0
      ? `아직 반영 표시가 되지 않은 피드백이 ${remaining}개 있습니다.\n\n그래도 ${stepName} 검토를 완료하고 다음 단계로 넘어갈까요?`
      : `${stepName}에 더 수정할 부분이 없다면 검토를 완료합니다.\n\n다음 단계로 넘어갈까요?`;
    if (!window.confirm(question)) return;
    await act('confirm_step', { stepKey: step }, `${stepName} 검토를 완료했습니다. 다음 단계로 넘어갑니다.`);
  };

  /** 검토 완료 줄. 브랜드·담당자 화면에서 제출물이 올라온 단계에만 선다. */
  const renderReviewComplete = (step: StepKey, stepName: string) => {
    if (!isBrandSide) return null;

    if (doneOf(step)) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-[11px] font-black text-emerald-700">
            {stepName} 검토 완료 · 다음 단계로 넘어갔습니다
          </p>
        </div>
      );
    }

    const remaining = openFeedbackCount(step);
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
        <p className="text-[11px] font-black text-emerald-800">더 이상 수정할 부분이 없나요?</p>
        <p className="text-[10px] font-bold text-emerald-700/80 mt-0.5 leading-relaxed">
          검토를 완료하면 이 단계가 닫히고, 인플루언서에게 다음 단계가 열립니다.
        </p>
        {remaining > 0 && (
          <p className="text-[10px] font-black text-amber-700 mt-1.5">
            아직 반영 표시가 되지 않은 피드백 {remaining}개가 남아 있습니다.
          </p>
        )}
        <button
          onClick={() => completeReview(step, stepName)}
          disabled={busy}
          className="mt-2 w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-500 disabled:opacity-40 transition-colors"
        >
          {stepName} 검토 완료 · 다음 단계로
        </button>
      </div>
    );
  };

  /** 장면 하나에만 붙는 작은 피드백 칸. 접었다 펴는 이유는 다섯 장면이면 칸도 다섯이라서다. */
  const renderSceneFeedbackBox = (step: StepKey, index: number) => {
    const anchor = sceneAnchor(index);
    const key = `${step}:${anchor}`;
    if (composer !== key) {
      return (
        <button
          onClick={() => setComposer(key)}
          className="mt-2 px-2.5 py-1.5 rounded-md bg-slate-900 text-white text-[10px] font-black hover:bg-slate-700 transition-colors"
        >
          이 장면에 피드백
        </button>
      );
    }
    return (
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
        <textarea
          value={reply[key] || ''}
          onChange={e => setReply(prev => ({ ...prev, [key]: e.target.value }))}
          rows={2}
          autoFocus
          placeholder={`장면 ${index + 1}에서 바꿨으면 하는 점을 적어 주세요.`}
          className={`${inputCls} resize-none`}
        />
        <div className="flex gap-1.5 mt-1.5">
          <button
            onClick={() => sendFeedback(step, anchor)}
            disabled={busy || !(reply[key] || '').trim()}
            className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-[10px] font-black hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            보내기
          </button>
          <button
            onClick={() => setComposer('')}
            className="px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-500 text-[10px] font-black hover:bg-slate-100 transition-colors"
          >
            접기
          </button>
        </div>
      </div>
    );
  };

  const renderFileLink = (url: string, name: string) => (
    <a
      key={url}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-900 transition-colors"
    >
      <span className="text-sm">📄</span>
      <span className="min-w-0 flex-1 text-xs font-bold text-slate-800 truncate">{name}</span>
      <span className="text-[10px] font-black text-slate-500 flex-shrink-0">열기</span>
    </a>
  );

  // ── 단계별 본문 ─────────────────────────────────────────────────────
  const renderStep = (step: StepKey) => {
    switch (step) {
      case 'guide':
        return (
          <div className="space-y-3">
            {guideFiles.length === 0 && !String(guideline.note || '').trim() ? (
              <p className="text-xs text-slate-400 font-medium">
                {isBrandSide ? '가이드 파일을 올리면 인플루언서가 바로 확인합니다.' : '브랜드가 가이드를 올리면 여기에 표시됩니다.'}
              </p>
            ) : (
              <>
                {guideFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {guideFiles.map((f: any) => renderFileLink(f.url, f.name || '가이드 파일'))}
                  </div>
                )}
                {String(guideline.note || '').trim() && (
                  <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed rounded-lg bg-slate-50 p-3">
                    {guideline.note}
                  </p>
                )}
                {String(guideline.url || '').trim() && (
                  <a href={guideline.url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-black text-blue-600 hover:underline break-all">
                    가이드 문서 열기
                  </a>
                )}
              </>
            )}

            {isBrandSide && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="file"
                  accept="image/*,video/*,application/pdf"
                  onChange={e => setGuideFile(e.target.files?.[0] || null)}
                  className="min-w-0 flex-1 text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-md file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[10px] file:font-black"
                />
                <button
                  onClick={uploadGuide}
                  disabled={busy || !guideFile}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                >
                  가이드 올리기
                </button>
              </div>
            )}

            {isInfluencer && guideReady && !doneOf('guide') && (
              <button
                onClick={() => act('confirm_step', { stepKey: 'guide' }, '가이드 확인을 표시했습니다.')}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
              >
                가이드 확인했어요
              </button>
            )}
          </div>
        );

      case 'shipping':
        return isInfluencer ? (
          <div className="space-y-3">
            {String(shipping.status) === 'shipped' ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                <p className="text-xs font-black text-emerald-700">제품이 발송됐습니다</p>
                <p className="text-[11px] text-emerald-600 font-bold mt-0.5">
                  {[shipping.courier, shipping.trackingNumber].filter(Boolean).join(' ') || '송장 정보 없음'}
                  {shipping.shippedAt ? ` · ${fmtDate(shipping.shippedAt)}` : ''}
                </p>
              </div>
            ) : shipping.filled ? (
              /* 저장된 주소를 맨 위에 한 번 더 보여 준다. 칸만 채워져 있으면
                 "이게 저장된 값인지 내가 방금 친 값인지"를 알 수 없다. */
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                <p className="text-xs font-black text-emerald-700">배송지 저장 완료 · 브랜드 발송 대기</p>
                <p className="text-[11px] text-emerald-700 font-bold mt-0.5 leading-relaxed">
                  {shipping.recipient} · {formatPhone(shipping.phone)}
                  <br />
                  {[shipping.postcode && `(${shipping.postcode})`, shipping.address1, shipping.address2].filter(Boolean).join(' ')}
                </p>
              </div>
            ) : (
              /* 아직 아무것도 저장되지 않은 상태. 이 칸이 회색 안내문 하나였을 때는
                 "지금 여기를 채워야 제품이 온다"는 것이 어디에도 없었다. */
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
                <p className="text-xs font-black text-blue-700">제품을 받을 주소를 입력해 주세요</p>
                <p className="text-[11px] text-blue-600/90 font-bold mt-0.5 leading-relaxed">
                  저장하면 브랜드가 바로 발송합니다. 입력한 주소는 이 캠페인의 브랜드에게만 보입니다.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="받는 분"><input value={ship.recipient} onChange={e => setShip({ ...ship, recipient: e.target.value })} className={fieldCls(ship.recipient)} /></Field>
              <Field label="연락처"><input value={ship.phone} onChange={e => setShip({ ...ship, phone: formatPhoneInput(e.target.value) })} inputMode="numeric" placeholder="010-0000-0000" className={fieldCls(ship.phone)} /></Field>
            </div>

            {/* 주소는 검색으로 받는다. 손으로 적으면 우편번호가 비거나 도로명과
                지번이 섞여 들어와, 택배를 부치는 쪽이 결국 되묻게 된다. */}
            <div className="grid grid-cols-[100px_1fr_auto] gap-2 items-end">
              <Field label="우편번호">
                <input value={ship.postcode} readOnly onClick={searchAddress} placeholder="검색" className={`${fieldCls(ship.postcode)} cursor-pointer`} />
              </Field>
              <Field label="주소">
                <input value={ship.address1} readOnly onClick={searchAddress} placeholder="주소 찾기를 눌러 주세요" className={`${fieldCls(ship.address1)} cursor-pointer`} />
              </Field>
              <button
                type="button"
                onClick={searchAddress}
                className="px-3.5 py-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 transition-colors flex-shrink-0"
              >
                주소 찾기
              </button>
            </div>
            {postcodeFailed && (
              <p className="text-[10px] font-bold text-amber-600">
                주소 검색을 열지 못했습니다. 아래 상세주소 칸에 전체 주소를 적어 주세요.
              </p>
            )}

            <Field label="상세주소">
              <input
                id={`ship-detail-${collabId}`}
                value={ship.address2}
                onChange={e => setShip({ ...ship, address2: e.target.value })}
                placeholder="동 · 호수"
                className={fieldCls(ship.address2)}
              />
            </Field>
            <Field label="배송 요청사항 (선택)"><input value={ship.memo} onChange={e => setShip({ ...ship, memo: e.target.value })} placeholder="부재 시 문 앞에 놓아주세요" className={fieldCls(ship.memo)} /></Field>
            <button
              onClick={saveShipping}
              disabled={busy}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
            >
              {busy ? '저장 중...' : shipping.filled ? '배송 정보 수정 저장' : '배송 정보 저장'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {shipping.filled ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                <p className="text-[10px] font-black text-emerald-700 mb-1">
                  인플루언서가 배송지를 입력했습니다{shipping.savedAt ? ` · ${fmtDate(shipping.savedAt)}` : ''}
                </p>
                <p className="text-xs font-black text-slate-900">
                  {shipping.recipient} · {formatPhone(shipping.phone)}
                </p>
                <p className="text-xs text-slate-600 font-medium mt-1 leading-relaxed">
                  {[shipping.postcode && `(${shipping.postcode})`, shipping.address1, shipping.address2].filter(Boolean).join(' ')}
                </p>
                {shipping.memo && <p className="text-[11px] text-slate-400 font-bold mt-1">요청사항: {shipping.memo}</p>}
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      `${shipping.recipient} ${formatPhone(shipping.phone)} ${[shipping.postcode && `(${shipping.postcode})`, shipping.address1, shipping.address2].filter(Boolean).join(' ')}`,
                    )
                  }
                  className="mt-2 text-[10px] font-black text-blue-600"
                >
                  주소 복사
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">인플루언서가 주소를 입력하면 여기에 표시됩니다.</p>
            )}

            {shipping.filled && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <Field label="택배사"><input value={tracking.courier} onChange={e => setTracking({ ...tracking, courier: e.target.value })} placeholder="CJ대한통운" className={inputCls} /></Field>
                <Field label="송장번호"><input value={tracking.trackingNumber} onChange={e => setTracking({ ...tracking, trackingNumber: e.target.value })} className={inputCls} /></Field>
                <button
                  onClick={() => act('mark_shipped', tracking, '발송 완료로 표시했습니다.')}
                  disabled={busy}
                  className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-black disabled:opacity-40 hover:bg-emerald-500 transition-colors"
                >
                  {String(shipping.status) === 'shipped' ? '송장 수정' : '발송 완료'}
                </button>
              </div>
            )}
          </div>
        );

      case 'plan': {
        /** 브랜드가 보는 것은 제출된 장면. 인플루언서가 보는 것은 지금 쓰고 있는 장면. */
        const savedScenes = normalizeScenes(planWork?.payload?.scenes);
        const shownScenes = isInfluencer ? scenes : savedScenes;
        return (
          <div className="space-y-3">
            {isInfluencer ? (
              <>
                <p className="text-[11px] text-slate-400 font-medium">
                  장면 하나에 설명과 자막을 적고, 아래 + 로 다음 장면을 추가하세요. 브랜드는 장면마다 피드백을 답니다.
                </p>
                {scenes.map((scene, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-black text-slate-900">장면 {i + 1}</span>
                      {scenes.length > 1 && (
                        <button
                          onClick={() => removeScene(i)}
                          className="text-[10px] font-black text-slate-400 hover:text-red-500 transition-colors"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Field label="설명">
                        <textarea
                          value={scene.visual}
                          onChange={e => patchScene(i, 'visual', e.target.value)}
                          rows={3}
                          placeholder="어떤 장면을 찍는지 (예: 제품을 손에 들고 카메라 정면)"
                          className={`${fieldCls(scene.visual)} resize-none leading-relaxed`}
                        />
                      </Field>
                      <Field label="자막">
                        <input
                          value={scene.subtitle}
                          onChange={e => patchScene(i, 'subtitle', e.target.value)}
                          placeholder="화면에 뜨는 글자"
                          className={fieldCls(scene.subtitle)}
                        />
                      </Field>
                    </div>
                    {/* 브랜드가 이 장면에 남긴 말은 이 장면 안에 둔다. */}
                    <div className="mt-2">{renderFeedbackThread('plan', i)}</div>
                  </div>
                ))}
                <button
                  onClick={addScene}
                  className="w-full py-2.5 rounded-lg border border-dashed border-slate-300 text-[11px] font-black text-slate-500 hover:border-slate-900 hover:text-slate-900 transition-colors"
                >
                  + 장면 추가
                </button>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={e => setPlanFile(e.target.files?.[0] || null)}
                    className="min-w-0 flex-1 text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-md file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[10px] file:font-black"
                  />
                  <button
                    onClick={savePlan}
                    disabled={busy}
                    className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                  >
                    {planWork ? '기획안 다시 올리기' : '기획안 등록'}
                  </button>
                </div>
              </>
            ) : planWork ? (
              <>
                {shownScenes.map((scene, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                    <span className="text-xs font-black text-slate-900">장면 {i + 1}</span>
                    <div className="mt-1.5 space-y-1.5">
                      <div className="flex gap-2">
                        <span className="text-[10px] font-black text-slate-400 w-8 flex-shrink-0 pt-0.5">설명</span>
                        <p className="flex-1 text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                          {scene.visual || <span className="text-slate-300">비어 있음</span>}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[10px] font-black text-slate-400 w-8 flex-shrink-0 pt-0.5">자막</span>
                        <p className="flex-1 text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                          {scene.subtitle || <span className="text-slate-300">없음</span>}
                        </p>
                      </div>
                    </div>
                    {renderFeedbackThread('plan', i)}
                    {isBrandSide && renderSceneFeedbackBox('plan', i)}
                  </div>
                ))}
                {/* 장면 없이 글상자로 낸 예전 기획안. 그대로 열려야 한다. */}
                {shownScenes.length === 0 && String(planWork.payload?.body || '').trim() && (
                  <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed rounded-lg bg-slate-50 p-3">
                    {planWork.payload.body}
                  </p>
                )}
                {planWork.payload?.fileUrl && renderFileLink(planWork.payload.fileUrl, planWork.payload.fileName || '기획안 파일')}
                <p className="text-[10px] text-slate-400 font-bold">{planWork.version}번째 안 · {fmtDate(planWork.createdAt)}</p>
              </>
            ) : (
              <p className="text-xs text-slate-400 font-medium">인플루언서가 기획안을 올리면 여기에 표시됩니다.</p>
            )}

            {/* 기획안 바로 아래에 피드백, 그 아래에 검토 완료. 이 순서가 이 단계의
                전부다 — 읽고, 고칠 것을 말하고, 없으면 넘긴다. */}
            {renderFeedbackThread('plan')}
            {isBrandSide && planWork && renderFeedbackBox('plan', '기획안 전체에 대한 의견을 적어 주세요. 장면 하나를 고쳐야 하면 그 장면의 피드백 칸을 쓰세요.')}
            {planWork && renderReviewComplete('plan', '기획안')}
          </div>
        );
      }

      case 'video':
        return (
          <div className="space-y-3">
            {isInfluencer ? (
              <>
                <Field label="초안 영상 링크">
                  <input
                    value={videoLink}
                    onChange={e => setVideoLink(e.target.value)}
                    placeholder="유튜브 · 구글드라이브 등 볼 수 있는 링크"
                    className={inputCls}
                  />
                </Field>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={e => setVideoFile(e.target.files?.[0] || null)}
                    className="min-w-0 flex-1 text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-md file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[10px] file:font-black"
                  />
                  <button
                    onClick={() => saveWork('video', { link: videoLink }, videoFile)}
                    disabled={busy}
                    className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                  >
                    {videoWork ? '영상 다시 올리기' : '초안 영상 올리기'}
                  </button>
                </div>
              </>
            ) : videoWork ? (
              <div className="rounded-lg bg-slate-50 p-3 space-y-2">
                {videoWork.payload?.link && (
                  <a href={videoWork.payload.link} target="_blank" rel="noopener noreferrer" className="block text-xs font-black text-blue-600 hover:underline break-all">
                    초안 영상 열기
                  </a>
                )}
                {videoWork.payload?.fileUrl && renderFileLink(videoWork.payload.fileUrl, videoWork.payload.fileName || '초안 영상')}
                <p className="text-[10px] text-slate-400 font-bold">{videoWork.version}번째 안 · {fmtDate(videoWork.createdAt)}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">인플루언서가 초안 영상을 올리면 여기에 표시됩니다.</p>
            )}

            {renderFeedbackThread('video')}
            {isBrandSide && videoWork && renderFeedbackBox('video', '수정이 필요한 장면과 이유를 적어 주세요.')}
            {videoWork && renderReviewComplete('video', '영상')}
          </div>
        );

      case 'upload':
      default:
        return (
          <div className="space-y-3">
            <div className={`rounded-lg px-3 py-2.5 ${collab.uploadConfirmedAt ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50'}`}>
              <p className={`text-xs font-black ${collab.uploadConfirmedAt ? 'text-emerald-700' : 'text-slate-500'}`}>
                {collab.uploadConfirmedAt
                  ? `업로드 확인 완료 · ${fmtDate(collab.uploadConfirmedAt)}`
                  : collab.uploadUrl
                    ? '게시물 등록됨 · 브랜드 확인 대기'
                    : '아직 업로드 전'}
              </p>
              {collab.uploadUrl && (
                <a href={collab.uploadUrl} target="_blank" rel="noopener noreferrer" className="block text-[11px] font-bold text-blue-600 hover:underline break-all mt-1">
                  {collab.uploadUrl}
                </a>
              )}
            </div>

            {isInfluencer ? (
              <>
                <Field label="게시물 링크">
                  <input value={uploadLink} onChange={e => setUploadLink(e.target.value)} placeholder="https://" className={inputCls} />
                </Field>
                <Field label="광고 파트너십 코드">
                  <input value={adCode} onChange={e => setAdCode(e.target.value)} placeholder="브랜디드 콘텐츠 파트너십 코드" className={inputCls} />
                </Field>
                <button
                  onClick={() => saveWork('upload', { link: uploadLink, adCode }, null)}
                  disabled={busy}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                >
                  업로드 정보 등록
                </button>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-black text-slate-400 mb-1">광고 파트너십 코드</p>
                  {collab.adCode ? (
                    <div className="flex items-center justify-between gap-3">
                      <code className="text-xs font-bold text-slate-800 break-all">{collab.adCode}</code>
                      <button onClick={() => navigator.clipboard?.writeText(collab.adCode)} className="text-[10px] font-black text-blue-600 flex-shrink-0">복사</button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 font-medium">인플루언서가 코드를 공유하면 여기에 표시됩니다.</p>
                  )}
                </div>
                {collab.uploadUrl && !collab.uploadConfirmedAt && (
                  <button
                    onClick={() => act('confirm_step', { stepKey: 'upload' }, '업로드를 확인했습니다.')}
                    disabled={busy}
                    className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-black disabled:opacity-40 hover:bg-emerald-500 transition-colors"
                  >
                    업로드 확인 완료
                  </button>
                )}
              </>
            )}

            {renderFeedbackThread('upload')}
          </div>
        );
    }
  };

  /** 단계 한 줄에 붙는 상태 한 마디. 길면 읽지 않는다. */
  const statusText = (step: StepKey, done: boolean, current: boolean) => {
    if (done) return '완료';
    // 내 차례인 단계에는 상태가 아니라 할 일을 적는다. "진행 중"은 무엇을 해야
    // 하는지 아무것도 말해 주지 않는다 — 배송 줄에서 가장 크게 걸렸던 부분이다.
    const turn = turnOf(step);
    if (turn?.mine) return turn.short;
    if (revisionOf(step)) return isInfluencer ? '피드백 반영이 필요합니다' : '수정 요청 전달됨';
    if (step === 'shipping' && shipping.filled) return isInfluencer ? '입력 완료 · 브랜드 발송 대기' : '발송해 주세요';
    if (step === 'plan' && planWork) return isInfluencer ? '입력 완료 · 브랜드 확인 대기' : '확인해 주세요';
    if (step === 'video' && videoWork) return isInfluencer ? '등록 완료 · 브랜드 확인 대기' : '확인해 주세요';
    if (step === 'upload' && collab.uploadUrl) return isInfluencer ? '등록 완료 · 브랜드 확인 대기' : '확인해 주세요';
    if (step === 'guide' && guideFiles.length === 0) return isBrandSide ? '가이드를 올려 주세요' : '브랜드 준비 중';
    return current ? '진행 중' : '진행 전';
  };

  /**
   * 보드 맨 위 한 칸 — "지금 할 일".
   *
   * 다섯 줄의 색만으로는 부족했다. 색은 이미 무언가를 말하고 있었지만(완료 · 진행 전),
   * 처음 이 화면을 여는 사람에게 그 색의 뜻을 알려 주는 것은 아무것도 없었다. 그래서
   * 할 일을 문장으로 한 번 적고, 그 단계로 바로 가는 버튼을 붙인다. 할 일이 없으면
   * 무엇을 기다리는 중인지 적는다 — 기다리는 중이라는 것도 정보다.
   */
  const renderActionBanner = () => {
    if (myAction) {
      const amber = myAction.revision;
      return (
        <div
          className={`px-4 py-3.5 border-b ${
            amber ? 'bg-amber-50 border-amber-100' : 'bg-blue-50 border-blue-100'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="relative flex h-2.5 w-2.5 mt-1 flex-shrink-0">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                  amber ? 'bg-amber-400' : 'bg-blue-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  amber ? 'bg-amber-500' : 'bg-blue-600'
                }`}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-black ${amber ? 'text-amber-700' : 'text-blue-700'}`}>
                {amber ? '수정 요청' : '진행 요청'} · {myAction.title}
              </p>
              <p className="text-xs font-bold text-slate-700 mt-0.5 leading-relaxed break-keep">{myAction.todo}</p>
            </div>
            {!solo && open !== myAction.key && (
              <button
                type="button"
                onClick={() => setOpen(myAction.key)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black text-white flex-shrink-0 transition-colors ${
                  amber ? 'bg-amber-500 hover:bg-amber-400' : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                바로 가기
              </button>
            )}
          </div>
        </div>
      );
    }

    if (waitingStep) {
      return (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <p className="text-[11px] font-black text-slate-500">
            지금은 {waitingStep.owner === 'brand' ? '브랜드' : '인플루언서'}를 기다리는 중입니다 · {waitingStep.title}
          </p>
          <p className="text-[11px] font-bold text-slate-400 mt-0.5 break-keep">{waitingStep.waitingNote}</p>
        </div>
      );
    }

    return (
      <div className="px-4 py-3 border-b border-emerald-100 bg-emerald-50/70">
        <p className="text-[11px] font-black text-emerald-700">모든 단계가 끝났습니다 · 더 입력할 것이 없습니다</p>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {renderActionBanner()}
      {visibleStates.map((s, pos) => {
        /* 번호는 늘 다섯 단계 안에서의 자리다. 기획안만 보고 있다고 해서 그 줄이 1번이
           되면, 브랜드는 이 사람이 첫 단계에 서 있다고 읽는다. */
        const i = STEPS.findIndex(step => step.key === s.key);
        const isOpen = solo || open === s.key;
        const stage = stageOf(s.key);
        return (
          <div key={s.key} className={pos === 0 ? '' : 'border-t border-slate-100'}>
            <button
              type="button"
              onClick={() => { if (!solo) setOpen(isOpen ? '' : s.key); }}
              aria-expanded={solo ? undefined : isOpen}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${solo ? 'cursor-default ' : ''}${
                /* 내 차례인 줄은 펼쳐져 있어도 색을 뺏기지 않는다. 펼치면 회색이 되던
                   예전에는, 배너를 보고 눌러 들어간 순간 그 줄이 다른 줄과 같아졌다. */
                s.action
                  ? s.revision
                    ? 'bg-amber-50 hover:bg-amber-100/70'
                    : 'bg-blue-50 hover:bg-blue-100/70'
                  : isOpen
                    ? 'bg-slate-50'
                    : s.done
                      ? 'bg-emerald-50/60 hover:bg-emerald-50'
                      : s.submitted
                        ? 'bg-emerald-50/40 hover:bg-emerald-50'
                        : s.revision
                          ? 'bg-amber-50/50 hover:bg-amber-50'
                          : 'hover:bg-slate-50/60'
              }`}
            >
              {/* 동그라미 색이 이 줄의 상태다. 다 채워 넣었지만 상대의 확인을 기다리는
                  단계는 옅은 초록 — 완료(진한 초록)와 진행 전(회색) 사이의 자리다. */}
              <span className="relative flex-shrink-0">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                    s.action
                      ? s.revision
                        ? 'bg-amber-500 text-white'
                        : 'bg-blue-600 text-white'
                      : s.done
                        ? 'bg-emerald-500 text-white'
                        : s.submitted
                          ? 'bg-emerald-100 text-emerald-600'
                          : s.revision
                            ? 'bg-amber-100 text-amber-700'
                            : s.current
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {s.done || s.submitted ? '✓' : i + 1}
                </span>
                {/* 지금 손대야 하는 줄에만 붙는 점. 접힌 목록에서도 눈이 먼저 간다. */}
                {s.action && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-70 ${
                        s.revision ? 'bg-amber-400' : 'bg-blue-400'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ring-2 ring-white ${
                        s.revision ? 'bg-amber-500' : 'bg-blue-600'
                      }`}
                    />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-sm font-black truncate ${s.action || s.done || s.submitted || s.current || s.revision ? 'text-slate-900' : 'text-slate-400'}`}>
                    {s.title}
                  </span>
                  {/* 진행 요청 배지. 색만으로는 "내 차례"라는 뜻이 전달되지 않는다 —
                      색을 구분하기 어려운 사람에게도 남는 글자가 있어야 한다. */}
                  {s.action && (
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[9px] font-black flex-shrink-0 ${
                        s.revision ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
                      }`}
                    >
                      {s.revision ? '수정 요청' : '진행 요청'}
                    </span>
                  )}
                </span>
                <span
                  className={`block text-[11px] font-bold truncate ${
                    s.action
                      ? s.revision
                        ? 'text-amber-700'
                        : 'text-blue-700'
                      : isOpen
                        ? 'text-slate-400'
                        : s.done || s.submitted
                          ? 'text-emerald-600'
                          : s.revision
                            ? 'text-amber-600'
                            : 'text-slate-400'
                  }`}
                >
                  {/* 내 차례인 줄은 펼쳐도 할 일을 그대로 둔다. 펼침 안내문(lead)으로
                      바뀌면 방금 읽은 요청 문장이 사라진다. */}
                  {isOpen && !s.action ? s.lead : statusText(s.key, s.done, s.current)}
                </span>
              </span>
              {stage?.dueDate && !s.done && !s.submitted && (!isOpen || solo) && (
                <span className="text-[10px] font-black text-slate-400 flex-shrink-0">{fmtDate(stage.dueDate)}까지</span>
              )}
              {/* 한 단계만 보고 있을 때는 접을 것이 없다 — 접으면 화면에 아무것도 안 남는다. */}
              {!solo && (
                <span className={`text-slate-300 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
              )}
            </button>
            {isOpen && <div className="px-4 pb-4">{renderStep(s.key)}</div>}
          </div>
        );
      })}

      {/* 나머지 단계로 가는 문. 지난 단계를 되짚어 보는 일은 자주는 아니지만 분명히
          있고, 한 단계만 남겨 두면 그 길이 화면에서 사라진다. */}
      {soloStep && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setShowAllSteps(!showAllSteps)}
            className="text-[11px] font-black text-slate-500 hover:text-slate-900 transition-colors"
          >
            {showAllSteps ? '이 단계만 보기' : '전체 단계 보기'}
          </button>
        </div>
      )}
    </div>
  );
};

export default CampaignProcessBoard;

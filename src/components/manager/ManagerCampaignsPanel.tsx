import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import { contentFormatLabel } from '../../utils/campaignBrief';
import BrandCollabProgress from '../BrandCollabProgress';
import { parseGuidelineFiles } from '../collab/CampaignGuidelineEditor';
import ListupWorkspace from '../collab/ListupWorkspace';
import CampaignInsightPanel from '../collab/CampaignInsightPanel';
import CollabReviewRoom from '../collab/CollabReviewRoom';
import CollabSharedWorkspace from '../collab/CollabSharedWorkspace';

/**
 * 브랜드 캠페인 — 목록에서 캠페인을 눌러 들어가 인플루언서를 배정한다.
 *
 * 목록은 담당자가 없는 캠페인을 위에 둔다. 아무도 맡지 않은 캠페인은 브랜드 쪽에서
 * 보면 아무 일도 일어나지 않는 것과 같으므로, 가장 먼저 눈에 띄어야 한다.
 *
 * 화면 모양은 브랜드 · 인플루언서의 캠페인 대시보드와 같다. 카드 격자로 캠페인을
 * 고르고, 열면 머리말 카드 아래 탭(인플루언서 · 진행사항 · 인사이트 · 검수)이 붙는다.
 * 같은 캠페인을 세 사람이 서로 다른 모양의 화면으로 보면 "저 캠페인의 인사이트 탭"
 * 같은 말이 통하지 않는다 — 담당자는 브랜드와 통화하며 같은 자리를 가리켜야 하는
 * 사람이라, 그 어긋남의 비용을 담당자가 전부 낸다.
 *
 * 탭 넷은 담당자가 캠페인 하나에서 하는 일 전부다.
 *   인플루언서 — 후보를 명단에 올리고, 명단을 브랜드에 넘기고, 확정 기한을 정한다
 *   진행사항   — 브랜드가 보는 것과 똑같은 단계 보드(BrandCollabProgress).
 *                맨 위에 브랜드 담당자의 이름과 연락처가 붙는다
 *   인사이트   — 올라간 게시물의 실제 성과(조회수 · 좋아요 · 댓글 · 단가)
 *   검수       — 인플루언서가 낸 대본 · 영상을 열어 보고, 기획안 · 영상 파일을 주고받는다
 *
 * 진행 보드를 담당자용으로 새로 만들지 않은 것도 같은 이유다 — 브랜드와 담당자가 서로
 * 다른 모양의 보드를 보면 "저기서 멈춰 있다"는 말이 가리키는 자리가 두 화면에서
 * 달라진다. 목록에서만 브랜드 화면과 다른 것이 하나 있다: 캠페인을 "지금 누가 무엇을
 * 해야 하는가"로 묶어 놓는다(아래 BUCKETS). 브랜드는 자기 캠페인 몇 건을 보지만
 * 담당자는 남의 캠페인 수십 건을 보기 때문에, 격자만으로는 어디에 손대야 할지 알 수 없다.
 */

interface ManagerCampaignsPanelProps {
  managerUsername: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /**
   * 처음부터 이 캠페인을 펼친 채로 연다. 브랜드 선택 화면에서 "캠페인 열기"로
   * 넘어올 때 쓴다 — 넘어와서 목록을 다시 뒤지게 하면 건너온 뜻이 없다.
   */
  initialCampaignId?: string;
}

const STAGE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '대기', cls: 'bg-slate-100 text-slate-400' },
  active: { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: '검수 대기', cls: 'bg-amber-50 text-amber-600' },
  revision: { label: '수정중', cls: 'bg-indigo-50 text-indigo-600' },
  done: { label: '완료', cls: 'bg-emerald-50 text-emerald-600' },
  skipped: { label: '생략', cls: 'bg-slate-100 text-slate-400' },
};

/**
 * 한 묶음에서 처음에 펼쳐 두는 카드 수. 나머지는 "더 보기"로 이어 붙인다.
 * 넓은 화면에서 두 줄(5열 × 2)이 차는 수다 — 한 줄만 차면 묶음 제목이 카드보다
 * 많아지고, 세 줄이면 아래 묶음이 화면 밖으로 밀린다.
 */
const PAGE = 10;

const SCOPES = [
  { key: 'mine' as const, label: '내 담당' },
  { key: 'unassigned' as const, label: '담당자 없음' },
  { key: 'all' as const, label: '전체' },
];

/**
 * 캠페인을 "지금 누가 무엇을 해야 하는가"로 나눈 묶음.
 *
 * 담당자가 캠페인 목록에서 실제로 찾는 것은 캠페인이 아니라 할 일이다. 예전 목록은
 * 승인 시각 순으로 카드를 늘어놓았으므로, 명단을 올려야 하는 캠페인과 브랜드의 답을
 * 기다리는 캠페인이 나란히 있었고 구분은 카드 안의 숫자 네 개를 읽어야 났다.
 * 캠페인이 수십 건이 되면 그 읽기를 수십 번 해야 한다.
 *
 * 그래서 캠페인마다 묶음을 하나 정하고(bucketOf), 묶음을 다시 "내 차례 / 상대 차례"로
 * 묶는다(GROUPS). todo 는 그 줄에서 담당자가 할 일을 한 문장으로 적은 것이다.
 */
const BUCKETS = [
  {
    key: 'unassigned',
    label: '담당자 없음',
    cls: 'bg-amber-50 text-amber-700',
    todo: '이 캠페인을 맡을 사람이 없습니다',
  },
  {
    key: 'review',
    label: '검수 대기',
    cls: 'bg-rose-50 text-rose-600',
    todo: '인플루언서가 낸 제출물을 확인해 주세요',
  },
  {
    key: 'pick',
    label: '브랜드 선택',
    cls: 'bg-blue-50 text-blue-700',
    todo: '브랜드가 고른 인플루언서에게 제안을 보내 주세요',
  },
  {
    key: 'listup',
    label: '명단 필요',
    cls: 'bg-indigo-50 text-indigo-700',
    todo: '후보를 찾아 명단에 올려 주세요',
  },
  {
    key: 'publish',
    label: '명단 넘기기',
    cls: 'bg-violet-50 text-violet-700',
    todo: '명단을 브랜드에 넘기고 확정 기한을 정해 주세요',
  },
  {
    key: 'apply',
    label: '지원자 확인',
    cls: 'bg-teal-50 text-teal-700',
    todo: '직접 지원한 인플루언서를 확인해 주세요',
  },
  {
    key: 'reply',
    label: '답 기다림',
    cls: 'bg-slate-100 text-slate-500',
    todo: '보낸 제안에 인플루언서가 답할 차례입니다',
  },
  {
    key: 'brandWait',
    label: '브랜드 확인 대기',
    cls: 'bg-slate-100 text-slate-500',
    todo: '넘긴 명단에서 브랜드가 고를 차례입니다',
  },
  {
    key: 'running',
    label: '진행 중',
    cls: 'bg-emerald-50 text-emerald-600',
    todo: '협업이 굴러가는 중입니다',
  },
  {
    key: 'idle',
    label: '대기',
    cls: 'bg-slate-100 text-slate-400',
    todo: '지금 할 일이 없습니다',
  },
];

const BUCKET_MAP: Record<string, (typeof BUCKETS)[number]> = Object.fromEntries(
  BUCKETS.map((b) => [b.key, b]),
);

/**
 * 캠페인 하나의 묶음을 정한다. 위에서부터 먼저 걸리는 것이 이긴다 — 한 캠페인이
 * 여러 조건에 해당하면 담당자가 먼저 손대야 하는 쪽을 남긴다.
 */
export const bucketOf = (c: any) => {
  const n = c.counts || {};
  if (!c.managerUsername) return BUCKET_MAP.unassigned;
  if ((n.review || 0) > 0) return BUCKET_MAP.review;
  if ((n.picked || 0) > 0) return BUCKET_MAP.pick;
  if (c.managerListup && (n.listed || 0) === 0) return BUCKET_MAP.listup;
  if ((n.listed || 0) > 0 && !c.listupPublishedAt) return BUCKET_MAP.publish;
  if (!c.managerListup && (n.applications || 0) > 0) return BUCKET_MAP.apply;
  if ((n.sent || 0) > 0) return BUCKET_MAP.reply;
  if (c.listupPublishedAt && (n.picked || 0) === 0) return BUCKET_MAP.brandWait;
  if ((n.collabs || 0) > 0) return BUCKET_MAP.running;
  return BUCKET_MAP.idle;
};

/**
 * 지금 담당자가 손대야 하는 캠페인인가. 대시보드 탭 배지도 이 판정을 쓴다 —
 * 탭에 적힌 숫자와 목록의 "내 차례" 묶음이 어긋나면 배지를 믿지 않게 된다.
 */
export const isMyTurn = (c: any) =>
  ['review', 'pick', 'listup', 'publish', 'apply'].includes(bucketOf(c).key);

const GROUPS = [
  {
    key: 'todo',
    label: '내 차례',
    note: '지금 담당자가 손대야 하는 캠페인입니다.',
    buckets: ['review', 'pick', 'listup', 'publish', 'apply'],
  },
  {
    key: 'open',
    label: '주인 없는 캠페인',
    note: '아무도 맡지 않아 브랜드 쪽에서 보면 멈춰 있는 캠페인입니다.',
    buckets: ['unassigned'],
  },
  {
    key: 'waiting',
    label: '상대 차례',
    note: '브랜드나 인플루언서의 답을 기다리는 중입니다.',
    buckets: ['reply', 'brandWait'],
  },
  {
    key: 'running',
    label: '진행 중',
    note: '협업이 굴러가고 있어 따로 손댈 일이 없습니다.',
    buckets: ['running'],
  },
  {
    key: 'rest',
    label: '그 외',
    note: '',
    buckets: ['idle'],
  },
];

const ManagerCampaignsPanel: React.FC<ManagerCampaignsPanelProps> = ({
  managerUsername,
  onNotify,
  initialCampaignId,
}) => {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 목록의 범위. 담당자가 맡은 캠페인 · 아직 아무도 맡지 않은 캠페인 · 전체.
   *
   * 예전에는 "내 캠페인만" 켜고 끄는 버튼 하나였다. 캠페인이 몇 건일 때는 그것으로
   * 됐지만, 승인된 캠페인이 쌓이면 끈 상태의 목록은 남의 캠페인까지 전부 섞인 벽이
   * 되고 켠 상태에서는 아직 주인이 없는 캠페인이 보이지 않는다 — 그 둘은 담당자가
   * 가장 자주 오가는 두 화면이라 각각 자리를 준다.
   */
  const [scope, setScope] = useState<'mine' | 'unassigned' | 'all'>('mine');
  const [query, setQuery] = useState('');
  /** 고른 할 일 묶음(bucket). 비어 있으면 전부 보여 준다. */
  const [bucketFilter, setBucketFilter] = useState('');
  /** 묶음별로 지금 펼쳐 둔 줄 수. 캠페인이 수백 건이어도 첫 화면은 짧아야 한다. */
  const [shown, setShown] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDue, setConfirmDue] = useState('');
  /** 상세의 탭. 브랜드 · 인플루언서 화면과 같은 자리에 같은 이름으로 둔다. */
  const [detailTab, setDetailTab] = useState<'listup' | 'progress' | 'insight' | 'review'>('listup');
  /**
   * 브리프를 펼쳤는지. 접어 두는 이유는 담당자가 캠페인을 열 때 찾는 것이 조건이
   * 아니라 할 일이기 때문이다 — 조건은 처음 한 번 읽고, 그 뒤로는 명단과 검수만 본다.
   */
  const [showBrief, setShowBrief] = useState(false);

  const [collabs, setCollabs] = useState<any[]>([]);
  const [reviewTarget, setReviewTarget] = useState<{ collabId: string; target: 'script' | 'content' } | null>(
    null,
  );
  // 자료함은 펼친 협업 한 건만 읽는다. 캠페인 안 협업마다 미리 읽으면 목록을 여는
  // 것만으로 협업 수만큼 요청이 나간다.
  const [assetsFor, setAssetsFor] = useState('');
  const [assetDetail, setAssetDetail] = useState<any>(null);
  const [assetLoading, setAssetLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getManagerCampaigns({ mine: scope === 'mine' });
    setLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setCampaigns(res.campaigns || []);
  }, [scope, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  // 협업 목록은 캠페인을 열 때 한 번만 읽는다. 캠페인마다 부르면 목록 화면에서
  // 캠페인 수만큼 요청이 나간다.
  const loadCollabs = useCallback(async () => {
    const res = await apiService.getCollabs('manager');
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setCollabs(res.collabs || []);
  }, [onNotify]);

  const open = useMemo(() => campaigns.find((c) => c.id === openId) || null, [campaigns, openId]);

  const openCampaign = async (c: any) => {
    setOpenId(c.id);
    // 캠페인을 옮기면 탭도 처음으로 돌린다. 앞 캠페인에서 검수 탭에 있었다고 다음
    // 캠페인도 검수부터 볼 이유는 없다(대개 명단이 먼저다).
    setDetailTab('listup');
    setShowBrief(false);
    setConfirmDue(c.listupConfirmDue ? String(c.listupConfirmDue).slice(0, 10) : '');
    setAssetsFor('');
    setAssetDetail(null);
    await loadCollabs();
  };

  // 브랜드 선택 화면에서 넘어온 캠페인을 한 번만 펼친다. openId 를 이미 쥐고 있으면
  // 손대지 않는다 — 담당자가 목록으로 되돌아간 뒤에 다시 열리면 뒤로 가기가 막힌다.
  const [autoOpened, setAutoOpened] = useState('');
  useEffect(() => {
    if (!initialCampaignId || autoOpened === initialCampaignId || openId) return;
    const target = campaigns.find((c) => c.id === initialCampaignId);
    if (!target) return;
    setAutoOpened(initialCampaignId);
    openCampaign(target);
    // openCampaign 은 매 렌더 새로 만들어지므로 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, initialCampaignId, autoOpened, openId]);

  /** 협업 자료함 열기/닫기. 열 때만 상세를 읽는다. */
  const toggleAssets = async (collabId: string) => {
    if (assetsFor === collabId) {
      setAssetsFor('');
      setAssetDetail(null);
      return;
    }
    setAssetsFor(collabId);
    setAssetLoading(true);
    const res = await apiService.getCollabDetail(collabId, undefined, 'manager');
    setAssetLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      setAssetsFor('');
      return;
    }
    setAssetDetail(res);
  };

  const refreshAssets = useCallback(async () => {
    if (!assetsFor) return;
    const res = await apiService.getCollabDetail(assetsFor, undefined, 'manager');
    if (!res.error) setAssetDetail(res);
  }, [assetsFor]);

  const act = async (campaignId: string, action: any, payload: Record<string, any> = {}) => {
    setBusy(true);
    const res = await apiService.managerCampaignAction(campaignId, action, payload);
    setBusy(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return false;
    }
    // PATCH 응답은 항상 전체 목록이다. "내 담당"만 보고 있을 때 그대로 쓰면
    // 방금 켜 둔 범위가 풀려 버리므로 다시 읽는다.
    if (scope === 'mine') await load();
    else setCampaigns(res.campaigns || []);
    return true;
  };

  const publish = async () => {
    if (!open) return;
    // 날짜만 받고 그날 끝까지로 본다. 시각까지 물으면 담당자가 매번 임의의
    // 시간을 찍게 되고, 브랜드 화면의 남은 시간은 그만큼 들쭉날쭉해진다.
    const iso = confirmDue ? new Date(`${confirmDue}T23:59:59`).toISOString() : '';
    if (await act(open.id, 'publish_listup', { confirmDue: iso })) {
      onNotify(
        confirmDue
          ? `${confirmDue}까지로 확정 기한을 정했습니다. 브랜드 화면에 남은 시간이 표시됩니다.`
          : '명단을 브랜드에 넘겼습니다. 확정 기한은 정하지 않았습니다.',
      );
    }
  };

  const campaignCollabs = useMemo(
    () => (open ? collabs.filter((c) => c.campaignId === open.id) : []),
    [collabs, open],
  );

  /**
   * 범위 → 검색 → 묶음 순으로 좁힌다. 묶음 숫자는 검색까지만 반영한 목록에서 세야
   * 한다 — 묶음을 고른 뒤에 숫자가 그 하나만 남으면 다른 묶음으로 옮겨 갈 수 없다.
   */
  const scopeCampaigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((c: any) => {
      if (scope === 'unassigned' && c.managerUsername) return false;
      if (!q) return true;
      return [c.title, c.brandName, c.businessUsername, c.category, c.managerUsername]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [campaigns, scope, query]);

  const bucketCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    scopeCampaigns.forEach((c: any) => {
      const key = bucketOf(c).key;
      acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, [scopeCampaigns]);

  const visibleCampaigns = useMemo(
    () => (bucketFilter ? scopeCampaigns.filter((c: any) => bucketOf(c).key === bucketFilter) : scopeCampaigns),
    [scopeCampaigns, bucketFilter],
  );


  if (reviewTarget) {
    return (
      <CollabReviewRoom
        collabId={reviewTarget.collabId}
        target={reviewTarget.target}
        onClose={() => setReviewTarget(null)}
        onChanged={loadCollabs}
      />
    );
  }

  // ── 캠페인 상세 ───────────────────────────────────────────────────────────
  if (open) {
    const mine = open.managerUsername === managerUsername;
    const bucket = bucketOf(open);
    const uploadedCount = campaignCollabs.filter((c: any) => c.uploadUrl).length;
    const reviewCount = open.counts?.review || 0;

    /**
     * 탭. 브랜드 화면과 같은 순서 · 같은 이름이다(브랜드에만 있는 정산 탭 자리에
     * 담당자는 검수가 온다 — 정산은 담당자의 일이 아니고, 검수는 담당자만의 일이다).
     * 검수 탭에는 지금 나를 기다리는 제출물 수를 적는다. 목록의 "검수 대기" 묶음과
     * 같은 숫자라, 목록에서 눌러 들어온 담당자가 어디로 가야 하는지 바로 보인다.
     */
    const TABS = [
      { key: 'listup' as const, label: '인플루언서', count: open.counts?.listed || 0 },
      { key: 'progress' as const, label: '진행사항', count: 0 },
      { key: 'insight' as const, label: '인사이트', count: 0 },
      { key: 'review' as const, label: '검수', count: reviewCount },
    ];
    const activeTab = TABS.some((t) => t.key === detailTab) ? detailTab : 'listup';

    /** 브리프 한 칸. 값이 없는 칸은 그리지 않는다 — 빈 '-' 가 늘면 있는 조건이 묻힌다. */
    const briefTile = (label: string, value: string, note?: string) =>
      value ? (
        <div key={label} className="bg-slate-50 rounded-xl p-3">
          <p className="text-[11px] text-slate-400 font-black">{label}</p>
          <p className="text-sm font-black text-slate-900 mt-0.5 break-words">{value}</p>
          {note && <p className="text-[9px] text-slate-400 font-bold mt-0.5">{note}</p>}
        </div>
      ) : null;

    return (
      <div className="w-full max-w-[1560px] mx-auto">
        <button
          onClick={() => setOpenId('')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
          캠페인 목록
        </button>

        {/* 머리말. 조건은 '자세히 보기'로 접어 둔다. */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-7 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded-full text-xs font-black ${bucket.cls}`}>
                  {bucket.label}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-black ${
                    !open.managerUsername
                      ? 'bg-amber-50 text-amber-600'
                      : mine
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {!open.managerUsername ? '담당자 없음' : mine ? '내 담당' : `@${open.managerUsername}`}
                </span>
                {open.category && <span className="text-xs text-slate-400 font-bold">{open.category}</span>}
                {open.managerListup === false && (
                  <span className="text-xs text-slate-400 font-bold">· 지원자 모집</span>
                )}
              </div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900">{open.title}</h2>
              <p className="text-sm text-slate-500 font-bold mt-1">
                {open.brandName || open.businessUsername}
              </p>
              {/* 지금 이 캠페인에서 담당자가 할 일. 목록의 줄에 적힌 문장과 같다. */}
              <p className="text-[11px] font-bold text-slate-400 mt-1.5">{bucket.todo}</p>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {open.thumbnailUrl && (
                <div className="w-16 h-16 rounded-2xl bg-slate-100 overflow-hidden">
                  <img src={open.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              {mine ? (
                <button
                  onClick={async () => {
                    if (await act(open.id, 'release')) onNotify('담당에서 내려놓았습니다.');
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 disabled:opacity-40"
                >
                  담당 해제
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (await act(open.id, 'claim')) onNotify('이 캠페인을 맡았습니다.');
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-700 disabled:opacity-40"
                >
                  내가 맡기
                </button>
              )}
            </div>
          </div>

          <button
            onClick={() => setShowBrief((v) => !v)}
            className="mt-4 text-xs font-black text-blue-600 hover:underline"
          >
            {showBrief ? '접기 ▲' : '자세히 보기 ▼'}
          </button>

          {showBrief && (
            <div className="mt-4 space-y-4">
              {open.description && (
                <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap leading-relaxed">
                  {open.description}
                </p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {briefTile('1인 단가', open.rewardAmount ? formatKoreanWon(open.rewardAmount) : '미정')}
                {briefTile('2차 활용', open.secondUseFee > 0 ? formatKoreanWon(open.secondUseFee) : '')}
                {briefTile('업로드 채널', open.uploadChannel || '')}
                {briefTile('콘텐츠 형식', open.contentFormat ? contentFormatLabel(open.contentFormat) : '')}
                {briefTile(
                  '희망 게시일',
                  open.uploadFrom ? `${open.uploadFrom}${open.uploadTo ? ` ~ ${open.uploadTo}` : ''}` : '',
                )}
                {briefTile('제품', open.productName || '')}
                {briefTile(
                  '브랜드 확정 기한',
                  open.listupConfirmDue ? String(open.listupConfirmDue).slice(0, 10) : '',
                )}
              </div>
            </div>
          )}
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-1 border-b border-slate-100 mb-5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setDetailTab(t.key)}
              className={`px-4 py-3 text-sm font-black whitespace-nowrap border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={t.key === 'review' ? 'ml-1.5 text-rose-500' : 'ml-1.5 text-blue-600'}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ---------------------------------------------- 인플루언서 · 명단 */}
        {activeTab === 'listup' && (
          <div className="space-y-4">
            {/* 확정 기한. 브랜드 화면의 남은 시간이 이 값을 읽는다. 기한을 정하지
                않아도 명단은 이미 브랜드에게 보인다 — 여기서 정하는 것은 표시뿐이다.
                명단 옆에 두는 이유는 이 동작이 명단에 대한 동작이기 때문이다.
                제품 협찬형에는 명단이 없으므로 이 줄도 없다. */}
            {open.managerListup !== false && (
              <div className="bg-white rounded-2xl border border-slate-100 p-4 flex items-center gap-2 flex-wrap">
                <label className="text-[10px] text-slate-400 font-black">브랜드 확정 기한</label>
                <input
                  type="date"
                  value={confirmDue}
                  onChange={(e) => setConfirmDue(e.target.value)}
                  className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={publish}
                  disabled={busy}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                >
                  명단 넘기기
                </button>
                {open.listupConfirmDue && (
                  <button
                    onClick={async () => {
                      if (await act(open.id, 'clear_due')) {
                        setConfirmDue('');
                        onNotify('확정 기한을 없앴습니다.');
                      }
                    }}
                    disabled={busy}
                    className="text-[10px] text-slate-400 font-bold hover:text-slate-600"
                  >
                    기한 없애기
                  </button>
                )}
                <span className="text-[10px] font-medium text-slate-400 ml-auto">
                  {open.listupPublishedAt
                    ? '명단은 이미 브랜드에게 보입니다.'
                    : '넘기면 브랜드 화면에 명단이 뜹니다.'}
                </span>
              </div>
            )}
            <ListupWorkspace campaignId={open.id} onNotify={onNotify} />
          </div>
        )}

        {/* ---------------------------------------------------- 진행사항 */}
        {/* 브랜드가 보는 것과 같은 보드. 담당자용 진행 화면을 따로 두지 않는다 —
            브랜드와 담당자가 묻는 것이 같은 질문("지금 어느 단계에 누가 서 있나")이라,
            화면이 둘이면 브랜드가 "저기서 멈춰 있다"고 말하는 자리를 담당자가 자기
            화면에서 찾지 못한다.

            보드 맨 위에는 브랜드 담당자의 이름과 연락처가 붙는다(viewer='manager').
            브리프에서 답이 안 나오는 것(제품 수령 방법, 촬영 가능 날짜, 2차 활용
            범위)과 정산 입금은 결국 카톡·유선으로 풀어야 하는데, 그 번호를 찾으러
            운영자에게 물어보던 단계를 없앤다. */}
        {activeTab === 'progress' && (
          <BrandCollabProgress
            viewer="manager"
            campaignId={open.id}
            brandName={open.brandName || open.businessUsername}
            guidelineFiles={parseGuidelineFiles(open.guidelineFiles)}
            guidelineNote={open.guidelineNote || ''}
            guidelineUrl={open.guidelineUrl || ''}
            onNotify={onNotify}
          />
        )}

        {/* ---------------------------------------------------- 인사이트 */}
        {/* 브랜드와 같은 성과 화면을 같은 자리에서 본다. 브랜드가 "조회수가 왜 비어
            있냐"고 물을 때 담당자가 같은 문장을 읽고 있어야 답을 할 수 있다. */}
        {activeTab === 'insight' && (
          <CampaignInsightPanel
            viewer="manager"
            campaignId={open.id}
            budgetKrw={Number(open.budgetKrw || 0)}
            uploadedCount={uploadedCount}
            totalCollabs={campaignCollabs.length}
          />
        )}

        {/* -------------------------------------------------------- 검수 */}
        {activeTab === 'review' && (
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-100">
              <h4 className="text-sm font-black text-slate-900">
                진행 중인 협업 ({campaignCollabs.length})
              </h4>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                인플루언서가 제출한 대본과 영상을 여기서 바로 검수합니다.
              </p>
            </div>
            <div className="p-3 space-y-2 bg-slate-50/60">
              {campaignCollabs.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-bold text-center py-6">
                  아직 시작된 협업이 없습니다. 제안을 수락하면 이 자리에 생깁니다.
                </p>
              ) : (
                campaignCollabs.map((c) => {
                  const stage = STAGE_STATUS[c.currentStageStatus] || STAGE_STATUS.pending;
                  return (
                    <div key={c.id} className="bg-white rounded-xl border border-slate-100 p-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-[12px] font-black text-slate-900 truncate">
                            @{c.creatorUsername}
                          </p>
                          <p className="text-[11px] text-slate-400 font-bold truncate">
                            {c.currentStageTitle || '단계 없음'}
                            {c.dueDate ? ` · 마감 ${c.dueDate}` : ''}
                            {c.progress !== undefined ? ` · ${c.progress}%` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${stage.cls}`}>
                            {stage.label}
                          </span>
                          {c.openFeedbackCount > 0 && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-50 text-red-500">
                              브랜드 의견 {c.openFeedbackCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                        <button
                          onClick={() => setReviewTarget({ collabId: c.id, target: 'script' })}
                          className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                        >
                          대본 확인
                        </button>
                        <button
                          onClick={() => setReviewTarget({ collabId: c.id, target: 'content' })}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
                        >
                          영상 확인
                        </button>
                        {/* 기획안·영상 파일 주고받기. 검수실(대본·영상 확인)이 단계별
                            제출물을 다룬다면, 자료함은 단계에 매이지 않은 파일을 다룬다 —
                            브랜드 가이드, 초안 기획안, 참고 영상 같은 것들이다. */}
                        <button
                          onClick={() => toggleAssets(c.id)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black ${
                            assetsFor === c.id
                              ? 'bg-blue-600 text-white hover:bg-blue-500'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}
                        >
                          {assetsFor === c.id ? '자료함 접기' : '기획안·영상 공유'}
                        </button>
                        {c.uploadUrl && (
                          <a
                            href={c.uploadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-blue-600 font-black hover:underline ml-auto"
                          >
                            게시물 보기
                          </a>
                        )}
                      </div>

                      {assetsFor === c.id && (
                        <div className="mt-2.5">
                          {assetLoading || !assetDetail ? (
                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center">
                              <p className="text-[11px] text-slate-400 font-bold">자료함을 불러오는 중...</p>
                            </div>
                          ) : (
                            <CollabSharedWorkspace
                              collabId={c.id}
                              role="manager"
                              detail={assetDetail}
                              onRefresh={refreshAssets}
                              onNotify={onNotify}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 캠페인 목록 ───────────────────────────────────────────────────────────
  const list = visibleCampaigns;
  const counted = GROUPS.map((g) => ({
    ...g,
    rows: list.filter((c: any) => g.buckets.includes(bucketOf(c).key)),
  }));
  const totalShown = counted.reduce((sum, g) => sum + g.rows.length, 0);

  return (
    <div className="space-y-4 w-full max-w-[1560px] mx-auto">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-900">브랜드 캠페인</h3>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              지금 내 손이 필요한 캠페인이 맨 위에 옵니다. 카드를 누르면 명단·진행사항·인사이트·검수로 들어갑니다.
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {SCOPES.map((sc) => (
              <button
                key={sc.key}
                onClick={() => setScope(sc.key)}
                className={`px-3 py-2 rounded-lg text-[10px] font-black ${
                  scope === sc.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>

        {/* 검색. 캠페인이 쌓이면 목록을 눈으로 훑는 것이 가장 느린 방법이 된다. */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="캠페인 · 브랜드 · 카테고리 · 담당자 검색"
          className="mt-3 w-full text-[12px] font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
        />

        {/* 할 일 묶음. 숫자가 0 인 묶음은 그리지 않는다 — 빈 칸이 늘면 있는 일이 묻힌다. */}
        <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setBucketFilter('')}
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black ${
              bucketFilter ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-slate-900 text-white'
            }`}
          >
            전체 {scopeCampaigns.length}
          </button>
          {BUCKETS.filter((b) => (bucketCounts[b.key] || 0) > 0).map((b) => (
            <button
              key={b.key}
              onClick={() => setBucketFilter(bucketFilter === b.key ? '' : b.key)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black ${
                bucketFilter === b.key ? 'bg-slate-900 text-white' : `${b.cls} hover:opacity-80`
              }`}
            >
              {b.label} {bucketCounts[b.key]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">캠페인을 불러오는 중...</p>
        </div>
      ) : totalShown === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">
            {query || bucketFilter ? '조건에 맞는 캠페인이 없습니다.' : '진행할 캠페인이 없습니다.'}
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {query || bucketFilter
              ? '검색어를 지우거나 다른 묶음을 골라 보세요.'
              : scope === 'mine'
                ? '아직 맡은 캠페인이 없습니다. "담당자 없음"에서 하나 맡아 보세요.'
                : '운영자가 캠페인을 승인하면 이 자리에 올라옵니다.'}
          </p>
        </div>
      ) : (
        counted
          .filter((g) => g.rows.length > 0)
          .map((g) => {
            const limit = shown[g.key] || PAGE;
            return (
              <div key={g.key}>
                <div className="flex items-baseline gap-2 mb-2.5 px-0.5 flex-wrap">
                  <h4 className="text-[13px] font-black text-slate-900">
                    {g.label} <span className="text-slate-300">{g.rows.length}</span>
                  </h4>
                  {g.note && <p className="text-[10px] text-slate-400 font-medium">{g.note}</p>}
                </div>
                {/* 카드 격자. 브랜드 · 인플루언서 목록과 같은 열 수를 쓴다. 담당자가
                    캠페인을 알아보는 첫 단서는 제목이 아니라 제품 사진이다 — 브랜드와
                    통화하며 "그 파란 통 캠페인"을 찾는 일이 실제로 일어난다. */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 md:gap-3">
                  {g.rows.slice(0, limit).map((c: any) => {
                    const b = bucketOf(c);
                    const mine = c.managerUsername === managerUsername;
                    const chips = [
                      { label: '명단', value: c.counts?.listed || 0 },
                      { label: '선택', value: c.counts?.picked || 0 },
                      { label: '제안', value: c.counts?.sent || 0 },
                      { label: '지원', value: c.counts?.applications || 0 },
                      { label: '협업', value: c.counts?.collabs || 0 },
                    ].filter((x) => x.value > 0);
                    return (
                      <div
                        key={c.id}
                        onClick={() => openCampaign(c)}
                        className="bg-white rounded-xl border border-slate-100 hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer group overflow-hidden"
                      >
                        <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
                          {c.thumbnailUrl ? (
                            <img
                              src={c.thumbnailUrl}
                              alt={c.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-50">
                              <svg className="w-10 h-10 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                          <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between gap-1.5">
                            <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black shadow-sm ${b.cls}`}>
                              {b.label}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[11px] font-black shadow-sm truncate max-w-[52%] ${
                                !c.managerUsername
                                  ? 'bg-amber-500 text-white'
                                  : mine
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white/90 text-slate-500'
                              }`}
                            >
                              {!c.managerUsername ? '담당자 없음' : mine ? '내 담당' : `@${c.managerUsername}`}
                            </span>
                          </div>
                          {/* 할 일을 사진 위에 적는다. 카드 격자는 줄 목록보다 한 화면에
                              적게 들어가므로, 카드마다 "그래서 뭘 해야 하나"가 없으면
                              담당자는 결국 카드를 하나씩 열어 보게 된다. */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900/85 via-slate-900/40 to-transparent px-2.5 pt-7 pb-2">
                            <p className="text-[10px] font-black text-white line-clamp-2 leading-snug">
                              {b.todo}
                            </p>
                          </div>
                        </div>

                        <div className="p-2.5 md:p-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs text-slate-400 font-bold truncate">
                              {c.brandName || c.businessUsername}
                            </span>
                            {c.category && (
                              <>
                                <span className="text-slate-200">·</span>
                                <span className="text-xs text-slate-400 font-medium truncate">{c.category}</span>
                              </>
                            )}
                          </div>
                          <h3 className="font-black text-sm md:text-base text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1.5">
                            {c.title}
                          </h3>
                          {/* 숫자는 파이프라인 순서대로 둔다 — 명단 → 브랜드 선택 →
                              제안 → 지원 → 협업. 0 인 칸은 적지 않는다. */}
                          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                            {(c.counts?.review || 0) > 0 && (
                              <span className="text-[10px] font-black text-rose-500">
                                검수 {c.counts.review}
                              </span>
                            )}
                            {chips.map((x) => (
                              <span key={x.label} className="text-[10px] font-black text-slate-400">
                                {x.label} <span className="text-slate-700">{x.value}</span>
                              </span>
                            ))}
                            {chips.length === 0 && (c.counts?.review || 0) === 0 && (
                              <span className="text-[10px] font-bold text-slate-300">진행 기록 없음</span>
                            )}
                          </div>
                          {c.listupConfirmDue && (
                            <p className="text-[10px] font-black text-slate-400 mt-1">
                              브랜드 확정 기한 {String(c.listupConfirmDue).slice(0, 10)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {g.rows.length > limit && (
                  <button
                    onClick={() => setShown((prev) => ({ ...prev, [g.key]: limit + PAGE }))}
                    className="mt-2.5 w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-[11px] font-black text-slate-500 hover:bg-slate-50"
                  >
                    {g.rows.length - limit}건 더 보기
                  </button>
                )}
              </div>
            );
          })
      )}
    </div>
  );
};

export default ManagerCampaignsPanel;

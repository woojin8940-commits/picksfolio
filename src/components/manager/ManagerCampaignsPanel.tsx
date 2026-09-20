import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import {
  AD_OBJECTIVES,
  PRODUCT_PROVIDE,
  chosenTiers,
  contentFormatLabel,
  parseTierCounts,
  rewardModeOf,
} from '../../utils/campaignBrief';
import BrandCollabProgress from '../BrandCollabProgress';
import BrandContactCard from '../collab/BrandContactCard';
import { parseGuidelineFiles } from '../collab/CampaignGuidelineEditor';
import ListupWorkspace from '../collab/ListupWorkspace';
import CampaignInsightPanel from '../collab/CampaignInsightPanel';
import CollabReviewRoom from '../collab/CollabReviewRoom';
import CollabSharedWorkspace from '../collab/CollabSharedWorkspace';
import ManagerCampaignSettlementPanel from './ManagerCampaignSettlementPanel';
import ManagerCampaignInfluencers from './ManagerCampaignInfluencers';

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
 * 머리말의 '자세히 보기'에는 조건과 함께 브랜드 담당자의 성함 · 연락처 · 메일이
 * 붙는다. 조건을 확인하는 자리가 곧 그 조건을 물어볼 자리라서다.
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

/**
 * 진행 방식(캠페인 카테고리)별 거르기 — 제품 협찬 · 커머스 · 유가시딩.
 *
 * 담당자가 하는 일이 방식마다 다르다. 유가시딩(광고비 지급형)은 후보를 찾아 명단을
 * 올리고 단계를 굴리는 일이고, 제품 협찬과 커머스는 수락된 사람에게 연락해 조건을
 * 맞추는 일이다. 손과 머리를 쓰는 방식이 다르니 한 번에 한 종류만 보고 싶다는 요청이
 * 있었고, 실제로 목록을 섞어 두면 카드를 열기 전까지 어느 쪽 일인지 알 수 없다.
 *
 * 이름은 브랜드 등록 화면의 이름(REWARD_MODES 의 label)이 아니라 담당자와 브랜드가
 * 전화에서 쓰는 말로 적는다 — '커머스형'은 등록 화면의 이름이고, 통화에서는 '공동구매'
 * 라고 부른다.
 */
const MODE_FILTERS = [
  { key: 'barter', label: '제품 협찬' },
  { key: 'groupbuy', label: '커머스 (공동구매)' },
  { key: 'paid', label: '유가시딩' },
];

/** 카드·머리말에 적는 진행 방식 이름. 목록의 거르기 칩과 같은 말을 쓴다. */
const modeLabelOf = (rewardMode: unknown): string =>
  MODE_FILTERS.find((m) => m.key === rewardModeOf(String(rewardMode || '')).value)?.label ||
  rewardModeOf(String(rewardMode || '')).label;

/**
 * 규모별 인원 배분을 한 줄로 — "나노 3 · 마이크로 2".
 *
 * 브랜드는 등록서에서 규모별로 인원을 나눠 적는다(tier_counts). 담당자가 후보를 찾을
 * 때 "몇 명"보다 먼저 알아야 하는 것이 "어느 규모로 몇 명"이다.
 */
const tierCountsLabel = (raw: unknown): string => {
  const counts = parseTierCounts(raw);
  return chosenTiers(counts)
    .map((t) => `${t.label} ${counts[t.key]}`)
    .join(' · ');
};

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
  /** 고른 진행 방식. 비어 있으면 전부 보여 준다. */
  const [modeFilter, setModeFilter] = useState('');
  /** 묶음별로 지금 펼쳐 둔 줄 수. 캠페인이 수백 건이어도 첫 화면은 짧아야 한다. */
  const [shown, setShown] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDue, setConfirmDue] = useState('');
  /** 상세의 탭. 브랜드 · 인플루언서 화면과 같은 자리에 같은 이름으로 둔다. */
  const [detailTab, setDetailTab] = useState<
    'listup' | 'progress' | 'insight' | 'review' | 'settlement'
  >('listup');
  /**
   * 브리프를 펼쳤는지. 캠페인을 열면 펼친 상태로 시작한다.
   *
   * 예전에는 접어 두었다 — 담당자가 캠페인을 열 때 찾는 것은 조건이 아니라 할 일이고,
   * 조건은 처음 한 번 읽으면 된다고 봤다. 그런데 접혀 있던 시절의 브리프에는 단가와
   * 일정밖에 없었다. 지금은 브랜드가 등록서에 적어 낸 제품 소개 · 원하는 컨셉 ·
   * 필수 표기가 그대로 들어 있고, 이것들은 담당자가 인플루언서에게 캠페인을 설명할
   * 때마다 다시 읽는 글이다. 있는 줄 모르면 아무도 펼치지 않으므로 기본을 뒤집었다.
   * 다 읽은 담당자는 접어 두면 된다.
   */
  const [showBrief, setShowBrief] = useState(true);

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
    setShowBrief(true);
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
      // 진행 방식은 범위와 같은 층에서 좁힌다 — 묶음 숫자가 고른 방식의 숫자여야
      // "제품 협찬 중에 검수 대기가 몇 건"이 읽힌다.
      if (modeFilter && rewardModeOf(c.rewardMode).value !== modeFilter) return false;
      if (!q) return true;
      return [c.title, c.brandName, c.businessUsername, c.category, c.managerUsername]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [campaigns, scope, query, modeFilter]);

  /** 방식별 건수. 거르기 칩에 적는다(고른 방식과 무관하게 전체에서 센다). */
  const modeCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    campaigns.forEach((c: any) => {
      if (scope === 'unassigned' && c.managerUsername) return;
      const key = rewardModeOf(c.rewardMode).value;
      acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, [campaigns, scope]);

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
     * 아직 지급하지 않은 사람 수. 정산 탭에 적는다.
     *
     * 브랜드는 회차 하나를 한 번에 보내지만 인플루언서 지급은 사람 단위로 닫히므로,
     * 캠페인이 끝난 뒤에도 며칠씩 몇 명이 남는다. 탭 숫자가 없으면 담당자는 남은
     * 사람이 있는지 확인하려고 캠페인마다 정산 탭을 눌러 봐야 한다.
     */
    const unpaidCount = campaignCollabs.filter(
      (c: any) =>
        (c.status === 'in_progress' || c.status === 'completed') && !c.settlement?.paidAt,
    ).length;

    /**
     * 탭. 브랜드 화면과 같은 순서 · 같은 이름이고, 검수는 담당자에게만 있다.
     * 검수 탭에는 지금 나를 기다리는 제출물 수를 적는다. 목록의 "검수 대기" 묶음과
     * 같은 숫자라, 목록에서 눌러 들어온 담당자가 어디로 가야 하는지 바로 보인다.
     *
     * 정산이 맨 끝인 이유는 순서가 곧 일의 순서이기 때문이다 — 명단을 넘기고,
     * 진행을 보고, 성과를 확인하고, 검수를 마친 다음에야 지급이 열린다.
     */
    const mode = rewardModeOf(open.rewardMode);
    const TABS = [
      {
        key: 'listup' as const,
        label: '인플루언서',
        count: mode.openApply ? 0 : open.counts?.listed || 0,
      },
      ...(mode.hasWorkroom
        ? [
            { key: 'progress' as const, label: '진행사항', count: 0 },
            { key: 'insight' as const, label: '인사이트', count: 0 },
            { key: 'review' as const, label: '검수', count: reviewCount },
            { key: 'settlement' as const, label: '정산', count: unpaidCount },
          ]
        : []),
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
              {/* 이 캠페인을 올린 브랜드 담당자 — 성함 · 연락처 · 메일.
                  진행사항 탭에도 같은 칸이 붙지만, 조건을 확인하려고 머리말을 펼친
                  담당자가 "그럼 누구에게 물어보나"를 위해 탭을 옮겨 다니게 된다.
                  물어볼 사람은 물어볼 내용 옆에 있어야 한다.

                  펼쳤을 때만 붙이므로 연락처 조회도 그때 한 번 일어난다 — 개인정보를
                  열어 보지도 않은 캠페인까지 미리 내려받지 않는다(BrandContactCard). */}
              <BrandContactCard
                campaignId={open.id}
                businessUsername={open.businessUsername}
                brandName={open.brandName || open.businessUsername}
                className="border-slate-200"
              />

              {/* 제품 소개. 브랜드가 등록서 첫 칸에 적은 글이고, 담당자가
                  인플루언서에게 캠페인을 설명할 때 그대로 읽는 문장이다. */}
              {open.description && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-[11px] text-slate-400 font-black mb-1.5">제품 소개</p>
                  <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                    {open.description}
                  </p>
                </div>
              )}

              {/* 원하는 컨셉 · 필수 표기 · 2차 활용 안내 — 등록서의 긴 글 칸들.
                  칸 하나에 한 줄로 접어 넣으면 문장이 잘려 쓸 수 없으므로 폭을
                  다 쓰는 블록으로 그린다. */}
              {[
                { label: mode.hasContentFormat ? '원하는 컨셉' : '콘텐츠 컨셉', value: open.videoConcept },
                { label: '필수 표기 · 가이드', value: open.requirements },
                { label: '2차 활용 안내', value: open.secondUseNote },
                { label: '타겟 · 원하는 인플루언서', value: open.targetAudience },
              ]
                .filter((b) => String(b.value || '').trim())
                .map((b) => (
                  <div key={b.label} className="bg-slate-50 rounded-xl p-4">
                    <p className="text-[11px] text-slate-400 font-black mb-1.5">{b.label}</p>
                    <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                      {b.value}
                    </p>
                  </div>
                ))}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {briefTile('진행 방식', modeLabelOf(open.rewardMode), mode.tagline)}
                {briefTile(
                  mode.value === 'paid' ? '1인 단가' : '단가',
                  open.rewardAmount ? formatKoreanWon(open.rewardAmount) : mode.value === 'paid' ? '미정' : '',
                )}
                {/* 커머스형은 단가 대신 판매 수수료로 정산한다. */}
                {briefTile(
                  '판매 수수료',
                  open.groupbuyCommissionRate > 0 ? `${open.groupbuyCommissionRate}%` : '',
                )}
                {briefTile('2차 활용', open.secondUseFee > 0 ? formatKoreanWon(open.secondUseFee) : '')}
                {/* 모집기간. 지원을 받는 방식에서는 이 기간이 지나면 지원이 닫히므로
                    담당자가 브랜드에 "연장할까요"를 물어야 하는 값이다. */}
                {mode.openApply &&
                  briefTile(
                    '모집기간',
                    open.startDate
                      ? `${String(open.startDate).slice(0, 10)}${open.endDate ? ` ~ ${String(open.endDate).slice(0, 10)}` : ''}`
                      : '',
                    '마감일까지 지원할 수 있습니다',
                  )}
                {briefTile(
                  mode.headcountLabel,
                  open.maxApplicants > 0
                    ? `${open.maxApplicants}명`
                    : open.seedingCount > 0
                      ? `${open.seedingCount}명`
                      : '',
                )}
                {briefTile('업로드 채널', open.uploadChannel || '')}
                {briefTile(
                  '콘텐츠 형식',
                  mode.hasContentFormat
                    ? open.contentFormat
                      ? contentFormatLabel(open.contentFormat)
                      : ''
                    : '자유 (인플루언서 선택)',
                )}
                {briefTile(
                  '희망 게시일',
                  open.uploadFrom ? `${open.uploadFrom}${open.uploadTo ? ` ~ ${open.uploadTo}` : ''}` : '',
                )}
                {briefTile('제품', open.productName || '')}
                {briefTile(
                  '제품 제공',
                  PRODUCT_PROVIDE.find((x) => x.value === open.productProvide)?.label || '',
                )}
                {briefTile(
                  '광고 목적',
                  AD_OBJECTIVES.find((x) => x.value === open.adObjective)?.label || '',
                )}
                {briefTile('SNS 카테고리', open.snsCategory || '')}
                {briefTile('희망 성별', open.influencerGender || '')}
                {briefTile('희망 연령', open.influencerAges || '')}
                {briefTile('희망 스타일', open.influencerStyles || '')}
                {briefTile('제외 키워드', open.excludeKeywords || '')}
                {/* 규모별 인원 배분. 브랜드가 직접 정하는 방식(광고비 지급형)에만 있고,
                    담당자가 후보를 몇 명씩 찾아야 하는지가 여기서 나온다. */}
                {briefTile('희망 인플루언서', tierCountsLabel(open.tierCounts))}
                {briefTile(
                  '브랜드 확정 기한',
                  open.listupConfirmDue ? String(open.listupConfirmDue).slice(0, 10) : '',
                )}
              </div>
              {/* 제품 페이지. 담당자가 인플루언서에게 보낼 링크라 눌러 열 수 있어야 한다. */}
              {open.productUrl && (
                <a
                  href={open.productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-black text-blue-600 hover:underline break-all"
                >
                  제품 페이지 열기 ↗
                </a>
              )}
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
            {/* 지원자 · 수락한 명단. 지원을 받는 방식(제품 협찬 · 커머스)에만 있다.
                담당자가 수락된 사람에게 먼저 연락해야 진행이 시작되는 방식이라,
                연락처는 이 목록 안에서 바로 열린다. */}
            {mode.openApply && (
              <ManagerCampaignInfluencers
                campaignId={open.id}
                isBarter={mode.value === 'barter'}
                onNotify={onNotify}
              />
            )}
            {/* 담당자가 후보를 찾아 올리는 명단. 제품 협찬형에는 없다. */}
            {open.managerListup !== false && <ListupWorkspace campaignId={open.id} onNotify={onNotify} />}
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

        {/* -------------------------------------------------------- 정산 */}
        {/* 브랜드 입금을 확인하고 사람별 지급을 닫는 자리. 순서가 곧 돈의 순서다 —
            브랜드가 픽스폴리오에 보낸 일괄 정산금이 확인되기 전에는 사람별 지급이
            잠긴다. 같은 지급 동작이 진행사항 보드의 정산 단계에도 있지만, 거기서는
            한 명을 열어야 한 명이 보인다. 목록으로 두면 "누구에게 아직 안 보냈는지"가
            한 화면에 남는다. */}
        {activeTab === 'settlement' && (
          <ManagerCampaignSettlementPanel
            campaignId={open.id}
            collabs={campaignCollabs}
            onNotify={onNotify}
            onChanged={loadCollabs}
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
              지금 내 손이 필요한 캠페인이 맨 위에 옵니다. 카드를 누르면 브랜드가 적어 낸 조건과 인플루언서 명단으로 들어갑니다.
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

        {/* 캠페인 카테고리(진행 방식). 할 일 묶음보다 위에 둔다 — 방식을 먼저
            좁히면 아래 묶음 숫자가 그 방식 안에서의 숫자가 된다. */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setModeFilter('')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black ${
              modeFilter ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-blue-600 text-white'
            }`}
          >
            전체
          </button>
          {MODE_FILTERS.map((m) => (
            <button
              key={m.key}
              onClick={() => setModeFilter(modeFilter === m.key ? '' : m.key)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black ${
                modeFilter === m.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {m.label} {modeCounts[m.key] || 0}
            </button>
          ))}
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
            {query || bucketFilter || modeFilter
              ? '조건에 맞는 캠페인이 없습니다.'
              : '진행할 캠페인이 없습니다.'}
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {query || bucketFilter || modeFilter
              ? '검색어를 지우거나 다른 카테고리 · 묶음을 골라 보세요.'
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
                          {/* 진행 방식. 카테고리를 전체로 놓고 볼 때도 카드만 보고
                              어느 쪽 일인지 알 수 있어야 한다. */}
                          <span className="inline-block px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-black text-slate-500 mb-1">
                            {modeLabelOf(c.rewardMode)}
                          </span>
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

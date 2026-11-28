import React from 'react';

export type BrandQuota = {
  tier: 'brand_campaign' | 'brand_growth' | null;
  enforced: boolean;
  pastDue: boolean;
  remaining: { campaigns: number; selected: number };
  total: { campaigns: number; selected: number };
  used: { campaigns: number; selected: number };
  cycleEnd: string;
  /** 다른 캠페인에서 골라 두고 아직 진행 확정 전인 인원. */
  pendingPicksElsewhere?: number;
  /** 이 캠페인에서 이미 선정 한도에 잡힌 후보 id. */
  countedIds?: string[];
};

/**
 * 지금 고른 인원이 남은 선정 한도를 넘는지. 선택은 한도를 쓰지 않지만(차감은 진행 확정 때),
 * 고른 사람이 모두 수락하면 한도를 넘는 인원은 확정할 수 없다 — 그걸 고르는 자리에서 미리 알린다.
 * 이미 한도에 잡힌 후보는 다시 세지 않는다.
 */
export const selectionOverQuota = (quota: BrandQuota | null | undefined, selectedIds: Iterable<string>) => {
  if (!quota || !quota.enforced || !quota.tier || quota.pastDue) return null;
  const counted = new Set(quota.countedIds || []);
  let fresh = 0;
  for (const id of selectedIds) if (!counted.has(id)) fresh += 1;
  const elsewhere = Math.max(0, Number(quota.pendingPicksElsewhere || 0));
  const over = fresh + elsewhere - quota.remaining.selected;
  return over > 0 ? { over, fresh, elsewhere, remaining: quota.remaining.selected } : null;
};

const TIER_NAME = { brand_campaign: '라이트', brand_growth: '그로스' } as const;

/**
 * 브랜드의 이번 달 멤버십 한도 한 줄. 담당자는 인플루언서와 이야기하기 전에 남은 선정 인원을
 * 보고, 브랜드는 진행이 왜 멈췄는지(한도 · 미납 · 미구독)를 본다.
 */
const BrandQuotaBanner: React.FC<{ quota?: BrandQuota | null; viewer: 'manager' | 'brand'; onOpenMembership?: () => void }> = ({
  quota, viewer, onOpenMembership,
}) => {
  if (!quota) return null;
  const blocked = quota.enforced && (!quota.tier || quota.pastDue || quota.remaining.selected <= 0);
  const tone = blocked ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600';
  let text: string;
  if (!quota.tier) {
    text = viewer === 'manager'
      ? '이 브랜드는 멤버십을 구독하지 않았어요. 구독 전에는 리스트업과 진행 확정이 막힙니다.'
      : '멤버십을 구독하면 담당자가 리스트업과 진행 확정을 이어 갈 수 있어요.';
  } else if (quota.pastDue) {
    text = viewer === 'manager'
      ? '이 브랜드는 정기결제가 실패한 상태예요. 결제가 다시 될 때까지 리스트업과 진행 확정이 막힙니다.'
      : '멤버십 정기결제가 실패했어요. 결제 수단을 확인해 주세요. 그동안 새 리스트업과 진행 확정이 멈춥니다.';
  } else {
    text = `${TIER_NAME[quota.tier]} · 이번 달 남은 한도: 캠페인 ${quota.remaining.campaigns}/${quota.total.campaigns}건 · 선정 인플루언서 ${quota.remaining.selected}/${quota.total.selected}명`;
  }
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-[11px] font-bold flex items-center justify-between gap-2 flex-wrap ${tone}`}>
      <span>{text}</span>
      {viewer === 'brand' && onOpenMembership && (blocked || quota.remaining.campaigns <= 0) && (
        <button type="button" onClick={onOpenMembership} className="px-2.5 py-1 rounded-lg bg-white border border-current text-[11px] font-black">
          멤버십 보기
        </button>
      )}
    </div>
  );
};

export default BrandQuotaBanner;

import React from 'react';
import { formatKoreanWon } from '../../utils/formatters';

/**
 * 캠페인 인사이트.
 *
 * 아직 집계하지 않는다. 조회수·좋아요·저장·도달·팔로워 구성은 인플루언서가 스스로
 * 적어 넣을 값이 아니라 플랫폼에서 받아와야 하는 값이고(자기 신고 수치는 광고비
 * 정산 근거가 되지 못한다), 그 연결은 Meta 그래프 API 승인 이후에 붙는다.
 * creator_channels.metrics_source 가 'self' / 'meta_api' 를 구분해 두는 이유도 같다.
 *
 * 그때까지 이 화면을 감추지 않는 이유는, 브랜드가 "이 캠페인이 끝나면 무엇을 볼 수
 * 있는지"를 미리 알아야 하기 때문이다. 숫자를 추정해서 채우지는 않는다 — 집계 전임을
 * 그대로 적고 자리를 비워 둔다. 추정치를 한 번 보여 주면 나중에 실제 수치가 들어올 때
 * 브랜드는 둘 중 무엇이 맞는지 알 수 없다.
 */

interface CampaignInsightPanelProps {
  /** 이 캠페인의 총 집행 예산(원). CPV 를 계산할 분모로 쓸 값이다. */
  budgetKrw: number;
  /** 업로드가 확인된 협업 수. 0이면 아직 집계할 게시물 자체가 없다. */
  uploadedCount: number;
  /** 진행 중인 협업 수. */
  totalCollabs: number;
  /**
   * 누가 보는 화면인지. 칸의 뜻이 보는 쪽에 따라 달라진다 — 브랜드는 캠페인 전체의
   * 합계와 CPV 를 보고, 인플루언서는 자기 게시물 하나의 성과를 본다. 같은 자리에
   * 같은 말을 쓰면 인플루언서는 남의 캠페인 예산을 자기 성과로 읽게 된다.
   */
  viewer?: 'brand' | 'influencer';
}

const METRICS_BRAND = [
  { label: '전체 조회수', unit: '회', hint: '업로드된 게시물의 조회수 합' },
  { label: '전체 CPV', unit: '원', hint: '집행 예산 ÷ 전체 조회수' },
  { label: '좋아요 · 댓글', unit: '건', hint: '반응 수 합계' },
  { label: '저장 · 공유', unit: '건', hint: '저장과 공유 수 합계' },
];

const METRICS_CREATOR = [
  { label: '조회수', unit: '회', hint: '이 캠페인 게시물의 조회수' },
  { label: '도달', unit: '명', hint: '게시물을 본 계정 수' },
  { label: '좋아요 · 댓글', unit: '건', hint: '반응 수 합계' },
  { label: '저장 · 공유', unit: '건', hint: '저장과 공유 수 합계' },
];

/** 성별·연령 비중 자리. 실제 비율이 들어올 칸을 그대로 비워 둔다. */
const AGE_ROWS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'];

const CampaignInsightPanel: React.FC<CampaignInsightPanelProps> = ({
  budgetKrw,
  uploadedCount,
  totalCollabs,
  viewer = 'brand',
}) => {
  const isCreator = viewer === 'influencer';
  const metrics = isCreator ? METRICS_CREATOR : METRICS_BRAND;
  const headline = isCreator
    ? uploadedCount > 0
      ? '게시물 지표는 채널을 연동하면 이 화면에 쌓입니다.'
      : '업로드를 마치면 이 캠페인의 성과가 이곳에 쌓입니다.'
    : uploadedCount > 0
      ? `업로드가 확인된 게시물이 ${uploadedCount}건 있습니다. 게시물 지표는 인플루언서 채널이 연동된 뒤부터 이 화면에 쌓입니다.`
      : totalCollabs > 0
        ? '아직 업로드가 확인된 게시물이 없습니다. 업로드가 끝나면 지표가 이 화면에 쌓입니다.'
        : '인플루언서가 확정되고 업로드가 끝나면 지표가 이 화면에 쌓입니다.';

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
        <p className="text-sm font-black text-blue-800">
          {isCreator ? '업로드 이후에 인사이트가 집계됩니다' : '광고 업로드 이후에 인사이트가 집계됩니다'}
        </p>
        <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">{headline}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-[10px] font-black text-slate-400">{m.label}</p>
            <p className="text-lg font-black text-slate-300 mt-1.5">
              —<span className="text-[11px] font-bold ml-0.5">{m.unit}</span>
            </p>
            <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">
              집계 전
            </span>
            <p className="text-[10px] text-slate-400 font-medium mt-2 leading-tight">{m.hint}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-slate-900">일자별 도달 추이</p>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">집계 전</span>
        </div>
        {/* 빈 차트. 축만 그려 두고 값은 넣지 않는다. */}
        <div className="mt-4 h-40 relative">
          <div className="absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3].map(i => (
              <span key={i} className="h-px w-full bg-slate-100" />
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[11px] text-slate-300 font-black">업로드 후 일자별 도달이 표시됩니다</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-900">팔로워 성별 비중</p>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">집계 전</span>
          </div>
          <div className="mt-4 space-y-3">
            {['여성', '남성'].map(g => (
              <div key={g}>
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className="text-slate-500">{g}</span>
                  <span className="text-slate-300">—%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 mt-1" />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-900">팔로워 연령 비중</p>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">집계 전</span>
          </div>
          <div className="mt-4 space-y-2">
            {AGE_ROWS.map(a => (
              <div key={a} className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 w-10 flex-shrink-0">{a}</span>
                <span className="flex-1 h-2 rounded-full bg-slate-100" />
                <span className="text-[10px] font-bold text-slate-300 w-8 text-right flex-shrink-0">—%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        인사이트는 {isCreator ? '내 채널을' : '인플루언서 채널을'} Meta·YouTube 등 플랫폼에 연동해 받아옵니다.
        {isCreator
          ? ' 직접 적어 낸 수치는 정산 근거로 쓰지 않기 때문에, 연동 전에는 위 칸이 비어 있습니다.'
          : ' 인플루언서가 직접 적은 수치는 근거로 쓰지 않기 때문에, 연동 전에는 위 칸이 비어 있습니다.'}
        {!isCreator && budgetKrw > 0 && ` 이 캠페인의 집행 예산은 ${formatKoreanWon(budgetKrw)}이며, 조회수가 들어오면 CPV가 자동으로 계산됩니다.`}
      </p>
    </div>
  );
};

export default CampaignInsightPanel;

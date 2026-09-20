import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatCountKo } from '../../utils/formatters';
import { ContactPanel, metricsFrom } from '../collab/InfluencerCandidateCard';

/**
 * 담당자가 보는 '선정된 인플루언서' 목록 — 그리고 그 사람의 연락처.
 *
 * 제품 협찬형과 커머스형은 수락한 뒤의 일이 화면 안에서 굴러가지 않는다. 담당자가
 * 브랜드와 인플루언서 양쪽에 직접 연락해 조건과 일정을 정리한다. 그래서 담당자가
 * 캠페인을 열고 가장 먼저 찾는 것은 단계 보드가 아니라 "누가 선정됐고 어디로
 * 연락하나"다. 예전에는 그 두 가지가 서로 다른 화면에 있었다 — 선정 여부는 브랜드의
 * 지원자 목록에, 번호는 등록서에. 담당자는 캠페인 하나마다 화면을 두 번 옮겨
 * 다니며 사람마다 번호를 찾아 적었다.
 *
 * 연락처를 줄마다 펼쳐 두지 않고 눌러야 나오게 한 이유는 두 가지다. 목록에서 먼저
 * 하는 일은 사람을 알아보는 것이고(계정 · 팔로워), 번호는 그 다음에 쓰는 값이다.
 * 그리고 이 값은 개인정보다 — 화면을 공유하거나 브랜드와 통화하며 화면을 띄워 둘 때
 * 명단 전체의 번호가 펼쳐져 있을 이유가 없다.
 *
 * 연락처는 담당자 응답에만 실려 온다(api-campaign-applicants 의 contact_card).
 */

type Row = Record<string, any>;

interface Props {
  campaignId: string;
  /** 제품 협찬형인지. 수락 뒤 연락을 브랜드가 하는 방식이라 안내 문장이 다르다. */
  isBarter: boolean;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  accepted: { label: '수락', cls: 'bg-emerald-50 text-emerald-600' },
  pending: { label: '검토 대기', cls: 'bg-slate-100 text-slate-500' },
  rejected: { label: '거절', cls: 'bg-slate-100 text-slate-400' },
};

/** 인스타 프로필 주소. 지원서에 적어 낸 링크가 있으면 그것이 먼저다. */
const instagramLinkOf = (row: Row): string => {
  const written = String(row.instagram_url || '').trim();
  if (written) return written;
  const handle = String(row.insights?.instagramHandle || '').trim().replace(/^@/, '');
  return handle ? `https://www.instagram.com/${handle}/` : '';
};

const ManagerCampaignInfluencers: React.FC<Props> = ({ campaignId, isBarter, onNotify }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  /** 지금 연락처를 펼쳐 둔 사람. 한 번에 한 명만 펼친다. */
  const [openUser, setOpenUser] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getCampaignApplicants(campaignId, undefined, 'manager');
    setLoading(false);
    if (res?.error) {
      onNotify(res.error, 'error');
      return;
    }
    setRows(Array.isArray(res?.applicants) ? res.applicants : []);
  }, [campaignId, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 수락한 사람이 위, 아직 검토 중인 사람이 아래다. 거절한 사람은 목록에서 뺀다 —
   * 담당자가 이 화면에서 하는 일은 진행할 사람에게 연락하는 것이다.
   */
  const { accepted, pending } = useMemo(() => {
    const byStatus = (status: string) =>
      rows.filter((r) => String(r.status || 'pending') === status);
    return { accepted: byStatus('accepted'), pending: byStatus('pending') };
  }, [rows]);

  const renderRow = (row: Row) => {
    const username = String(row.applicant_username || '');
    // 지표는 insights 안에 온다(서버가 붙인 채널 지표). 브랜드 화면의 지원자
    // 카드와 같은 방식으로 펴서 넘긴다.
    const m = metricsFrom({ ...(row.insights || {}), username });
    const status = STATUS_PILL[String(row.status || 'pending')] || STATUS_PILL.pending;
    const on = openUser === username;
    const igLink = instagramLinkOf(row);
    // 지원서에 적어 낸 연락처는 contact_card 에도 같은 값으로 들어온다
    // (source '이 캠페인 지원서'). 여기서 다시 적지 않는다.
    const canOpen = String(row.status || '') === 'accepted';

    return (
      <div key={row.id || username} className="bg-white rounded-xl border border-slate-100">
        <button
          type="button"
          onClick={() => setOpenUser(on ? '' : username)}
          disabled={!canOpen}
          className={`w-full text-left px-3 py-2.5 ${canOpen ? 'hover:bg-slate-50' : 'cursor-default'}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-black text-slate-900 truncate">
              @{m.instagramHandle || username}
            </span>
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black flex-shrink-0 ${status.cls}`}>
              {status.label}
            </span>
            {String(row.source || 'apply') === 'listup' && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-indigo-50 text-indigo-600 flex-shrink-0">
                명단 제안
              </span>
            )}
            {canOpen && (
              <span className="ml-auto text-[10px] font-black text-blue-600 flex-shrink-0">
                {on ? '연락처 닫기 ▲' : '연락처 보기 ▼'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-x-2.5 gap-y-0.5 flex-wrap mt-1">
            {m.categories && (
              <span className="text-[10px] font-bold text-slate-400 truncate max-w-[9rem]">
                {m.categories}
              </span>
            )}
            <span className="text-[10px] font-black text-slate-400">
              팔로워 <span className="text-slate-700">{formatCountKo(m.followers || 0)}</span>
            </span>
            {(m.avgViews || 0) > 0 && (
              <span className="text-[10px] font-black text-slate-400">
                평균 조회수 <span className="text-slate-700">{formatCountKo(m.avgViews || 0)}</span>
              </span>
            )}
          </div>
        </button>

        {on && (
          <div className="px-3 pb-3 space-y-2">
            <ContactPanel contact={row.contact_card} fallbackName={m.name} />
            {/* 인스타 프로필. 카톡·전화가 닿지 않을 때 담당자가 마지막으로 쓰는 길이고,
                계정을 눈으로 확인하는 자리이기도 하다. */}
            {igLink ? (
              <a
                href={igLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2.5 hover:border-slate-300"
              >
                <svg
                  className="w-3.5 h-3.5 text-pink-500 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
                <span className="text-xs text-slate-800 font-bold break-all">{igLink}</span>
                <span className="ml-auto text-[10px] text-slate-400 font-bold flex-shrink-0">인스타 프로필</span>
              </a>
            ) : (
              <p className="text-[11px] text-slate-400 font-medium">
                인스타 프로필 링크가 없습니다. 계정(@{m.instagramHandle || username})으로 직접 찾아 주세요.
              </p>
            )}
            {/* 지원할 때 적어 낸 말. 연락하기 전에 읽어야 하는 내용이다. */}
            {String(row.message || '').trim() && (
              <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-slate-400 font-black">지원 메시지</p>
                <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap mt-0.5">
                  {row.message}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-black text-slate-900">선정된 인플루언서 ({accepted.length})</h4>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5 break-keep">
            {isBarter
              ? '브랜드가 수락한 인플루언서입니다. 제품 발송과 일정은 브랜드가 직접 연락해 진행하고, 담당자는 막힌 곳만 돕습니다.'
              : '브랜드가 수락한 인플루언서입니다. 수락한 분을 눌러 연락처를 확인하고 조건과 일정을 정리해 주세요.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-2.5 py-1.5 rounded-lg text-[10px] font-black bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40 flex-shrink-0"
        >
          새로 읽기
        </button>
      </div>

      <div className="p-3 space-y-2 bg-slate-50/60">
        {loading ? (
          <p className="text-[11px] text-slate-400 font-bold text-center py-6">지원자를 불러오는 중...</p>
        ) : accepted.length === 0 && pending.length === 0 ? (
          <p className="text-[11px] text-slate-400 font-bold text-center py-6">
            아직 지원자가 없습니다. 모집 마감일까지 캠페인 협업 목록에 노출됩니다.
          </p>
        ) : (
          <>
            {accepted.map(renderRow)}
            {accepted.length === 0 && (
              <p className="text-[11px] text-slate-400 font-bold text-center py-4">
                아직 브랜드가 수락한 인플루언서가 없습니다.
              </p>
            )}
            {pending.length > 0 && (
              <>
                {/* 검토 대기는 참고로만 둔다. 수락은 브랜드가 하고, 연락처는 수락된
                    사람만 펼쳐진다 — 아직 결정되지 않은 사람에게 담당자가 먼저
                    연락하면 브랜드의 선택을 앞질러 버린다. */}
                <p className="text-[10px] font-black text-slate-400 pt-2 px-0.5">
                  브랜드 검토 대기 {pending.length}명
                </p>
                {pending.map(renderRow)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ManagerCampaignInfluencers;

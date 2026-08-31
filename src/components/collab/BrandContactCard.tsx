import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatPhone } from '../../utils/formatters';

/**
 * 캠페인 담당자의 연락처 — 픽스폴리오 담당자만 보는 칸.
 *
 * 담당자는 조건을 확정하거나 일정을 조정할 때 브랜드에게 직접 물어봐야 하는데,
 * 그 연락처가 화면 어디에도 없어서 운영자에게 계정을 물어보거나 앱 안 대화만
 * 기다려야 했다.
 *
 * 값은 캠페인 등록에서 받은 담당자를 먼저 쓴다. 계정 가입 정보는 그 칸이 비어 있는
 * 옛 캠페인의 폴백이다 — 계정 하나에 담당자가 여러 명인 경우(대행사, 담당 교체)
 * 가입자에게 전화하면 이 캠페인을 모르는 사람이 받는다. 어느 쪽 값인지 배지로
 * 밝혀 두는 것도 그래서다.
 *
 * 연락처는 캠페인을 펼쳤을 때 그 한 건만 따로 불러온다. 목록에 미리 담으면 열어
 * 보지도 않은 브랜드 수백 곳의 개인정보가 함께 내려온다.
 *
 * 전화번호와 이메일은 눌러서 바로 걸고 보낼 수 있게 두고, 복사 버튼을 따로 붙인다 —
 * 담당자는 데스크톱에서 일하는 경우가 많아 `tel:` 이 아무 일도 하지 않는다.
 */

interface BrandContactCardProps {
  /** 우선 이 값으로 조회한다. 캠페인 id 가 있으면 브랜드를 서버가 되짚는다. */
  campaignId?: string;
  /** 캠페인 id 가 없는 자리(협업 상세)에서 쓴다. */
  businessUsername?: string;
  /** 캠페인 행에 적힌 브랜드명. 연락처를 못 찾았을 때 최소한 이것만이라도 보여 준다. */
  brandName?: string;
  /**
   * 운영 콘솔(Netlify Identity)에서 쓰는 토큰. 담당자 대시보드는 Supabase 세션이
   * 자동으로 붙지만, 운영 콘솔은 이 값을 실어 주지 않으면 권한 확인에서 막힌다.
   */
  token?: string;
  className?: string;
}

const BrandContactCard: React.FC<BrandContactCardProps> = ({
  campaignId,
  businessUsername,
  brandName,
  token,
  className = '',
}) => {
  const [contact, setContact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  /**
   * 출처 배지. 담당자가 "이 번호가 이 캠페인 담당자인지"를 판단할 수 있어야 한다 —
   * 계정 · 제안서에서 온 값은 이 캠페인을 맡은 사람이 아닐 수 있다.
   */
  const sourceBadge: Record<string, { label: string; tone: string }> = {
    campaign: { label: '캠페인 등록 정보', tone: 'text-emerald-600' },
    account: { label: '계정 가입 정보', tone: 'text-slate-400' },
    proposal: { label: '제안서 기재 연락처', tone: 'text-amber-600' },
  };
  const badge = sourceBadge[String(contact?.source || '')];

  useEffect(() => {
    if (!campaignId && !businessUsername) return;
    let alive = true;
    setLoading(true);
    setError('');
    apiService
      .getBrandContact({ campaignId, businessUsername, token })
      .then(res => {
        if (!alive) return;
        if (res.error) setError(res.error);
        else setContact(res.contact || null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [campaignId, businessUsername, token]);

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  };

  const phone = contact?.contactPhone || '';
  const email = contact?.contactEmail || '';
  const person = contact?.contactPerson || '';
  const company = contact?.companyName || contact?.brandName || brandName || '';
  const nothing = !loading && !error && !person && !phone && !email;

  return (
    <div className={`bg-white rounded-xl border border-slate-100 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] text-slate-400 font-black uppercase">캠페인 담당자 연락처</p>
        {badge && <span className={`text-[9px] font-black ${badge.tone}`}>{badge.label}</span>}
      </div>

      {loading ? (
        <p className="text-xs text-slate-400 font-medium">불러오는 중...</p>
      ) : error ? (
        <p className="text-xs text-red-500 font-bold">{error}</p>
      ) : nothing ? (
        <p className="text-xs text-slate-400 font-medium">
          {company ? `${company} · ` : ''}등록된 연락처가 없습니다. 앱 안 대화로 연락해 주세요.
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm font-black text-slate-900">
            {person || '담당자명 미등록'}
            {company && <span className="text-[11px] text-slate-400 font-bold ml-1.5">{company}</span>}
          </p>

          {phone && (
            <div className="flex items-center justify-between gap-3">
              <a href={`tel:${phone}`} className="text-xs font-bold text-blue-600 hover:underline">
                {formatPhone(phone)}
              </a>
              <button
                onClick={() => copy('phone', phone)}
                className="text-[10px] font-black text-slate-400 hover:text-slate-600 flex-shrink-0"
              >
                {copied === 'phone' ? '복사됨' : '복사'}
              </button>
            </div>
          )}

          {email && (
            <div className="flex items-center justify-between gap-3">
              <a
                href={`mailto:${email}`}
                className="text-xs font-bold text-blue-600 hover:underline break-all"
              >
                {email}
              </a>
              <button
                onClick={() => copy('email', email)}
                className="text-[10px] font-black text-slate-400 hover:text-slate-600 flex-shrink-0"
              >
                {copied === 'email' ? '복사됨' : '복사'}
              </button>
            </div>
          )}

          {contact?.businessUsername && (
            <p className="text-[10px] text-slate-400 font-bold">계정 @{contact.businessUsername}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default BrandContactCard;

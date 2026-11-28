import React, { useState } from 'react';
import { formatPhone } from '../../utils/formatters';

export type SharedContact = {
  name: string;
  entries: { kind: 'phone' | 'email' | 'kakao' | 'text'; value: string }[];
};

/**
 * 진행이 확정되어 브랜드에 공개된 인플루언서 연락처.
 *
 * 브랜드가 명단에서 고르고 담당자가 인플루언서와 이야기를 마치면(협업 시작) 서버가
 * 이름 · 연락처를 싣는다. 그 뒤 진행 · 대가 지급은 브랜드와 인플루언서가 직접 하므로
 * 전화 · 문자 · 카카오톡을 바로 쓸 수 있게 둔다.
 */
const SharedContactCard: React.FC<{ contact: SharedContact | null | undefined; compact?: boolean }> = ({ contact, compact }) => {
  const [copied, setCopied] = useState('');
  if (!contact || (!contact.name && contact.entries.length === 0)) return null;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  };
  return (
    <div className={`rounded-xl border border-emerald-200 bg-emerald-50/70 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
      <p className="text-[11px] font-black text-emerald-700">
        연락처 공개{contact.name ? ` · ${contact.name}` : ''}
      </p>
      {contact.entries.length === 0 ? (
        <p className="text-[11px] text-emerald-700/80 font-bold mt-1">등록된 연락처가 없어요. 담당자에게 문의해 주세요.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {contact.entries.map((e) => (
            <li key={`${e.kind}:${e.value}`} className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-black text-emerald-600 w-12 flex-shrink-0">
                {e.kind === 'phone' ? '휴대폰' : e.kind === 'kakao' ? '카카오톡' : e.kind === 'email' ? '이메일' : '연락처'}
              </span>
              {e.kind === 'phone' ? (
                <a href={`tel:${e.value.replace(/[^\d+]/g, '')}`} className="text-[12px] font-black text-slate-900 hover:underline">
                  {formatPhone(e.value) || e.value}
                </a>
              ) : e.kind === 'email' ? (
                <a href={`mailto:${e.value}`} className="text-[12px] font-black text-slate-900 hover:underline break-all">
                  {e.value}
                </a>
              ) : (
                <span className="text-[12px] font-black text-slate-900 break-all">{e.value}</span>
              )}
              <button
                type="button"
                onClick={() => copy(e.value)}
                className="px-2 py-0.5 rounded-md border border-emerald-200 bg-white text-[10px] font-black text-emerald-700 hover:bg-emerald-100"
              >
                {copied === e.value ? '복사했어요' : '복사'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <p className="text-[10px] text-emerald-700/70 font-bold mt-1.5">
          이 연락처는 이 캠페인 진행 목적으로만 써 주세요. 이후 진행과 광고비 지급은 인플루언서와 직접 하시면 됩니다.
        </p>
      )}
    </div>
  );
};

export default SharedContactCard;

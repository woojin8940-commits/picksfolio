import React from 'react';
import { AlertCircle, Link2, Trash2 } from 'lucide-react';
import type { DmMessageButton } from '../services/apiService';

/**
 * 링크 버튼 목록 편집기(최대 3개) — 첫 인사말처럼 DM 자동화 카드 여러 곳에서 쓴다.
 *
 * 주소 규칙은 서버 `_shared/instagram-dm.mts` 의 normalizeLinkUrl 과 맞춘다
 * (http/https 절대 주소만, `example.com/abc` 처럼 스킴만 빠진 입력은 https 로 살린다).
 */

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const cleanLinkInput = (raw: string): string => (raw || '')
  .replace(/[​-‍⁠﻿]/g, '')
  .replace(/[：]/g, ':')
  .replace(/[／]/g, '/')
  .replace(/[．]/g, '.')
  .trim()
  .replace(/^[<>'"“”‘’]+|[<>'"“”‘’]+$/g, '')
  .trim();

const isValidLinkUrl = (raw: string): boolean => {
  try {
    const u = new URL(cleanLinkInput(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname);
  } catch {
    return false;
  }
};

export const normalizeLinkUrl = (raw: string): string => {
  const trimmed = cleanLinkInput(raw);
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) {
    const withScheme = `https:${trimmed}`;
    return isValidLinkUrl(withScheme) ? withScheme : '';
  }
  if (isValidLinkUrl(trimmed)) return trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    if (isValidLinkUrl(withScheme)) return withScheme;
  }
  return '';
};

/** 이 버튼 목록에 고쳐야 할 칸이 있는지(이름만 있고 주소가 없거나, 쓸 수 없는 주소). */
export const linkButtonsInvalid = (buttons: DmMessageButton[]): boolean =>
  buttons.some((b) => {
    const label = b.label.trim();
    const url = (b.url || '').trim();
    if (!label && !url) return false;
    return !label || !normalizeLinkUrl(url);
  });

const DmLinkButtonsEditor: React.FC<{
  buttons: DmMessageButton[];
  onChange: (buttons: DmMessageButton[]) => void;
  disabled?: boolean;
}> = ({ buttons, onChange, disabled }) => {
  const update = (id: string, p: Partial<DmMessageButton>) =>
    onChange(buttons.map((b) => (b.id === id ? { ...b, ...p } : b)));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-black text-slate-500">
        <Link2 size={13} /> 링크 버튼 <span className="text-slate-300 font-bold">(선택 · 최대 3개)</span>
      </div>
      {buttons.map((b) => {
        const urlBroken = Boolean((b.url || '').trim()) && !normalizeLinkUrl(b.url);
        const urlInvalid = urlBroken || (Boolean(b.label.trim()) && !b.url.trim());
        return (
          <div key={b.id} className="bg-white border border-slate-100 rounded-xl p-2">
            <div className="flex gap-2 items-center">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={b.label}
                  onChange={(e) => update(b.id, { label: e.target.value })}
                  placeholder="버튼 이름 (예: 구매하기)"
                  maxLength={20}
                  disabled={disabled}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                />
                <input
                  value={b.url}
                  onChange={(e) => update(b.id, { url: cleanLinkInput(e.target.value) })}
                  onBlur={(e) => {
                    const value = normalizeLinkUrl(e.currentTarget.value);
                    if (value) update(b.id, { url: value });
                  }}
                  placeholder="https://..."
                  disabled={disabled}
                  className={`bg-white border rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500 ${
                    urlInvalid ? 'border-red-300' : 'border-slate-200'
                  }`}
                />
              </div>
              <button
                type="button"
                onClick={() => onChange(buttons.filter((x) => x.id !== b.id))}
                disabled={disabled}
                className="w-8 h-8 shrink-0 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center"
                aria-label="버튼 삭제"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {urlInvalid && (
              <p className="flex items-center gap-1 mt-1.5 px-1 text-[10px] font-bold text-red-500">
                <AlertCircle size={11} />
                https:// 로 시작하는 주소를 입력해야 버튼이 전송됩니다.
              </p>
            )}
          </div>
        );
      })}
      {buttons.length < 3 && (
        <button
          type="button"
          onClick={() => onChange([...buttons, { id: genId('btn'), label: '', url: '' }])}
          disabled={disabled}
          className="w-full border border-dashed border-slate-300 rounded-xl py-2 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500 bg-white"
        >
          + 버튼 추가
        </button>
      )}
    </div>
  );
};

export default DmLinkButtonsEditor;

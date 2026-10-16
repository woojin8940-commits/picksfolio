import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiService } from '../../services/apiService';

/**
 * 후보 풀의 "제안하기" 버튼 + 광고 협업 제안 알림톡 확인 창.
 *
 * 누르면 승인된 "광고 협업 제안" 알림톡이 인플루언서에게 간다. 문구에 들어가는 네
 * 값(브랜드명 · 캠페인명 · 업로드 일정 · 콘텐츠 유형)은 캠페인에서 미리 채워 두고,
 * 담당자가 보내기 전에 고칠 수 있게 한다. 알림톡에는 "담당자와 대화하기" 버튼이
 * 붙어 있어서, 인플루언서가 누르면 채널 채팅방에서 담당자와 바로 이어진다.
 *
 * 받는 번호는 화면에 내려오지 않는다. 계정 아이디만 넘기고 번호는 서버가 찾는다.
 *
 * 줄 보기에서는 줄 전체가 펼치기 버튼이라 클릭을 여기서 멈추고, 창은 portal 로
 * body 에 그린다(KakaoMessageButton 과 같은 이유).
 */

export type ProposalDefaults = {
  brand: string;
  campaignTitle: string;
  uploadSchedule: string;
  contentType: string;
};

interface ProposalAlimtalkButtonProps {
  username: string;
  campaignId: string;
  /** 창 머리에 적을 이름. 인스타 계정이 있으면 그것을 넘긴다. */
  label?: string;
  defaults: ProposalDefaults;
  token?: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

const ProposalAlimtalkButton: React.FC<ProposalAlimtalkButtonProps> = ({
  username,
  campaignId,
  label,
  defaults,
  token,
  onNotify,
}) => {
  const [open, setOpen] = useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          stop(e);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            stop(e);
            setOpen(true);
          }
        }}
        className="inline-flex items-center rounded-lg bg-blue-600 text-white px-2.5 py-1 text-[10px] font-black hover:bg-blue-700 cursor-pointer select-none flex-shrink-0"
        title="광고 협업 제안 알림톡 보내기"
      >
        제안하기
      </span>
      {open &&
        createPortal(
          <ProposalDialog
            username={username}
            campaignId={campaignId}
            label={label}
            defaults={defaults}
            token={token}
            onNotify={onNotify}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
};

const ProposalDialog: React.FC<{
  username: string;
  campaignId: string;
  label?: string;
  defaults: ProposalDefaults;
  token?: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  onClose: () => void;
}> = ({ username, campaignId, label, defaults, token, onNotify, onClose }) => {
  const [form, setForm] = useState<ProposalDefaults>(defaults);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<any>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const send = async () => {
    if (sending || sent) return;
    setSending(true);
    setError('');
    const res = await apiService.sendKakaoProposal({ username, campaignId, ...form }, token);
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSent(res);
    onNotify?.(
      res.type === 'sms'
        ? '알림톡을 보낼 수 없어 문자로 협업 제안을 보냈습니다.'
        : '카카오톡으로 협업 제안을 보냈습니다.',
    );
  };

  const title = label || `@${username}`;
  const show = (v: string) => v.trim() || '협의';

  const input = (key: keyof ProposalDefaults, name: string, placeholder: string) => (
    <div>
      <label className="block text-[10px] text-slate-400 font-black mb-1">{name}</label>
      <input
        type="text"
        value={form[key]}
        disabled={!!sent}
        maxLength={key === 'campaignTitle' ? 100 : 60}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full text-[12px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 disabled:bg-slate-50"
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!sending) onClose();
      }}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title}에게 협업 제안 보내기`}
      >
        <div className="px-5 py-4 bg-blue-600 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-white truncate">{title}</p>
            <p className="text-[10px] font-bold text-white/70">
              광고 협업 제안 알림톡을 보냅니다
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="text-white/70 hover:text-white text-lg font-black leading-none disabled:opacity-40"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-1 gap-2">
            {input('brand', '브랜드명', '예: 픽스폴리오')}
            {input('campaignTitle', '제안 내용 (캠페인명)', '예: 가을 신제품 리뷰')}
            <div className="grid grid-cols-2 gap-2">
              {input('uploadSchedule', '업로드 일정', '비워 두면 협의')}
              {input('contentType', '콘텐츠 유형', '비워 두면 협의')}
            </div>
          </div>

          {/* 인플루언서가 받는 문구. 템플릿 문구 그대로 값만 바꿔 보여 준다. */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
            <p className="text-[10px] font-black text-slate-400 mb-1">미리보기</p>
            <p className="text-[12px] font-black text-slate-900">협업 제안이 도착했어요!</p>
            <p className="text-[11px] font-medium text-slate-700 leading-relaxed whitespace-pre-line mt-1">
              {`픽스폴리오를 통해 ${show(form.brand)}에서 협업을 제안드렸습니다.\n\n` +
                `▪ 제안 내용 : ${show(form.campaignTitle)}\n` +
                `▪ 업로드 일정 : ${show(form.uploadSchedule)}\n` +
                `▪ 콘텐츠 유형 : ${show(form.contentType)}`}
            </p>
            <p className="text-[10px] font-bold text-slate-400 mt-1.5">
              버튼: 제안 확인하기 · 담당자와 대화하기
            </p>
          </div>

          {sent && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
              {sent.type === 'sms'
                ? '알림톡 발송이 안 돼 같은 내용을 문자로 보냈습니다.'
                : '협업 제안을 보냈습니다. 인플루언서가 "담당자와 대화하기"를 누르면 채널 관리자센터 1:1 채팅에서 이어서 안내하세요.'}
            </div>
          )}

          {error && <p className="text-[11px] font-bold text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={sending}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-[12px] font-black hover:bg-slate-200 disabled:opacity-40"
            >
              {sent ? '닫기' : '취소'}
            </button>
            {!sent && (
              <button
                onClick={send}
                disabled={sending || !form.brand.trim() || !form.campaignTitle.trim()}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-[12px] font-black hover:bg-blue-700 disabled:opacity-40"
              >
                {sending ? '보내는 중...' : '제안 보내기'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProposalAlimtalkButton;

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiService } from '../../services/apiService';

/**
 * 카카오톡 버튼 + 연락 요청 확인 창.
 *
 * 채널 친구가 아닌 인플루언서에게는 자유 문장 카카오톡이 닿지 않는다. 그래서 이 버튼은
 * 정해진 문구의 연락 요청 알림톡("메시지를 보내 주세요")만 보낸다. 인플루언서가 그
 * 알림톡이 온 채널 채팅방에 아무 말이나 남기면, 담당자는 카카오톡 채널 관리자센터에서
 * 자유롭게 이어서 대화한다.
 *
 * 템플릿이 아직 승인되지 않았으면 버튼을 그리지 않는다 — 누르면 전부 대체 문자로
 * 나가기 때문이다. 승인 여부는 화면당 한 번만 묻는다.
 *
 * 받는 번호는 화면에 내려오지도, 적히지도 않는다. 인플루언서가 카카오로 로그인할 때
 * 계정에 저장된 번호를 서버가 찾아 쓰고, 화면은 계정 아이디만 넘긴다.
 *
 * 줄 보기에서는 줄 전체가 펼치기 버튼이라, 이 버튼을 누른 클릭이 줄까지 올라가면
 * 창이 뜨면서 줄도 펼쳐진다. 그래서 클릭을 여기서 멈추고, 창은 portal 로 body 에
 * 그린다 — 줄(<button>) 안에 창을 DOM 으로 그리면 입력칸이 버튼 안에 들어간다.
 */

let enabledCheck: Promise<boolean> | null = null;
const contactRequestEnabled = (token?: string) => {
  if (!enabledCheck) {
    enabledCheck = apiService.getKakaoContactEnabled(token).then((on) => {
      // 실패했으면 다음 화면에서 다시 묻는다.
      if (!on) enabledCheck = null;
      return on;
    });
  }
  return enabledCheck;
};

interface KakaoMessageButtonProps {
  username: string;
  /** 창 머리에 적을 이름. 인스타 계정이 있으면 그것을 넘긴다. */
  label?: string;
  token?: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  size?: 'sm' | 'md';
}

const KakaoIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.86 5.32 4.66 6.74-.2.74-.74 2.7-.85 3.12-.13.52.19.51.4.37.17-.11 2.62-1.78 3.68-2.5.69.1 1.39.15 2.11.15 5.52 0 10-3.58 10-8S17.52 3 12 3z" />
  </svg>
);

const KakaoMessageButton: React.FC<KakaoMessageButtonProps> = ({
  username,
  label,
  token,
  onNotify,
  size = 'sm',
}) => {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    contactRequestEnabled(token).then((on) => alive && setEnabled(on));
    return () => {
      alive = false;
    };
  }, [token]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (!enabled) return null;

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
        className={`inline-flex items-center gap-1 rounded-lg bg-[#FEE500] text-[#191919] font-black hover:brightness-95 cursor-pointer select-none flex-shrink-0 ${
          size === 'md' ? 'px-3 py-1.5 text-[11px]' : 'px-2 py-0.5 text-[10px]'
        }`}
        title="픽스폴리오 카카오톡 채널로 연락 요청 보내기"
      >
        <KakaoIcon className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
        카카오톡
      </span>
      {open &&
        createPortal(
          <KakaoMessageDialog
            username={username}
            label={label}
            token={token}
            onNotify={onNotify}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
};

const KakaoMessageDialog: React.FC<{
  username: string;
  label?: string;
  token?: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  onClose: () => void;
}> = ({ username, label, token, onNotify, onClose }) => {
  const [recipient, setRecipient] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    setChecking(true);
    apiService.getKakaoRecipient(username, token).then((res) => {
      if (!alive) return;
      setChecking(false);
      if (res.error) setError(res.error);
      else setRecipient(res);
    });
    return () => {
      alive = false;
    };
  }, [username, token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const canSend = !!recipient?.available && !sending && !sent;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError('');
    const res = await apiService.sendKakaoMessage(username, token);
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSent(res);
    onNotify?.(
      res.type === 'sms'
        ? '알림톡을 보낼 수 없어 문자로 연락 요청을 보냈습니다.'
        : '카카오톡으로 연락 요청을 보냈습니다.',
    );
  };

  const title = label || `@${username}`;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        // portal 이라도 React 이벤트는 컴포넌트 트리를 따라 올라간다. 여기서 멈추지
        // 않으면 바깥을 눌러 닫는 클릭이 줄 보기의 펼치기까지 누른다.
        e.stopPropagation();
        if (!sending) onClose();
      }}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title}에게 연락 요청 보내기`}
      >
        <div className="px-5 py-4 bg-[#FEE500] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <KakaoIcon className="w-5 h-5 text-[#191919] flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-black text-[#191919] truncate">{title}</p>
              <p className="text-[10px] font-bold text-[#191919]/60">
                픽스폴리오 카카오톡 채널로 연락 요청을 보냅니다
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="text-[#191919]/60 hover:text-[#191919] text-lg font-black leading-none disabled:opacity-40"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[12px] font-medium text-slate-700 leading-relaxed">
            인플루언서에게 "픽스폴리오 채널로 메시지를 보내 달라"는 알림톡이 갑니다.
            인플루언서가 채팅방에 답을 남기면 카카오톡 채널 관리자센터의 1:1 채팅에서
            이어서 대화하세요.
          </p>

          {checking ? (
            <p className="text-[11px] font-bold text-slate-400">확인 중...</p>
          ) : recipient && !recipient.available ? (
            <p className="text-[11px] font-bold text-red-500">
              이 인플루언서는 카카오 계정 연락처가 없어 연락 요청을 보낼 수 없습니다.
            </p>
          ) : null}

          {sent && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
              {sent.type === 'sms'
                ? '알림톡 발송이 안 돼 채널 채팅 링크를 문자로 보냈습니다.'
                : '연락 요청을 보냈습니다.'}
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
                disabled={!canSend}
                className="px-4 py-2 rounded-xl bg-[#FEE500] text-[#191919] text-[12px] font-black hover:brightness-95 disabled:opacity-40"
              >
                {sending ? '보내는 중...' : '연락 요청 보내기'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KakaoMessageButton;

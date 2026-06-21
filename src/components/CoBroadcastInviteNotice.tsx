import React, { useEffect, useRef, useState } from 'react';
import { Users, X } from 'lucide-react';
import { apiService } from '../services/apiService';

/**
 * App-wide 함께 방송 초대 알림.
 *
 * 함께 방송 초대를 받았을 때, 받는 사람이 마침 방송 설정(LiveStreaming)이나
 * 라이브 커머스 관리(LiveCommerceManagement) 화면을 열고 있어야만 초대가 보였다.
 * 그래서 초대를 보내도 상대방에게 "알림이 안 오는" 것처럼 느껴졌다. 이 컴포넌트는
 * 로그인한 크리에이터라면 앱의 어느 화면에 있든 초대를 폴링해서 상단에 알림으로
 * 띄워 준다. 네이티브 푸시(앱이 닫혀 있을 때)와 달리 이건 앱이 열려만 있으면
 * 웹/앱 어디서나 동작한다.
 *
 * 수락하면 초대를 accept 처리하고 라이브 화면(onGoLive)으로 이동한다. 바로 방송이
 * 시작되는 게 아니라 방송 설정 화면이 열리고, 거기서 카메라·보정·상품을 설정한 뒤
 * '라이브 시작'을 직접 누르면 된다. 수락 시 서버가 호스트를 친구 목록에도 상호
 * 추가하므로 다음부터는 서로 친구 목록에서 바로 초대할 수 있다.
 */

interface Invite {
  id: string;
  host: string;
  host_display_name: string;
  host_avatar_url: string;
}

interface Props {
  /** 로그인한 크리에이터의 유저네임 (초대를 받는 사람). */
  username: string;
  /** 수락 후 라이브(방송 설정) 화면으로 이동시키는 콜백. */
  onGoLive: () => void;
}

const CoBroadcastInviteNotice: React.FC<Props> = ({ username, onGoLive }) => {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  // 닫기로 숨긴 초대 id. 다음 폴링에서 다시 뜨지 않도록 기억한다(거절과 달리
  // 서버 상태는 그대로 두고 이 세션에서만 숨김).
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const list = await apiService.getCobroadcastInvites(username);
        if (cancelled) return;
        setInvites(list.filter((i) => !dismissed.current.has(i.id)));
      } catch { /* non-blocking */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [username]);

  const top = invites[0];
  if (!top) return null;

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await apiService.respondCobroadcast('accept', top.id, username);
      if (ok) {
        setInvites((prev) => prev.filter((i) => i.id !== top.id));
        onGoLive();
      }
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiService.respondCobroadcast('decline', top.id, username);
      setInvites((prev) => prev.filter((i) => i.id !== top.id));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    dismissed.current.add(top.id);
    setInvites((prev) => prev.filter((i) => i.id !== top.id));
  };

  return (
    <div className="fixed top-3 inset-x-0 z-[9999] px-3 pointer-events-none flex justify-center" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="pointer-events-auto w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-violet-400/40 rounded-2xl shadow-2xl p-3.5 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-violet-500/20 border border-violet-400/40 flex items-center justify-center shrink-0">
          {top.host_avatar_url ? (
            <img src={top.host_avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <Users size={18} className="text-violet-200" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-black truncate">
            @{top.host_display_name || top.host}
          </p>
          <p className="text-white/50 text-[11px] font-medium">함께 방송하자고 초대했어요</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-[11px] font-black text-white/60 hover:text-white hover:bg-white/10 transition-all disabled:opacity-40"
          >
            거절
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="px-3.5 py-2 rounded-xl text-[11px] font-black text-white bg-violet-600 hover:bg-violet-500 active:scale-95 transition-all disabled:opacity-40"
          >
            수락하기
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="p-1.5 text-white/30 hover:text-white/70 transition-all"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CoBroadcastInviteNotice;

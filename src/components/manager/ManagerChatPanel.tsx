import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiService } from '../../services/apiService';

/**
 * 대화 — 담당자가 인플루언서와 주고받는 채널.
 *
 * 담당자 채널은 인플루언서와 담당자만 있는 방(support_inf_*)이다. 브랜드와
 * 담당자만 있는 방(support_biz_*)은 더 이상 만들지 않는다 — 브랜드가 담당자에게
 * 하는 말은 전부 특정 인플루언서의 특정 단계에 대한 것이라, 대화방으로 빠지면
 * 어느 건인지 다시 설명해야 하고 그 결정이 진행 화면에 남지 않았다. 지금은
 * 진행사항의 단계별 피드백으로 들어온다.
 *
 * 예전에 만들어진 브랜드 방은 지우지 않았으므로 목록에 남아 있다. 그래서 칩은
 * 그대로 둔다 — 안 보여주면 진행 중이던 대화에 담당자가 답할 길이 없어진다.
 *
 * 답장은 서버가 토큰에서 확인한 본인 이름으로 기록된다. 화면에서 보내는 사람을
 * 고를 수 없는 것은 일부러다.
 */

interface ManagerChatPanelProps {
  managerUsername: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type Channel = 'influencer' | 'business';

const channelOf = (t: any): Channel =>
  String(t?.proposalId || '').startsWith('support_biz_') || t?.kind === 'brand_support'
    ? 'business'
    : 'influencer';

const ManagerChatPanel: React.FC<ManagerChatPanelProps> = ({ managerUsername, onNotify }) => {
  const [timelines, setTimelines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mineOnly, setMineOnly] = useState(true);
  const [channel, setChannel] = useState<Channel>('influencer');
  const [openId, setOpenId] = useState('');
  const [thread, setThread] = useState<any>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getTimelineList(managerUsername, 'manager', { mine: mineOnly });
    setLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setTimelines(res.timelines || []);
  }, [managerUsername, mineOnly, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  // 방을 열거나 메시지를 보낸 뒤 맨 아래로. 가장 최근 말이 안 보이면 방을 연 의미가 없다.
  useEffect(() => {
    if (thread) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [thread]);

  const rows = useMemo(
    () => timelines.filter((t) => channelOf(t) === channel),
    [timelines, channel],
  );

  const counts = useMemo(() => {
    let inf = 0;
    let biz = 0;
    let unread = 0;
    for (const t of timelines) {
      if (channelOf(t) === 'business') biz += 1;
      else inf += 1;
      unread += Number(t.unreadCount || 0);
    }
    return { inf, biz, unread };
  }, [timelines]);

  const openThread = async (proposalId: string) => {
    setOpenId(proposalId);
    setThread(null);
    setDraft('');
    setThreadLoading(true);
    const res = await apiService.getTimelineThread(proposalId);
    setThreadLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      setOpenId('');
      return;
    }
    setThread(res.timeline || null);
    // 읽은 표시는 목록의 안 읽음 숫자에 반영된다.
    load();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !openId) return;
    setSending(true);
    const res = await apiService.postTimelineComment(openId, text);
    setSending(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setDraft('');
    setThread((prev: any) =>
      prev ? { ...prev, comments: [...(prev.comments || []), res.comment] } : prev,
    );
    load();
  };

  const openRow = useMemo(() => timelines.find((t) => t.proposalId === openId), [timelines, openId]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-black text-slate-900">대화</h3>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              인플루언서와 브랜드는 서로의 방을 볼 수 없습니다. 양쪽 말을 옮기는 것은 담당자입니다.
              {counts.unread > 0 ? ` · 안 읽음 ${counts.unread}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setChannel('influencer')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black ${
                channel === 'influencer'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              인플루언서 {counts.inf}
            </button>
            <button
              onClick={() => setChannel('business')}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black ${
                channel === 'business'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              브랜드 {counts.biz}
            </button>
            <label className="flex items-center gap-1.5 ml-1 cursor-pointer">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
                className="accent-slate-900"
              />
              <span className="text-[10px] font-black text-slate-500">내 담당만</span>
            </label>
          </div>
        </div>
        {!mineOnly && (
          <p className="text-[10px] font-bold text-amber-600 mt-2">
            다른 담당자가 맡은 방은 목록에는 보여도 열리지 않습니다. 대신 응대해야 한다면
            캠페인에서 담당을 먼저 넘겨받아 주세요.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3 items-start">
        {/* 방 목록 */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {loading ? (
            <p className="text-[11px] text-slate-400 font-bold text-center py-10">
              대화 목록을 불러오는 중...
            </p>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[12px] text-slate-500 font-black">대화가 없습니다.</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">
                {mineOnly
                  ? '내가 담당한 협업이 생기면 방이 만들어집니다.'
                  : '제안을 수락한 협업부터 방이 만들어집니다.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {rows.map((t) => {
                const active = t.proposalId === openId;
                const who =
                  channel === 'influencer'
                    ? `@${t.influencerUsername}`
                    : t.companyName || `@${t.businessUsername}`;
                return (
                  <button
                    key={t.proposalId}
                    onClick={() => openThread(t.proposalId)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${
                      active ? 'bg-blue-50/60' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-black text-slate-900 truncate">{who}</p>
                      {t.unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-red-500 text-white text-[10px] font-black flex-shrink-0">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 font-bold truncate">
                      {t.proposalTitle || t.companyName || '협업'}
                    </p>
                    {t.lastMessageAt && (
                      <p className="text-[10px] text-slate-300 font-bold mt-0.5">
                        {new Date(t.lastMessageAt).toLocaleString('ko-KR')}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 대화 */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {!openId ? (
            <div className="px-4 py-16 text-center">
              <p className="text-[12px] text-slate-500 font-black">왼쪽에서 대화를 선택하세요.</p>
              <p className="mt-1 text-[11px] font-medium text-slate-400">
                보낸 사람은 담당자 본인으로 기록됩니다.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
                <div className="min-w-0">
                  <p className="text-[12px] font-black text-slate-900 truncate">
                    {channel === 'influencer'
                      ? `@${openRow?.influencerUsername || thread?.influencerUsername || ''}`
                      : openRow?.companyName || thread?.companyName || '브랜드'}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold truncate">
                    {openRow?.proposalTitle || thread?.proposalTitle || ''}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => openThread(openId)}
                    className="text-[10px] text-slate-400 font-black hover:text-slate-700"
                  >
                    새로고침
                  </button>
                  <button
                    onClick={() => {
                      setOpenId('');
                      setThread(null);
                    }}
                    className="text-[10px] text-slate-400 font-black hover:text-slate-700"
                  >
                    닫기
                  </button>
                </div>
              </div>

              <div className="h-[420px] overflow-y-auto p-4 space-y-2 bg-slate-50/40">
                {threadLoading ? (
                  <p className="text-[11px] text-slate-400 font-bold text-center py-8">
                    대화를 불러오는 중...
                  </p>
                ) : (thread?.comments || []).length === 0 ? (
                  <p className="text-[11px] text-slate-400 font-bold text-center py-8">
                    아직 대화가 없습니다. 먼저 말을 걸어 보세요.
                  </p>
                ) : (
                  thread.comments.map((c: any) => {
                    const mine = c.authorType === 'manager';
                    return (
                      <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[80%] rounded-xl px-3 py-2 ${
                            mine
                              ? 'bg-blue-600 text-white'
                              : 'bg-white border border-slate-100 text-slate-700'
                          }`}
                        >
                          <p
                            className={`text-[10px] font-black mb-0.5 ${
                              mine ? 'text-blue-100' : 'text-slate-400'
                            }`}
                          >
                            {c.authorName ||
                              (c.authorType === 'business'
                                ? '브랜드'
                                : c.authorType === 'influencer'
                                  ? '인플루언서'
                                  : '담당자')}
                            {c.createdAt && ` · ${new Date(c.createdAt).toLocaleString('ko-KR')}`}
                          </p>
                          <p className="text-[11px] font-medium whitespace-pre-wrap break-words">
                            {c.content}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <div className="p-3 border-t border-slate-100 flex gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder={`@${managerUsername} 이름으로 전송됩니다`}
                  className="flex-1 text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="px-4 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 disabled:opacity-40 flex-shrink-0"
                >
                  보내기
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagerChatPanel;

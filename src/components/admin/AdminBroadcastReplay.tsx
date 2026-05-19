import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiService } from '../../services/apiService';

interface Bucket {
  bucketIndex: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  count: number;
  amount: number;
}

interface ReplayPayload {
  broadcast: {
    id: string;
    username: string;
    startedAt: string;
    endedAt: string;
    durationMinutes: number;
    peakViewers: number;
    totalMessages: number;
    revenue: number;
    hasRecording: boolean;
    recordingDurationSeconds: number;
    videoUrl: string | null;
  };
  timeline: {
    bucketSeconds: number;
    totalSeconds: number;
    buckets: Bucket[];
    peakBucketIndex: number;
    peakBucket: Bucket | null;
    orderCount: number;
    totalAmount: number;
  };
}

interface Props {
  token: string;
  broadcastId: string;
  username: string;
  onClose: () => void;
}

const won = (n: number) => `${(n || 0).toLocaleString()}원`;

const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
};

const AdminBroadcastReplay: React.FC<Props> = ({ token, broadcastId, username, onClose }) => {
  const [data, setData] = useState<ReplayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const payload = await apiService.getAdminBroadcastReplay(token, broadcastId);
      if (cancelled) return;
      if (!payload) {
        setError('방송 정보를 불러오지 못했습니다.');
      } else {
        setData(payload);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token, broadcastId]);

  const maxAmount = useMemo(() => {
    if (!data) return 0;
    return data.timeline.buckets.reduce((m, b) => Math.max(m, b.amount), 0);
  }, [data]);

  const totalSeconds = data?.timeline.totalSeconds || 0;
  const peakBucket = data?.timeline.peakBucket || null;
  const recordingDuration = data?.broadcast.recordingDurationSeconds || totalSeconds;

  const seekTo = (offsetSeconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.currentTime = Math.max(0, offsetSeconds);
      v.play().catch(() => {});
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-black text-slate-900">방송 다시보기</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">@{username} · 관리자 전용</p>
          </div>
          <button onClick={onClose} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-black text-slate-600">
            닫기
          </button>
        </div>

        {loading && (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 font-bold text-sm">방송 데이터 로딩 중...</p>
          </div>
        )}

        {!loading && error && (
          <div className="p-12 text-center text-rose-500 font-bold text-sm">{error}</div>
        )}

        {!loading && data && (
          <div className="p-5 space-y-5">
            <div className="bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center">
              {data.broadcast.hasRecording && data.broadcast.videoUrl ? (
                <video
                  ref={videoRef}
                  src={data.broadcast.videoUrl}
                  controls
                  preload="metadata"
                  className="w-full h-full"
                />
              ) : (
                <div className="text-center text-slate-300 px-6 py-12">
                  <p className="font-black text-sm mb-1">녹화 영상이 없습니다.</p>
                  <p className="text-xs text-slate-400">이 방송이 시작되기 전에는 녹화 기능이 활성화되지 않았습니다.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">총 결제</p>
                <p className="font-black text-indigo-600 text-sm">{won(data.timeline.totalAmount)}</p>
                <p className="text-[10px] font-bold text-slate-500 mt-0.5">{data.timeline.orderCount}건</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">방송 길이</p>
                <p className="font-black text-slate-900 text-sm">{data.broadcast.durationMinutes}분</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">피크 시청자</p>
                <p className="font-black text-purple-600 text-sm">{data.broadcast.peakViewers}</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">결제 피크 구간</p>
                {peakBucket && peakBucket.count > 0 ? (
                  <>
                    <p className="font-black text-amber-700 text-sm">
                      {fmtClock(peakBucket.startOffsetSeconds)} – {fmtClock(peakBucket.endOffsetSeconds)}
                    </p>
                    <p className="text-[10px] font-bold text-amber-600 mt-0.5">
                      {peakBucket.count}건 · {won(peakBucket.amount)}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] font-bold text-slate-400">결제 없음</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-black text-slate-900 text-sm">결제 분포</h4>
                <p className="text-[10px] font-bold text-slate-400">
                  {data.timeline.bucketSeconds}초 단위 · 막대 클릭 시 해당 구간으로 이동
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="flex items-end gap-[2px] h-32">
                  {data.timeline.buckets.map(b => {
                    const heightPct = maxAmount > 0 ? Math.max(2, (b.amount / maxAmount) * 100) : 2;
                    const isPeak = data.timeline.peakBucketIndex === b.bucketIndex && b.amount > 0;
                    return (
                      <button
                        key={b.bucketIndex}
                        onClick={() => seekTo(b.startOffsetSeconds)}
                        title={`${fmtClock(b.startOffsetSeconds)} · ${b.count}건 · ${won(b.amount)}`}
                        className={`flex-1 min-w-[3px] rounded-t transition-colors ${
                          isPeak ? 'bg-amber-500 hover:bg-amber-600' : b.amount > 0 ? 'bg-indigo-400 hover:bg-indigo-500' : 'bg-slate-200 hover:bg-slate-300'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-2 text-[10px] font-bold text-slate-400">
                  <span>방송 시작</span>
                  <span>{fmtClock(Math.floor(totalSeconds / 2))}</span>
                  <span>+{Math.round(totalSeconds / 60)}분</span>
                </div>
                {peakBucket && peakBucket.count > 0 && data.broadcast.hasRecording && (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-amber-700">
                      ★ 가장 결제가 많이 일어난 구간: {fmtClock(peakBucket.startOffsetSeconds)} – {fmtClock(peakBucket.endOffsetSeconds)}
                    </p>
                    <button
                      onClick={() => seekTo(Math.min(recordingDuration, peakBucket.startOffsetSeconds))}
                      className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-black hover:bg-amber-600"
                    >
                      피크 구간으로 이동
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminBroadcastReplay;

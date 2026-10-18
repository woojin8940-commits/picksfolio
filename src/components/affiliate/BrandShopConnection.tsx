import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  Store,
  Trash2,
  Wrench,
} from 'lucide-react';
import { affiliateService, type ShopConnectionStatus } from '../../services/affiliateService';

/**
 * 쇼핑몰 연동 — 판매 캠페인의 바닥.
 *
 * 판매 캠페인은 두 가지가 갖춰져야 돈이 셀 수 있다.
 *   ① 카페24 연동(OAuth) — 상품 목록을 가져오고, 추적 스크립트가 알려 온 주문을
 *      서버가 카페24 주문 API 로 다시 조회해 진짜 주문인지 확인한다.
 *   ② 추적 스크립트 — 인플루언서 링크로 들어온 방문이 주문까지 이어졌는지 몰에서
 *      알려 준다. ScriptTags 로 자동 설치하거나, 스킨을 직접 고치는 몰은 코드를 붙인다.
 *
 * 둘 중 하나라도 비어 있으면 판매가 0건으로 보인다. 그래서 이 화면은 "연결됐다"에서
 * 멈추지 않고 최근 24시간 동안 주문 신호가 실제로 들어왔는지까지 보여 준다 —
 * 클릭은 있는데 수신이 0건이면 스크립트가 빠졌다는 신호다.
 *
 * 연동 자체(OAuth)는 별도 작업이 맡는다. 여기서는 그 시작 경로(cafe24ConnectUrl)로
 * 보내기만 한다.
 */

const formatAt = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const SHOP_LABEL: Record<ShopConnectionStatus['shopType'], string> = {
  cafe24: '카페24',
  imweb: '아임웹',
};

const STATE_BADGE: Record<ShopConnectionStatus['state'], { label: string; cls: string }> = {
  connected: { label: '연결됨', cls: 'bg-emerald-50 text-emerald-600' },
  reconnect: { label: '재연동 필요', cls: 'bg-amber-50 text-amber-600' },
  none: { label: '미연결', cls: 'bg-slate-100 text-slate-500' },
  unavailable: { label: '준비 중', cls: 'bg-slate-100 text-slate-400' },
};

const SCRIPT_MODE_LABEL: Record<ShopConnectionStatus['script']['mode'], string> = {
  auto: '자동 설치됨',
  manual: '직접 설치함',
  none: '미설치',
};

/** 연결 카드 하나. 카페24 몰이 여러 개면 몰마다 한 장이다. */
const ConnectionCard: React.FC<{
  connection: ShopConnectionStatus;
  connectUrl: string;
  busy: string;
  onAction: (action: 'install_script' | 'remove_script' | 'mark_manual', mallId: string) => void;
}> = ({ connection: c, connectUrl, busy, onAction }) => {
  const [copied, setCopied] = useState(false);
  const [showSnippet, setShowSnippet] = useState(false);
  const badge = STATE_BADGE[c.state];
  const linked = c.state === 'connected' || c.state === 'reconnect';
  const working = (action: string) => busy === `${action}:${c.mallId}`;
  const anyBusy = busy.endsWith(`:${c.mallId}`);

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(c.script.snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 권한이 없는 브라우저 — 코드를 펼쳐 두면 손으로 복사할 수 있다.
      setShowSnippet(true);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center flex-shrink-0">
            <Store className="w-5 h-5 text-slate-600" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] md:text-base font-black text-slate-900 truncate">
              {SHOP_LABEL[c.shopType]}
              {c.shopName && <span className="text-slate-500"> · {c.shopName}</span>}
            </p>
            {(c.shopDomain || c.mallId) && (
              <p className="text-[11px] text-slate-400 font-bold truncate">{c.shopDomain || c.mallId}</p>
            )}
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0 ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {/* 재연동 사유. 무엇이 빠졌는지 적어야 동의 화면에서 그 권한을 켜고 온다. */}
      {c.state === 'reconnect' && (
        <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 px-3.5 py-3">
          <p className="text-[12px] font-black text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            연동이 만료되었거나 권한이 부족합니다
          </p>
          {c.missingScopes.length > 0 && (
            <p className="text-[11px] text-amber-700 font-medium mt-1 leading-relaxed break-all">
              빠진 권한: {c.missingScopes.join(', ')}
            </p>
          )}
          <a
            href={connectUrl}
            className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 text-white text-[11px] font-black hover:bg-amber-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 다시 연동하기
          </a>
        </div>
      )}

      {c.state === 'none' && (
        <div className="mt-4">
          <p className="text-[12px] text-slate-500 font-bold leading-relaxed">
            카페24 쇼핑몰을 연동하면 상품을 불러와 판매 캠페인을 만들고, 인플루언서 링크로 들어온 주문을
            자동으로 집계합니다.
          </p>
          <a
            href={connectUrl || undefined}
            aria-disabled={!connectUrl}
            className={`mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[13px] font-black ${
              connectUrl ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 pointer-events-none'
            }`}
          >
            <Link2 className="w-4 h-4" /> 카페24 연동하기
          </a>
          {/* 버튼을 누르면 어디로 가는지 미리 적는다 — 카페24 로그인·동의 화면이 뜨는 것이 정상이다. */}
          <p className="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed">
            카페24 관리자 로그인 후 상품 · 주문 조회와 스크립트 설치 권한에 동의하면 이 화면으로 돌아옵니다.
          </p>
        </div>
      )}

      {linked && (
        <>
          {/* 수신 현황. 연결됐다는 표시만으로는 추적이 실제로 되는지 알 수 없다. */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-slate-50 px-3.5 py-3">
              <p className="text-[10px] font-black text-slate-400">최근 24시간 주문 수신</p>
              <p className="text-lg font-black text-slate-900 mt-0.5">{c.received24h.toLocaleString()}건</p>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                마지막 수신 {c.lastReceivedAt ? formatAt(c.lastReceivedAt) : '없음'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-3.5 py-3">
              <p className="text-[10px] font-black text-slate-400">최근 24시간 링크 클릭</p>
              <p className="text-lg font-black text-slate-900 mt-0.5">{c.clicks24h.toLocaleString()}회</p>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">몰로 보낸 방문 수</p>
            </div>
          </div>
          {/* 클릭은 많은데 주문 신호가 한 건도 없으면 스크립트가 빠졌을 가능성이 크다. */}
          {c.clicks24h >= 30 && c.received24h === 0 && (
            <p className="mt-2 text-[11px] text-amber-600 font-bold leading-relaxed">
              방문은 있는데 주문 신호가 없습니다. 추적 스크립트가 주문 완료 페이지에서 실행되는지 확인해 주세요.
            </p>
          )}

          {/* 추적 스크립트 */}
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-black text-slate-700 flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-slate-500" /> 추적 스크립트
              </p>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                  c.script.mode === 'none' ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-600'
                }`}
              >
                {SCRIPT_MODE_LABEL[c.script.mode]}
              </span>
            </div>
            {c.script.installedAt && (
              <p className="text-[10px] text-slate-400 font-bold mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {formatAt(c.script.installedAt)} 설치
              </p>
            )}
            {c.script.lastError && (
              <p className="text-[11px] text-rose-500 font-bold mt-1.5 leading-relaxed break-keep">
                최근 오류: {c.script.lastError}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {c.script.mode !== 'auto' && (
                <button
                  type="button"
                  disabled={anyBusy || c.state !== 'connected'}
                  onClick={() => onAction('install_script', c.mallId)}
                  className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {working('install_script') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                  자동 설치
                </button>
              )}
              {c.script.mode === 'auto' && (
                <>
                  <button
                    type="button"
                    disabled={anyBusy || c.state !== 'connected'}
                    onClick={() => onAction('install_script', c.mallId)}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {working('install_script') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    다시 설치
                  </button>
                  <button
                    type="button"
                    disabled={anyBusy}
                    onClick={() => {
                      if (!confirm('추적 스크립트를 제거할까요? 제거하면 판매가 집계되지 않습니다.')) return;
                      onAction('remove_script', c.mallId);
                    }}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl border border-slate-200 text-rose-500 text-[12px] font-black hover:bg-rose-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {working('remove_script') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    제거
                  </button>
                </>
              )}
              {c.script.mode === 'none' && (
                <button
                  type="button"
                  disabled={anyBusy}
                  onClick={() => {
                    if (!confirm('쇼핑몰 공통 영역에 아래 코드를 직접 붙이셨나요?')) return;
                    onAction('mark_manual', c.mallId);
                  }}
                  className="flex-1 min-w-[120px] py-2.5 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {working('mark_manual') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  직접 설치했어요
                </button>
              )}
            </div>

            {/* 수동 설치 코드. 스킨을 직접 고치는 몰은 자동 설치가 덮어써질 수 있어 코드를 붙인다. */}
            {c.script.snippet && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSnippet(v => !v)}
                    className="text-[11px] font-black text-blue-600 hover:underline"
                  >
                    {showSnippet ? '설치 코드 접기' : '직접 설치용 코드 보기'}
                  </button>
                  <button
                    type="button"
                    onClick={copySnippet}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200"
                  >
                    <Copy className="w-3 h-3" /> {copied ? '복사됨' : '코드 복사'}
                  </button>
                </div>
                {showSnippet && (
                  <>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-2xl bg-slate-900 text-slate-100 text-[10px] leading-relaxed p-3 whitespace-pre-wrap break-all">
                      {c.script.snippet}
                    </pre>
                    <p className="text-[10px] text-slate-400 font-medium mt-1.5 leading-relaxed">
                      카페24 관리자 &gt; 디자인 &gt; HTML 편집에서 모든 페이지 공통 영역(&lt;/body&gt; 바로 위)에
                      붙여 넣은 뒤 '직접 설치했어요'를 눌러 주세요.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const BrandShopConnection: React.FC = () => {
  const [connections, setConnections] = useState<ShopConnectionStatus[]>([]);
  const [connectUrl, setConnectUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 진행 중인 동작. `${action}:${mallId}` 꼴이라 카드마다 따로 잠근다. */
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateService.getShopConnections();
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError('');
    setConnections(Array.isArray(res.connections) ? res.connections : []);
    setConnectUrl(res.cafe24ConnectUrl || '');
    setNotice(res.trackingNotice || '');
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action: 'install_script' | 'remove_script' | 'mark_manual', mallId: string) => {
    setBusy(`${action}:${mallId}`);
    const res = await affiliateService.shopConnectionAction(action, mallId);
    setBusy('');
    if (res.error || !res.connection) {
      alert(res.error || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      // 실패해도 서버가 lastError 를 남겼을 수 있다 — 다시 읽어 그 자리에 보여 준다.
      load();
      return;
    }
    setConnections(prev => prev.map(c => (c.mallId === mallId && c.shopType === res.connection!.shopType ? res.connection! : c)));
  };

  const cafe24 = connections.filter(c => c.shopType === 'cafe24');
  // 카페24 연결이 하나도 없으면 '미연결' 카드 한 장을 세운다. 서버가 빈 목록을 줘도
  // 연동 버튼이 있어야 시작할 수 있다.
  const cafe24Cards: ShopConnectionStatus[] = cafe24.length > 0 ? cafe24 : [{
    shopType: 'cafe24', state: 'none', mallId: '', shopName: '', shopDomain: '', missingScopes: [],
    script: { mode: 'none', installedAt: null, lastError: '', snippet: '' },
    received24h: 0, lastReceivedAt: null, clicks24h: 0,
  }];

  return (
    <main className="p-4 md:p-14 w-full max-w-3xl animate-in fade-in duration-500">
      <header className="mb-5 md:mb-8">
        <h2 className="text-lg md:text-3xl font-black text-slate-900">쇼핑몰 연동</h2>
        <p className="text-[12px] md:text-sm text-slate-500 font-bold mt-1 leading-relaxed">
          자사몰을 연동하고 추적 스크립트를 설치하면, 판매 캠페인의 인플루언서 판매가 자동으로 집계됩니다.
        </p>
      </header>

      {loading && connections.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-10 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
          <span className="text-[12px] font-bold text-slate-400">연동 상태 확인 중...</span>
        </div>
      ) : error && connections.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <p className="text-sm font-bold text-rose-500">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 px-4 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-black"
          >
            다시 불러오기
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {cafe24Cards.map(c => (
            <ConnectionCard
              key={c.mallId || 'cafe24-empty'}
              connection={c}
              connectUrl={connectUrl}
              busy={busy}
              onAction={handleAction}
            />
          ))}

          {/* 아임웹은 아직 연동을 만들지 않았다. 자리를 비워 두면 카페24만 되는지 모르고 찾아 헤맨다. */}
          <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-5 md:p-6 opacity-80">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center">
                  <Store className="w-5 h-5 text-slate-300" />
                </span>
                <div>
                  <p className="text-[14px] md:text-base font-black text-slate-500">아임웹</p>
                  <p className="text-[11px] text-slate-400 font-bold">연동을 준비하고 있습니다</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-400">준비 중</span>
            </div>
          </div>

          {/* 추적 한계 안내. 서버가 준 문구를 그대로 보인다 — 간편결제 등은 누락될 수 있다. */}
          {notice && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-2xl px-3.5 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[12px] font-black text-amber-800">추적 한계 안내</p>
                <p className="text-[11px] text-amber-700 font-medium mt-1 leading-relaxed whitespace-pre-line break-keep">
                  {notice}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-[11px] font-black text-slate-400 hover:text-slate-600 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 상태 새로고침
            </button>
          </div>
        </div>
      )}
    </main>
  );
};

export default BrandShopConnection;

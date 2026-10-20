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
  Unplug,
  Wrench,
  X,
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
 * 카페24 연동(OAuth): "카페24 연동하기" → 쇼핑몰 아이디 입력 → 서버가 로그인을 확인하고
 * 1회용 state 를 발급 → /api/cafe24-oauth-start?mall_id=…&state=… → 카페24 동의 화면 →
 * /api/cafe24/callback → 이 화면(?cafe24=connected 또는 ?cafe24_error=사유)으로 돌아온다.
 * 카페24 관리자에서 앱을 실행하면 /cafe24/app 이 검증한 값(cafe24_launch)을 들고 들어와 곧바로 이어 간다.
 */

const MALL_ID_RE = /^[a-z0-9]{2,32}$/;

/** 'https://abc.cafe24.com', 'abc.cafe24.com/admin' 처럼 주소째 붙여 넣어도 아이디만 꺼낸다. */
const extractMallId = (raw: string) => {
  const v = raw.trim().toLowerCase();
  const m = v.match(/^(?:https?:\/\/)?([a-z0-9]+)\.cafe24(?:api)?\.com/);
  return m ? m[1] : v;
};

/** 콜백 · 시작 실패 사유(cafe24_error) → 화면 문구. */
const CAFE24_ERROR_TEXT: Record<string, string> = {
  invalid_grant: '카페24 인증이 만료되었습니다. 다시 연동해 주세요.',
  denied: '카페24 동의가 취소되었습니다. 다시 연동해 주세요.',
  state_invalid: '연동 요청이 만료되었거나 이미 사용되었습니다. 다시 연동해 주세요.',
  mall_mismatch: '연동을 시작한 쇼핑몰과 동의한 쇼핑몰이 다릅니다. 같은 쇼핑몰 아이디로 다시 연동해 주세요.',
  mall_taken: '이미 다른 브랜드 계정에 연동된 쇼핑몰입니다.',
  invalid_mall: '쇼핑몰 아이디 형식이 올바르지 않습니다. 영문 소문자와 숫자로만 입력해 주세요.',
  token_failed: '카페24에서 연동 정보를 받지 못했습니다. 잠시 후 다시 연동해 주세요.',
  save_failed: '연동 정보를 저장하지 못했습니다. 잠시 후 다시 연동해 주세요.',
  config: '카페24 연동 설정이 준비되지 않았습니다. 고객센터로 문의해 주세요.',
};

/** 쇼핑몰 아이디 입력 → 연동 시작. */
const Cafe24ConnectDialog: React.FC<{
  initialMallId: string;
  onClose: () => void;
  onStart: (mallId: string) => Promise<string | null>;
}> = ({ initialMallId, onClose, onStart }) => {
  const [value, setValue] = useState(initialMallId);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mallId = extractMallId(value);
    if (!MALL_ID_RE.test(mallId)) {
      setError('영문 소문자와 숫자로만 입력해 주세요. (예: mybrand)');
      return;
    }
    setError('');
    setSubmitting(true);
    const failure = await onStart(mallId);
    // 성공하면 카페24로 이동하므로 이 화면은 그대로 둔다.
    if (failure) {
      setSubmitting(false);
      setError(failure);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-black text-slate-900">카페24 쇼핑몰 아이디</p>
          <button type="button" onClick={onClose} className="p-1 -m-1 text-slate-400 hover:text-slate-600" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[12px] text-slate-500 font-bold mt-2 leading-relaxed break-keep">
          카페24 관리자 주소 https://○○○.cafe24.com 의 ○○○ 부분을 입력하세요
        </p>
        <div className="mt-4 flex items-center rounded-2xl border border-slate-200 focus-within:border-blue-500 px-3.5">
          <span className="text-[13px] text-slate-400 font-bold">https://</span>
          <input
            autoFocus
            value={value}
            onChange={e => { setValue(e.target.value); setError(''); }}
            placeholder="mybrand"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            className="flex-1 min-w-0 py-3 text-[14px] font-black text-slate-900 outline-none bg-transparent"
          />
          <span className="text-[13px] text-slate-400 font-bold">.cafe24.com</span>
        </div>
        {error && <p className="text-[11px] text-rose-500 font-bold mt-2 leading-relaxed">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !value.trim()}
          className="mt-4 w-full py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          카페24로 이동해 동의하기
        </button>
        <p className="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed">
          카페24 관리자 로그인 후 상품 · 주문 조회와 스크립트 설치 권한에 동의하면 이 화면으로 돌아옵니다.
        </p>
      </form>
    </div>
  );
};

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
  /** 연동 시작. mallId 를 알면(재연동) 바로, 모르면 아이디 입력창부터. */
  onConnect: (mallId: string) => void;
  onDisconnect: (mallId: string) => void;
}> = ({ connection: c, connectUrl, busy, onAction, onConnect, onDisconnect }) => {
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
            {c.missingScopes.length > 0 ? '재연동 필요 · 앱 권한이 부족합니다' : '재연동 필요 · 연동이 만료되었습니다'}
          </p>
          {c.missingScopes.length > 0 && (
            <p className="text-[11px] text-amber-700 font-medium mt-1 leading-relaxed break-all">
              빠진 권한: {c.missingScopes.join(', ')}
            </p>
          )}
          <button
            type="button"
            disabled={!connectUrl || anyBusy}
            onClick={() => onConnect(c.mallId)}
            className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 text-white text-[11px] font-black hover:bg-amber-700 disabled:opacity-50"
          >
            {working('connect') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 다시 연동하기
          </button>
        </div>
      )}

      {c.state === 'none' && (
        <div className="mt-4">
          <p className="text-[12px] text-slate-500 font-bold leading-relaxed">
            카페24 쇼핑몰을 연동하면 상품을 불러와 판매 캠페인을 만들고, 인플루언서 링크로 들어온 주문을
            자동으로 집계합니다.
          </p>
          <button
            type="button"
            disabled={!connectUrl}
            onClick={() => onConnect('')}
            className={`mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[13px] font-black ${
              connectUrl ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 pointer-events-none'
            }`}
          >
            <Link2 className="w-4 h-4" /> 카페24 연동하기
          </button>
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
            {c.script.lastError && (() => {
              // 서버 문구는 "[사유] 안내 (카페24 상태 · 코드 · 메시지)" 모양이다. 사유를 배지로 뺀다.
              const m = c.script.lastError.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
              return (
                <div className="mt-1.5 rounded-lg bg-rose-50 px-2.5 py-2">
                  <p className="text-[11px] font-black text-rose-600 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {m ? m[1] : '최근 오류'}
                  </p>
                  <p className="text-[11px] text-rose-500 font-bold mt-0.5 leading-relaxed break-keep">
                    {m ? m[2] : c.script.lastError}
                  </p>
                </div>
              );
            })()}

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

          {/* 연동 해제. 스크립트를 먼저 지우고 카페24 토큰을 폐기한다. */}
          <div className="mt-5 pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              disabled={anyBusy}
              onClick={() => {
                if (!confirm('카페24 연동을 해제할까요?\n추적 스크립트를 제거하고 연동 권한을 폐기합니다. 진행 중인 판매 캠페인의 주문이 더 이상 집계되지 않습니다.')) return;
                onDisconnect(c.mallId);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-500 text-[11px] font-black hover:bg-rose-50 disabled:opacity-50"
            >
              {working('disconnect') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
              연동 해제
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/** embedded: 판매 캠페인 메뉴의 '연동' 탭 안에 들어갈 때. 바깥 여백과 큰 제목을 뺀다. */
const BrandShopConnection: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [connections, setConnections] = useState<ShopConnectionStatus[]>([]);
  const [connectUrl, setConnectUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 진행 중인 동작. `${action}:${mallId}` 꼴이라 카드마다 따로 잠근다. */
  const [busy, setBusy] = useState('');
  /** 쇼핑몰 아이디 입력창. null 이면 닫힘, 문자열이면 미리 채울 값. */
  const [dialogMallId, setDialogMallId] = useState<string | null>(null);
  /** 연동 결과 안내(콜백 복귀 · 해제 · 앱 실행). */
  const [banner, setBanner] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  /** 연동 시작. 실패하면 사유 문구, 성공하면(카페24로 이동) null. */
  const startConnect = useCallback(async (input: { mallId?: string; launch?: string }): Promise<string | null> => {
    const res = await affiliateService.startCafe24Connect(input);
    if (res.url) {
      window.location.assign(res.url);
      return null;
    }
    if (res.alreadyConnected) {
      setBanner({ tone: 'success', text: `${res.mallId || '쇼핑몰'} 은(는) 이미 연결되어 있습니다.` });
      return null;
    }
    return res.error || '연동을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }, []);

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

  /**
   * 주소에 실려 온 연동 결과 · 앱 실행 값을 읽고 주소에서 지운다(새로고침해도 다시 실행되지 않게).
   *   cafe24=connected · cafe24_error=사유 : 콜백 복귀
   *   cafe24_launch=… : 카페24 관리자에서 앱 실행(/cafe24/app 검증 통과) → 곧바로 연동 이어 가기
   *   cafe24_mall=… : /api/cafe24-oauth-start?mall_id= 로 바로 들어온 경우 → 아이디를 채운 입력창
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keys = ['cafe24', 'cafe24_error', 'cafe24_launch', 'cafe24_mall', 'mall'];
    if (!keys.some(k => params.has(k))) return;
    const connected = params.get('cafe24') === 'connected';
    const errorCode = params.get('cafe24_error') || '';
    const launch = params.get('cafe24_launch') || '';
    const mallParam = params.get('cafe24_mall') || '';
    const mall = params.get('mall') || '';
    keys.forEach(k => params.delete(k));
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    try {
      if ((sessionStorage.getItem('picks_business_redirect') || '').includes('cafe24_launch')) {
        sessionStorage.removeItem('picks_business_redirect');
      }
    } catch { /* 저장소를 못 쓰는 브라우저 */ }

    if (connected) setBanner({ tone: 'success', text: `카페24 쇼핑몰${mall ? `(${mall})` : ''}이 연결되었습니다.` });
    else if (errorCode) setBanner({ tone: 'error', text: CAFE24_ERROR_TEXT[errorCode] || CAFE24_ERROR_TEXT.token_failed });
    else if (launch) {
      setBanner({ tone: 'success', text: '카페24 앱 실행을 확인했습니다. 연동 화면으로 이동합니다…' });
      startConnect({ launch }).then(failure => {
        if (failure) setBanner({ tone: 'error', text: failure });
      });
    } else if (mallParam) setDialogMallId(MALL_ID_RE.test(mallParam) ? mallParam : '');
  }, [startConnect]);

  const handleConnect = async (mallId: string) => {
    if (!mallId) {
      setDialogMallId('');
      return;
    }
    setBusy(`connect:${mallId}`);
    const failure = await startConnect({ mallId });
    if (failure) {
      setBusy('');
      setBanner({ tone: 'error', text: failure });
    }
  };

  const handleDisconnect = async (mallId: string) => {
    setBusy(`disconnect:${mallId}`);
    const res = await affiliateService.disconnectShop(mallId);
    setBusy('');
    if (res.error || !res.disconnected) {
      setBanner({ tone: 'error', text: res.error || '연동을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    setBanner({
      tone: res.scriptRemoved ? 'success' : 'error',
      text: res.scriptRemoved
        ? '카페24 연동을 해제했습니다.'
        : '연동은 해제했지만 추적 스크립트를 지우지 못했습니다. 카페24 관리자 > 앱 > 스크립트 관리에서 직접 삭제해 주세요.',
    });
    load();
  };

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

  const Wrapper = embedded ? 'div' : 'main';
  const cafe24 = connections.filter(c => c.shopType === 'cafe24');
  // 카페24 연결이 하나도 없으면 '미연결' 카드 한 장을 세운다. 서버가 빈 목록을 줘도
  // 연동 버튼이 있어야 시작할 수 있다.
  const cafe24Cards: ShopConnectionStatus[] = cafe24.length > 0 ? cafe24 : [{
    shopType: 'cafe24', state: 'none', mallId: '', shopName: '', shopDomain: '', missingScopes: [],
    script: { mode: 'none', installedAt: null, lastError: '', snippet: '' },
    received24h: 0, lastReceivedAt: null, clicks24h: 0,
  }];

  return (
    <Wrapper className={embedded ? 'w-full max-w-3xl' : 'p-4 md:p-14 w-full max-w-3xl animate-in fade-in duration-500'}>
      {embedded ? (
        <p className="mb-4 text-[12px] text-slate-500 font-bold leading-relaxed">
          자사몰을 연동하고 추적 스크립트를 설치하면, 판매 캠페인의 인플루언서 판매가 자동으로 집계됩니다.
        </p>
      ) : (
        <header className="mb-5 md:mb-8">
          <h2 className="text-lg md:text-3xl font-black text-slate-900">쇼핑몰 연동</h2>
          <p className="text-[12px] md:text-sm text-slate-500 font-bold mt-1 leading-relaxed">
            자사몰을 연동하고 추적 스크립트를 설치하면, 판매 캠페인의 인플루언서 판매가 자동으로 집계됩니다.
          </p>
        </header>
      )}

      {banner && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-2xl px-3.5 py-3 border ${
            banner.tone === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-600'
          }`}
        >
          {banner.tone === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <p className="flex-1 text-[12px] font-black leading-relaxed break-keep">{banner.text}</p>
          <button type="button" onClick={() => setBanner(null)} className="opacity-60 hover:opacity-100" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {dialogMallId !== null && (
        <Cafe24ConnectDialog
          initialMallId={dialogMallId}
          onClose={() => setDialogMallId(null)}
          onStart={mallId => startConnect({ mallId })}
        />
      )}

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
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
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
    </Wrapper>
  );
};

export default BrandShopConnection;

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Loader2, Plus, RotateCcw } from 'lucide-react';
import { MetaPixel, createMetaPixel, fetchMetaPixels } from '../utils/metaAdsApi';
import { inputCls, labelCls, selectCls } from './AdDeliveryFields';

/** 메타 픽셀 기본 코드. 브랜드 웹사이트의 <head> 에 넣으면 페이지 조회가 들어온다. */
export const pixelBaseCode = (id: string) => `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${id}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;

/** 구매 완료 페이지에 더 넣는 이벤트 코드. */
const purchaseCode = `<script>
fbq('track', 'Purchase', { value: 결제금액, currency: 'KRW' });
</script>`;

const firedLabel = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-500">{label}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-[10px] font-black text-blue-600">
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? '복사됨' : '코드 복사'}
        </button>
      </div>
      <pre className="mt-1 max-h-40 overflow-auto rounded-xl bg-slate-900 text-slate-100 text-[10px] leading-relaxed p-3 whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );
}

/**
 * 광고 관리자의 '데이터 세트' 칸. 광고 계정의 픽셀을 고르고, 없으면 여기서 바로 만든다.
 * 만든 뒤에는 웹사이트에 넣을 설치 코드와 이벤트 수신 여부를 보여 준다.
 */
export default function MetaPixelField({
  businessUsername,
  adAccountId,
  pixelId,
  onChange,
}: {
  businessUsername: string;
  adAccountId: string;
  pixelId: string;
  onChange: (id: string) => void;
}) {
  const [pixels, setPixels] = useState<MetaPixel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!adAccountId) return;
    let alive = true;
    setLoading(true);
    setLoadError('');
    fetchMetaPixels(businessUsername, adAccountId).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setPixels(res.pixels);
      if (!res.pixels.some((p) => p.id === pixelId)) onChange(res.pixels[0]?.id || '');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessUsername, adAccountId, reload]);

  const create = async () => {
    setCreating(true);
    setCreateError('');
    const res = await createMetaPixel(businessUsername, adAccountId, name.trim() || `${businessUsername} 픽셀`);
    setCreating(false);
    if (!res.ok) {
      setCreateError(
        res.metaErrorCode === 200 || res.metaErrorCode === 10
          ? '이 광고 계정에 픽셀을 만들 권한이 없습니다. 메타 비즈니스 관리자에서 광고 계정 관리자 권한을 확인해 주세요.'
          : res.error,
      );
      return;
    }
    setPixels((prev) => [...prev, res.pixel]);
    onChange(res.pixel.id);
    setCreateOpen(false);
    setName('');
    setShowCode(true);
  };

  const selected = pixels.find((p) => p.id === pixelId);
  const fired = selected ? firedLabel(selected.lastFiredTime) : '';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className={labelCls} htmlFor="boost-pixel">데이터 세트(픽셀)</label>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="inline-flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-slate-600"
        >
          <RotateCcw className="w-3 h-3" /> 새로고침
        </button>
      </div>

      {loading ? (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 픽셀을 불러오는 중…
        </p>
      ) : loadError ? (
        <p className="text-[10px] font-bold text-rose-500">{loadError}</p>
      ) : pixels.length > 0 ? (
        <div className="relative">
          <select id="boost-pixel" value={pixelId} onChange={(e) => onChange(e.target.value)} className={selectCls}>
            {pixels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      ) : (
        <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
          이 광고 계정에는 아직 픽셀이 없습니다. 만들어서 웹사이트에 설치하면 구매 · 방문을 재고 전환에 맞춰 집행할 수
          있어요. 만들지 않아도 광고는 링크 클릭 최적화로 집행됩니다.
        </p>
      )}

      {selected && (
        <p className={`text-[10px] font-bold ${fired ? 'text-emerald-600' : 'text-amber-600'}`}>
          {fired
            ? `이벤트 수신 중 · 마지막 이벤트 ${fired}`
            : '아직 이벤트가 들어오지 않았어요. 아래 설치 코드를 웹사이트에 넣어 주세요.'}
        </p>
      )}

      {!loading && !loadError && (
        <div className="flex flex-wrap gap-3">
          {!createOpen && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-black text-blue-600"
            >
              <Plus className="w-3.5 h-3.5" /> 새 데이터 세트 만들기
            </button>
          )}
          {selected && (
            <button type="button" onClick={() => setShowCode((v) => !v)} className="text-[11px] font-black text-slate-600">
              {showCode ? '설치 코드 닫기' : '설치 코드 보기'}
            </button>
          )}
        </div>
      )}

      {createOpen && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${businessUsername} 픽셀`}
            maxLength={100}
            aria-label="새 데이터 세트 이름"
            className={inputCls}
          />
          {createError && <p className="text-[10px] font-bold text-rose-500">{createError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-blue-600 text-white text-[11px] font-black disabled:opacity-50"
            >
              {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 만들기
            </button>
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false);
                setCreateError('');
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 text-[11px] font-black text-slate-500"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {selected && showCode && (
        <div className="rounded-xl bg-slate-50 p-3 space-y-3">
          <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
            1. 아래 기본 코드를 웹사이트 모든 페이지의 &lt;head&gt; 안에 붙여 넣습니다. 카페24 · 아임웹 · 스마트스토어처럼
            쇼핑몰 빌더를 쓰면 관리자 화면의 '메타 픽셀 ID' 칸에 <b>{selected.id}</b> 만 넣어도 됩니다.
          </p>
          <CodeBlock code={pixelBaseCode(selected.id)} label="기본 코드" />
          <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
            2. 구매 완료 페이지에는 구매 이벤트를 더 넣습니다. 결제금액 자리에 실제 금액을 넣어 주세요.
          </p>
          <CodeBlock code={purchaseCode} label="구매 이벤트" />
          <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
            3. 설치 후 사이트를 한 번 열고 '새로고침'을 누르면 이벤트 수신 여부가 바뀝니다.
          </p>
        </div>
      )}
    </div>
  );
}

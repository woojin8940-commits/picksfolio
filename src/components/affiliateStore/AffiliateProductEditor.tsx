import React, { useRef, useState } from 'react';
import { ArrowLeft, ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react';
import { apiService } from '../../services/apiService';
import {
  affiliateStoreService,
  won,
  type ProductInput,
  type CategoryNode,
  type FeeRates,
  type ProductStatus,
  type StoreProduct,
} from '../../services/affiliateStoreService';

/**
 * 상품 등록 · 수정 화면(카페24 상품 등록처럼 섹션별로 나눈 한 장짜리 양식).
 * 기본 정보 → 이미지 → 판매가 · 수수료 → 재고 · 옵션 → 상세 설명 → 판매 상태.
 */

interface Props {
  businessUsername: string;
  taxonomy: CategoryNode[];
  /** 지금 설정된 수수료율. 1개 판매 시 예상 정산액을 보여 줄 때 쓴다. */
  feeRates?: FeeRates | null;
  product: StoreProduct | null;
  onClose: () => void;
  onSaved: (p: StoreProduct) => void;
}

const MAX_IMAGES = 10;

const toInput = (p: StoreProduct | null): ProductInput => ({
  id: p?.id,
  name: p?.name || '',
  category: p?.category || '',
  subcategory: p?.subcategory || '',
  summary: p?.summary || '',
  description: p?.description || '',
  imageUrls: p?.imageUrls || [],
  options: p?.options || [],
  retailPrice: p?.retailPrice || 0,
  salePrice: p?.salePrice || 0,
  commissionRate: p?.commissionRate || 0,
  stock: p?.stock || 0,
  shippingFee: p?.shippingFee || 0,
  productUrl: p?.productUrl || '',
  // 새 상품은 등록하자마자 인플루언서에게 보이도록 기본값을 '판매중'으로 둔다.
  status: p?.status || 'on_sale',
});

const inputCls =
  'w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600';

const Section: React.FC<{ title: string; desc?: string; children: React.ReactNode }> = ({ title, desc, children }) => (
  <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-7 mb-4">
    <h3 className="text-sm md:text-base font-black text-slate-900">{title}</h3>
    {desc && <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>}
    <div className="mt-5 space-y-5">{children}</div>
  </section>
);

const Row: React.FC<{ label: string; required?: boolean; children: React.ReactNode; hint?: string }> = ({ label, required, children, hint }) => (
  <div className="grid md:grid-cols-[140px_1fr] gap-2 md:gap-4 md:items-start">
    <label className="text-xs font-bold text-slate-700 md:pt-3">
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1.5">{hint}</p>}
    </div>
  </div>
);

const NumberInput: React.FC<{ value: number; onChange: (n: number) => void; suffix: string; placeholder?: string; step?: string }> = ({ value, onChange, suffix, placeholder, step }) => (
  <div className="relative">
    <input
      className={`${inputCls} pr-10 text-right`}
      inputMode="decimal"
      step={step}
      placeholder={placeholder}
      value={value ? (suffix === '%' ? String(value) : value.toLocaleString('ko-KR')) : ''}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9.]/g, '');
        onChange(raw === '' ? 0 : suffix === '%' ? Number(raw) : Math.round(Number(raw)));
      }}
    />
    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{suffix}</span>
  </div>
);

const STATUS_CHOICES: { value: ProductStatus; label: string; desc: string }[] = [
  { value: 'on_sale', label: '판매중', desc: '인플루언서에게 노출되고 판매 신청을 받습니다.' },
  { value: 'paused', label: '판매중지', desc: '노출을 잠시 멈춥니다. 이미 승인된 인플루언서는 유지됩니다.' },
  { value: 'draft', label: '임시저장', desc: '등록만 해 두고 노출하지 않습니다.' },
];

const AffiliateProductEditor: React.FC<Props> = ({ businessUsername, taxonomy, feeRates, product, onClose, onSaved }) => {
  const [form, setForm] = useState<ProductInput>(() => toInput(product));
  const [useOptions, setUseOptions] = useState((product?.options?.length || 0) > 0);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm(f => ({ ...f, [k]: v }));

  const discount = form.retailPrice > 0 && form.salePrice > 0 && form.retailPrice > form.salePrice
    ? Math.round((1 - form.salePrice / form.retailPrice) * 100)
    : 0;
  const commissionAmount = Math.floor((form.salePrice * (form.commissionRate || 0)) / 100);
  // 1개 판매 시 예상 정산액(배송비 제외). PG 수수료는 결제 수단마다 다를 수 있어 높은 쪽으로 보수적으로 잡는다.
  const pgRate = feeRates ? Math.max(feeRates.pgCard, feeRates.pgKakaopay) : 0;
  // 픽스폴리오 수수료는 5%(운영 설정값). 설정을 아직 못 읽었으면 5%로 안내한다.
  const platformRate = feeRates ? feeRates.platform : 5;
  const platformFee = Math.floor((form.salePrice * platformRate) / 100);
  const pgFee = Math.floor((form.salePrice * pgRate) / 100);
  const estimate = form.salePrice - commissionAmount - pgFee - platformFee;
  const totalStock = useOptions ? form.options.reduce((s, o) => s + (Number(o.stock) || 0), 0) : form.stock;

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    const room = MAX_IMAGES - form.imageUrls.length;
    const picked = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, room);
    if (picked.length === 0) return;
    setUploading(true);
    const urls: string[] = [];
    for (const f of picked) {
      const url = await apiService.uploadImage(businessUsername, f, f.name);
      if (url) urls.push(url);
    }
    setUploading(false);
    if (urls.length < picked.length) setError('일부 이미지를 올리지 못했습니다. 5MB 이하 이미지로 다시 시도해 주세요.');
    setForm(f => ({ ...f, imageUrls: [...f.imageUrls, ...urls].slice(0, MAX_IMAGES) }));
    if (fileRef.current) fileRef.current.value = '';
  };

  const moveImage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= form.imageUrls.length) return;
    const next = [...form.imageUrls];
    [next[i], next[j]] = [next[j], next[i]];
    set('imageUrls', next);
  };

  const save = async (statusOverride?: ProductStatus) => {
    setError('');
    const payload: ProductInput = {
      ...form,
      status: statusOverride || form.status,
      options: useOptions ? form.options.filter(o => o.name.trim()) : [],
      stock: totalStock,
    };
    setSaving(true);
    const res = await affiliateStoreService.saveProduct(businessUsername, payload);
    setSaving(false);
    if (res.error || !res.product) {
      setError(res.error || '저장하지 못했습니다.');
      return;
    }
    onSaved(res.product);
  };

  return (
    <div className="max-w-4xl">
      <button onClick={onClose} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> 상품 목록
      </button>
      <h2 className="text-lg md:text-2xl font-black text-slate-900 mb-1">{product ? '상품 수정' : '상품 등록'}</h2>
      <p className="text-xs text-slate-500 mb-6">등록한 상품은 '판매중'으로 두면 인플루언서 어필리에이트 메뉴에 노출됩니다.</p>

      <Section title="기본 정보">
        <Row label="상품명" required>
          <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} maxLength={120} placeholder="예: 데일리 코튼 셔츠" />
          <p className="text-[10px] text-slate-400 text-right mt-1">{form.name.length}/120</p>
        </Row>
        <Row label="카테고리" required hint="인플루언서 화면에서 상위 → 하위 카테고리로 찾아볼 수 있어요.">
          <div className="grid grid-cols-2 gap-2">
            <select
              className={inputCls}
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
            >
              <option value="">상위 카테고리</option>
              {taxonomy.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select
              className={inputCls}
              value={form.subcategory}
              disabled={!form.category}
              onChange={e => set('subcategory', e.target.value)}
            >
              <option value="">하위 카테고리</option>
              {(taxonomy.find(c => c.name === form.category)?.subs || []).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </Row>
        <Row label="한 줄 소개" hint="상품 목록에 이름 아래로 보이는 짧은 설명입니다.">
          <input className={inputCls} value={form.summary} onChange={e => set('summary', e.target.value)} maxLength={200} placeholder="예: 구김 적은 데일리 셔츠, 4가지 컬러" />
        </Row>
        <Row label="상품 상세 주소" hint="자사몰 등 실제 판매 페이지 주소가 있으면 입력해 주세요.">
          <input className={inputCls} value={form.productUrl} onChange={e => set('productUrl', e.target.value.trim())} placeholder="https://" inputMode="url" />
        </Row>
      </Section>

      <Section title="상품 이미지" desc={`첫 번째 이미지가 대표 이미지입니다. 최대 ${MAX_IMAGES}장까지 올릴 수 있어요.`}>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2.5">
          {form.imageUrls.map((u, i) => (
            <div key={u + i} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50 group">
              <img src={u} alt="" className="w-full h-full object-cover" />
              {i === 0 && <span className="absolute top-1.5 left-1.5 bg-blue-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded">대표</span>}
              <button
                type="button"
                onClick={() => set('imageUrls', form.imageUrls.filter((_, j) => j !== i))}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                aria-label="이미지 삭제"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="absolute bottom-1.5 inset-x-1.5 flex justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => moveImage(i, -1)} className="w-6 h-6 rounded bg-white/90 text-xs font-black">‹</button>
                <button type="button" onClick={() => moveImage(i, 1)} className="w-6 h-6 rounded bg-white/90 text-xs font-black">›</button>
              </div>
            </div>
          ))}
          {form.imageUrls.length < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="aspect-square rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-blue-400 hover:text-blue-500 flex flex-col items-center justify-center gap-1 text-[11px] font-bold"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
              {uploading ? '올리는 중' : '이미지 추가'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => uploadFiles(e.target.files)} />
      </Section>

      <Section title="판매 정보" desc="정산 시 인플루언서 수수료, 픽스폴리오 수수료, 카드 결제 수수료를 각각 차감한 금액이 지급됩니다.">
        <Row label="정가(소비자가)" required>
          <NumberInput value={form.retailPrice} onChange={n => set('retailPrice', n)} suffix="원" placeholder="0" />
        </Row>
        <Row label="판매가" required hint={discount > 0 ? `정가 대비 ${discount}% 할인` : undefined}>
          <NumberInput value={form.salePrice} onChange={n => set('salePrice', n)} suffix="원" placeholder="0" />
        </Row>
        <Row label="인플루언서 수수료" required hint={commissionAmount > 0 ? `1개 판매 시 인플루언서 수수료 약 ${won(commissionAmount)}` : '판매가 대비 %로 입력해 주세요.'}>
          <NumberInput value={form.commissionRate} onChange={n => set('commissionRate', Math.min(90, n))} suffix="%" placeholder="예: 15" />
        </Row>
        {/* 인플루언서 수수료와 별도로 붙는 수수료 — 수수료율을 정할 때 함께 보이게 둔다. */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 text-xs">
          <p className="font-black text-slate-900 mb-2">수수료는 각각 별도로 차감됩니다</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400">인플루언서 수수료</p>
              <p className="text-sm font-black text-slate-900">{form.commissionRate || 0}% <span className="text-[10px] font-bold text-slate-400">직접 입력</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-2 border border-blue-200">
              <p className="text-[10px] font-bold text-blue-500">픽스폴리오 수수료</p>
              <p className="text-sm font-black text-blue-700">{platformRate}% <span className="text-[10px] font-bold text-blue-400">별도</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400">카드 결제 수수료</p>
              <p className="text-sm font-black text-slate-900">{feeRates ? `${pgRate}%` : '결제 수단별'} <span className="text-[10px] font-bold text-slate-400">별도</span></p>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">인플루언서 수수료 · 픽스폴리오 수수료는 판매가(배송비 제외) 기준, 카드 결제 수수료는 결제 금액 기준입니다.</p>
        </div>
        <Row label="배송비" hint="0원이면 무료배송으로 표시됩니다.">
          <NumberInput value={form.shippingFee} onChange={n => set('shippingFee', n)} suffix="원" placeholder="0" />
        </Row>
        {form.salePrice > 0 && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-xs space-y-1">
            <p className="text-sm font-black text-slate-900">1개 판매 시 예상 정산액 <span className="text-blue-600">{won(Math.max(0, estimate))}</span></p>
            <p className="text-slate-500">배송비 제외 기준 · 판매가 {won(form.salePrice)}</p>
            <div className="grid grid-cols-3 gap-2 pt-1 text-slate-600">
              <span>인플루언서 수수료 −{won(commissionAmount)}</span>
              <span>픽스폴리오 수수료({platformRate}%) −{won(platformFee)}</span>
              <span>카드 결제 수수료{feeRates ? `(${pgRate}%)` : ''} −{won(pgFee)}</span>
            </div>
            <p className="text-[10px] text-slate-400 pt-1">실제 정산액은 주문 시점 수수료율과 결제 수단(카드 {feeRates?.pgCard ?? '-'}% · 카카오페이 {feeRates?.pgKakaopay ?? '-'}%)으로 계산되며, 배송비를 받은 주문은 배송비에도 PG 수수료가 붙습니다.</p>
          </div>
        )}
      </Section>

      <Section title="재고 · 옵션">
        <Row label="옵션 사용">
          <div className="flex gap-2">
            {[false, true].map(v => (
              <button
                key={String(v)}
                type="button"
                onClick={() => {
                  setUseOptions(v);
                  if (v && form.options.length === 0) set('options', [{ name: '', stock: 0 }]);
                }}
                className={`h-10 px-4 rounded-lg border text-xs font-bold ${useOptions === v ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}
              >
                {v ? '옵션 사용' : '옵션 없음'}
              </button>
            ))}
          </div>
        </Row>
        {!useOptions ? (
          <Row label="재고 수량" required>
            <NumberInput value={form.stock} onChange={n => set('stock', n)} suffix="개" placeholder="0" />
          </Row>
        ) : (
          <Row label="옵션별 재고" required hint={`총 재고 ${totalStock.toLocaleString('ko-KR')}개`}>
            <div className="space-y-2">
              {form.options.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={inputCls}
                    value={o.name}
                    placeholder="옵션명 (예: 블랙 / M)"
                    maxLength={80}
                    onChange={e => set('options', form.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <div className="w-32 shrink-0">
                    <NumberInput
                      value={o.stock}
                      onChange={n => set('options', form.options.map((x, j) => (j === i ? { ...x, stock: n } : x)))}
                      suffix="개"
                      placeholder="0"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => set('options', form.options.filter((_, j) => j !== i))}
                    className="w-11 h-11 shrink-0 rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 flex items-center justify-center"
                    aria-label="옵션 삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {form.options.length < 50 && (
                <button
                  type="button"
                  onClick={() => set('options', [...form.options, { name: '', stock: 0 }])}
                  className="h-10 px-3 rounded-lg border border-dashed border-slate-300 text-xs font-bold text-slate-500 hover:border-blue-500 hover:text-blue-600 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> 옵션 추가
                </button>
              )}
            </div>
          </Row>
        )}
      </Section>

      <Section title="상세 설명" desc="소재 · 사이즈 · 사용법 · 셀링 포인트 등 인플루언서가 콘텐츠를 만들 때 참고할 내용을 적어 주세요.">
        <textarea
          className="w-full min-h-[200px] p-3.5 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
          value={form.description}
          onChange={e => set('description', e.target.value)}
          maxLength={5000}
          placeholder="상품 상세 설명을 입력해 주세요."
        />
        <p className="text-[10px] text-slate-400 text-right -mt-3">{form.description.length}/5000</p>
      </Section>

      <Section title="판매 상태">
        <div className="grid md:grid-cols-3 gap-2">
          {STATUS_CHOICES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => set('status', s.value)}
              className={`text-left p-3.5 rounded-xl border ${form.status === s.value ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}
            >
              <p className={`text-sm font-black ${form.status === s.value ? 'text-blue-700' : 'text-slate-800'}`}>{s.label}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{s.desc}</p>
            </button>
          ))}
        </div>
      </Section>

      {error && <p className="text-xs font-bold text-red-500 mb-3">{error}</p>}
      <div className="sticky bottom-20 md:bottom-4 flex justify-end gap-2 bg-[#f8fafc]/90 backdrop-blur py-3">
        <button onClick={onClose} className="h-11 px-5 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-600">취소</button>
        <button
          onClick={() => save()}
          disabled={saving || uploading}
          className="h-11 px-6 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {product ? '수정 저장' : '상품 등록'}
        </button>
      </div>
    </div>
  );
};

export default AffiliateProductEditor;

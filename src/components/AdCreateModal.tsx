import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Trash2, Upload, X } from 'lucide-react';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { formatKoreanWon } from '../utils/formatters';
import {
  AD_OBJECTIVES,
  AdBoost,
  AdCta,
  AdObjective,
  DEFAULT_AD_OBJECTIVE,
  MOCK_AD_PAGES,
  ctaLabel,
  ctasForObjective,
  findObjective,
} from '../utils/adBoosts';
import { MetaAdAccount } from '../utils/adAccounts';
import { formatFileSize, makeCreativeThumbnail } from '../utils/creativeThumbnail';
import { AdDeliveryFields, inputCls, labelCls, selectCls, useAdDelivery } from './AdDeliveryFields';

/**
 * 직접 소재 업로드 창 — 브랜드가 만든 소재로 광고를 만드는 설정.
 *
 * 부스팅은 이력에 게시물이 있어야 시작된다. 그런데 브랜드가 광고로 돌리고 싶은 소재가
 * 캠페인에서만 나오는 것은 아니다 — 자체 촬영물, 이전에 쓰던 영상, 인플루언서 콘텐츠가
 * 아직 없는 신제품. 그 경우 지금까지는 광고 현황에서 할 수 있는 일이 없었고, 브랜드는
 * 메타 광고 관리자로 넘어가야 했다. 이 창은 그 길을 광고 현황 안으로 가져온다.
 *
 * 부스팅과 다른 점은 위쪽뿐이다. 무엇을 광고할지(소재), 무엇을 목적으로 돌릴지, 어떤
 * 문구로 보일지, 눌렀을 때 어디로 갈지를 여기서 다 정해야 한다 — 게시물이 대신 정해
 * 주는 값이 없기 때문이다. 아래쪽(예산 · 기간 · 타겟 · 노출 위치)은 부스팅과 같은
 * 값이라 같은 컴포넌트(AdDeliveryFields)를 그대로 쓴다.
 *
 * 목적을 맨 위에 둔다. 목적이 CTA 문구 순서와 창 위쪽 안내를 바꾸고, 집행 후 광고
 * 현황에서 어떤 지표를 봐야 하는지도 목적이 정한다. 기본값은 전환 — 부스팅과 같은
 * 이유로, 소재에 돈을 붙이는 이유가 대개 판매다.
 *
 * 파일은 아직 올라가지 않는다(광고 집행 권한 심사 전이라 소재를 보낼 데가 없다).
 * 고른 파일에서 미리보기만 만들어 광고 현황 카드에 쓰고, 집행 요청은 부스팅과 똑같이
 * '집행 요청' 상태로 목록에 올린다.
 */

interface AdCreateModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * 이 광고가 들어갈 광고 계정. 광고 현황에서 보고 있는 계정을 그대로 받는다 —
   * 계정을 고르는 드롭다운은 바로 위 화면에 이미 있어서 여기서 또 묻지 않는다.
   */
  account?: MetaAdAccount | null;
  /** 집행 요청이 만들어졌을 때. 광고 현황 목록에 올리는 일은 부모가 한다. */
  onSubmitted: (boost: AdBoost) => void;
}

/** 소재로 받는 파일. 메타가 광고 소재로 받는 형식만 둔다. */
const ACCEPT = 'image/*,video/*';

const AdCreateModal: React.FC<AdCreateModalProps> = ({ open, onClose, account, onSubmitted }) => {
  const [objective, setObjective] = useState<AdObjective>(DEFAULT_AD_OBJECTIVE);
  const [file, setFile] = useState<File | null>(null);
  /** 창이 열려 있는 동안의 미리보기(blob URL). 저장하는 값과는 다르다. */
  const [previewUrl, setPreviewUrl] = useState('');
  /** 목록에 남기는 작은 미리보기(data URL). 파일을 고른 뒤 만들어 둔다. */
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [headline, setHeadline] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [cta, setCta] = useState<AdCta>(ctasForObjective(DEFAULT_AD_OBJECTIVE)[0].value);
  /** 브랜드가 CTA 를 직접 골랐는지. 고른 뒤에는 목적을 바꿔도 그 문구를 지킨다. */
  const [ctaPicked, setCtaPicked] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [pageId, setPageId] = useState<string>(MOCK_AD_PAGES[0].id);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const delivery = useAdDelivery();

  useCloseOnBack(open, onClose);

  // blob URL 은 창을 닫을 때 놓아 준다 — 파일을 여러 번 바꿔 고르면 그만큼 쌓인다.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const objectiveNotice = findObjective(objective)?.notice;
  const ctaOptions = ctasForObjective(objective);
  const page = MOCK_AD_PAGES.find((p) => p.id === pageId) || MOCK_AD_PAGES[0];
  const isVideo = !!file?.type.startsWith('video/');

  /**
   * 목적을 바꾸면 추천 문구가 바뀐다. 아직 직접 고르지 않았다면 맨 위 문구로 따라가고,
   * 골라 둔 뒤에는 그대로 둔다 — 브랜드가 정한 문구를 목적 때문에 되돌리지 않는다.
   */
  const pickObjective = (next: AdObjective) => {
    setObjective(next);
    if (!ctaPicked) setCta(ctasForObjective(next)[0].value);
  };

  const takeFile = (next: File | null) => {
    if (!next) return;
    if (!next.type.startsWith('image/') && !next.type.startsWith('video/')) {
      setError('영상 또는 이미지 파일만 올릴 수 있습니다.');
      return;
    }
    setError('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(next);
    setFile(next);
    setPreviewUrl(url);
    setThumbnailUrl('');
    // 목록에 남길 작은 미리보기는 여기서 미리 만들어 둔다. 실패해도 그냥 둔다 —
    // 썸네일이 없다고 집행을 막지는 않는다.
    makeCreativeThumbnail(next, url).then(setThumbnailUrl).catch(() => {});
  };

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    setThumbnailUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** 주소를 적기만 하면 되도록, http(s) 가 없으면 https 로 붙여 준다. */
  const normalizedLink = (): string => {
    const raw = linkUrl.trim();
    if (!raw) return '';
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(withScheme);
      return parsed.hostname.includes('.') ? parsed.toString() : '';
    } catch {
      return '';
    }
  };

  const submit = async () => {
    if (!file) {
      setError('광고로 쓸 영상 또는 이미지를 올려 주세요.');
      return;
    }
    if (!headline.trim()) {
      setError('광고 제목을 입력해 주세요.');
      return;
    }
    const link = normalizedLink();
    if (!link) {
      setError('연결 URL 을 확인해 주세요. 예: https://brand.co.kr/summer');
      return;
    }
    const invalid = delivery.validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setSubmitting(true);

    // 부스팅과 같다 — 연동 전이라 실제 집행은 없고, 버튼을 누른 뒤의 흐름만 확인한다.
    await new Promise((r) => setTimeout(r, 700));

    onSubmitted({
      id: `ad_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      requestedAt: new Date().toISOString(),
      source: 'own',
      objective,
      creativeName: file.name,
      creativeKind: isVideo ? 'video' : 'image',
      thumbnailUrl,
      headline: headline.trim(),
      bodyText: bodyText.trim(),
      cta,
      linkUrl: link,
      pageId,
      // 계정이 없으면 비워 둔다. 광고 현황이 계정 없는 요청을 어느 계정에서든
      // 보여 주므로, 연동 전이라는 이유로 집행 요청을 막지는 않는다.
      adAccountId: account?.id,
      ...delivery.payload(),
    });

    setSubmitting(false);
    setDone(true);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 max-h-[90vh] modal-maxh-90 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-black text-slate-900">직접 소재 업로드</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              브랜드가 가진 영상·이미지로 광고를 만듭니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="p-6 md:p-8 text-center overflow-y-auto">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-emerald-600" strokeWidth={3} />
            </div>
            <p className="text-sm font-black text-slate-900 mt-3">집행 요청이 접수되었습니다</p>
            <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed">
              {headline.trim()} · {findObjective(objective)?.label}
              <br />
              예산 {formatKoreanWon(delivery.budgetKrw)} · {delivery.startDate} ~ {delivery.endDate}
              <br />
              {page.name} · {ctaLabel(cta)}
              {account && (
                <>
                  <br />
                  {account.name} · {account.id}
                </>
              )}
            </p>
            <p className="text-[11px] text-amber-600 font-bold mt-3 leading-relaxed">
              메타 광고 집행 권한 심사 전이라 실제 노출은 아직 시작되지 않습니다. 광고 현황에
              '요청' 상태로 올라가고, 심사가 끝나면 이 요청이 그대로 집행됩니다.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full py-3 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800 transition-colors"
            >
              광고 현황으로 돌아가기
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto px-5 py-4 space-y-5">
              {/* 목적이 먼저다 — CTA 문구 순서와 아래 안내가 이 값에 따라 바뀐다. */}
              <div>
                <p className={labelCls}>광고 목적</p>
                <div className="grid grid-cols-3 gap-1.5 mt-1.5" role="radiogroup" aria-label="광고 목적">
                  {AD_OBJECTIVES.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={objective === o.value}
                      onClick={() => pickObjective(o.value)}
                      className={`py-2 rounded-xl text-[11px] font-black border transition-colors ${
                        objective === o.value
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 고른 목적으로 메타가 무엇을 하는지. 부스팅 창의 같은 자리·같은 모양이다. */}
              {objectiveNotice && (
                <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
                  <p className="text-[12px] font-black text-blue-800">{objectiveNotice.title}</p>
                  <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
                    {objectiveNotice.body}
                  </p>
                </div>
              )}

              {/* 소재. 실제 업로드는 없고 미리보기까지만 한다. */}
              <div>
                <p className={labelCls}>광고 소재</p>
                {file ? (
                  <div className="mt-1.5 flex items-start gap-3 bg-slate-50 rounded-2xl p-3">
                    {isVideo ? (
                      <video
                        src={previewUrl}
                        muted
                        playsInline
                        controls
                        className="w-20 aspect-[9/16] rounded-xl object-cover bg-slate-900 flex-shrink-0"
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt=""
                        className="w-20 aspect-[9/16] rounded-xl object-cover bg-slate-200 flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-black text-slate-900 break-all leading-snug">{file.name}</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                        {isVideo ? '영상' : '이미지'}
                        {formatFileSize(file.size) ? ` · ${formatFileSize(file.size)}` : ''}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          파일 바꾸기
                        </button>
                        <button
                          type="button"
                          onClick={clearFile}
                          aria-label="소재 삭제"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-400 hover:bg-slate-50 transition-colors flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      takeFile(e.dataTransfer.files?.[0] || null);
                    }}
                    className={`mt-1.5 w-full rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
                      dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <Upload className={`w-5 h-5 mx-auto ${dragging ? 'text-blue-500' : 'text-slate-400'}`} />
                    <p className="text-[12px] font-black text-slate-600 mt-2">
                      영상 또는 이미지를 끌어다 놓으세요
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold mt-1">
                      눌러서 파일을 고를 수도 있습니다 · mp4 · jpg · png
                    </p>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => takeFile(e.target.files?.[0] || null)}
                />
                <p className="text-[10px] text-slate-400 font-medium mt-1.5 leading-relaxed">
                  지금은 미리보기까지만 만들어 둡니다. 광고 집행 권한 심사가 끝나면 이 파일이 소재로
                  올라가고, 심사 전까지는 파일이 브랜드 기기 밖으로 나가지 않습니다.
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-headline">광고 제목</label>
                <input
                  id="create-headline"
                  value={headline}
                  maxLength={40}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="예: 여름 신상 원피스 30% 할인"
                  className={inputCls}
                />
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  소재 아래 굵게 보이는 한 줄입니다 · {headline.length}/40
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-body">광고 본문</label>
                <textarea
                  id="create-body"
                  value={bodyText}
                  maxLength={300}
                  rows={4}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="소재와 함께 보여 줄 설명을 적어 주세요."
                  className={`${inputCls} leading-relaxed resize-none`}
                />
                <p className="text-[10px] text-slate-400 font-bold mt-1">{bodyText.length}/300</p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-cta">CTA 버튼 문구</label>
                <div className="relative mt-1.5">
                  <select
                    id="create-cta"
                    value={cta}
                    onChange={(e) => { setCta(e.target.value as AdCta); setCtaPicked(true); }}
                    className={selectCls}
                  >
                    {ctaOptions.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  {findObjective(objective)?.label} 목적에 맞는 문구가 위에 있습니다
                  {ctaOptions[0].value !== cta ? ` · 추천 ${ctaOptions[0].label}` : ''}
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-link">연결 URL</label>
                <input
                  id="create-link"
                  type="url"
                  inputMode="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://brand.co.kr/summer"
                  className={inputCls}
                />
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  '{ctaLabel(cta)}' 를 누르면 가는 주소입니다. 필수입니다.
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-page">광고 페이지</label>
                <div className="relative mt-1.5">
                  <select
                    id="create-page"
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    className={selectCls}
                  >
                    {MOCK_AD_PAGES.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · @{p.handle}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  이 페이지 이름으로 광고가 보입니다
                  {account ? ` · ${account.name} 계정으로 집행` : ''}
                </p>
              </div>

              {/*
                계정이 없으면(연동 전) 어느 계정으로 나갈지가 아직 정해지지 않는다.
                집행 요청 자체는 막지 않고, 정해지는 시점만 적어 둔다 — 부스팅 창과 같다.
              */}
              {!account && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                  <p className="text-[11px] font-black text-amber-800">
                    Meta 광고 계정이 아직 정해지지 않았습니다
                  </p>
                  <p className="text-[10px] text-amber-700 font-medium mt-0.5 leading-relaxed">
                    광고 현황에서 Meta 계정을 연동하고 광고 계정을 고르면, 지금 요청한 집행이 그 계정으로
                    들어갑니다. 요청은 그때까지 이 목록에 그대로 남습니다.
                  </p>
                </div>
              )}

              {/* 여기서부터는 부스팅 창과 같은 항목·같은 검증이다. */}
              <AdDeliveryFields delivery={delivery} idPrefix="create" />
            </div>

            <div className="border-t border-slate-100 px-5 py-4 bg-white">
              {error && <p className="text-[11px] text-rose-500 font-black mb-2">{error}</p>}
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? '집행 요청 중' : '집행하기'}
              </button>
              <p className="text-[10px] text-slate-400 font-medium mt-2 text-center leading-relaxed">
                메타 광고 집행 권한 심사 전이라 실제 노출은 시작되지 않습니다.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdCreateModal;

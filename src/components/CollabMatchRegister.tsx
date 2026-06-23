import React, { useState } from 'react';

// 캠페인 협업 "매칭 받기" 등록 버튼 + 모달.
// variant 로 역할을 고정한다:
//  - 'influencer' : 유저(크리에이터) 대시보드에서 사용. 항상 인플루언서로 지원하며
//    버튼/모달은 "브랜드 매칭 받기" 로 표시한다.
//  - 'brand'      : 비즈니스 대시보드에서 사용. 항상 브랜드(광고주)로 지원하며
//    버튼/모달은 "인플루언서 매칭 받기" 로 표시한다.
// 지원 유형 선택 UI 는 더 이상 노출하지 않는다(역할 고정).
interface Props {
  variant: 'influencer' | 'brand';
  applicantUsername: string;
  buttonClassName?: string;
}

const COPY = {
  influencer: {
    title: '브랜드 매칭 받기',
    subtitle: '내 채널 정보를 등록하면 조건에 맞는 브랜드를 매칭해 드립니다.',
  },
  brand: {
    title: '인플루언서 매칭 받기',
    subtitle: '원하는 조건을 등록하면 조건에 맞는 인플루언서를 매칭해 드립니다.',
  },
} as const;

const CollabMatchRegister: React.FC<Props> = ({ variant, applicantUsername, buttonClassName }) => {
  const copy = COPY[variant];
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [infForm, setInfForm] = useState({
    name: '', contact: '',
    instagram_url: '', instagram_followers: '',
    youtube_url: '', youtube_followers: '',
    tiktok_url: '', tiktok_followers: '',
    naver_blog_url: '',
    post_price: '', short_price: '', category: '',
  });
  const [brandForm, setBrandForm] = useState({
    name: '', contact: '', brand_homepage: '', brand_instagram: '', desired_count: '',
    desired_followers: '', budget_text: '', desired_schedule: '', desired_category: '', note: '',
  });

  const reset = () => {
    setInfForm({
      name: '', contact: '', instagram_url: '', instagram_followers: '', youtube_url: '', youtube_followers: '',
      tiktok_url: '', tiktok_followers: '', naver_blog_url: '', post_price: '', short_price: '', category: '',
    });
    setBrandForm({
      name: '', contact: '', brand_homepage: '', brand_instagram: '', desired_count: '',
      desired_followers: '', budget_text: '', desired_schedule: '', desired_category: '', note: '',
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = variant === 'influencer'
        ? { role: 'influencer', applicant_username: applicantUsername, ...infForm }
        : { role: 'brand', applicant_username: applicantUsername, ...brandForm, budget: brandForm.budget_text };
      if (!payload.name?.trim()) {
        alert(variant === 'influencer' ? '이름을 입력해 주세요.' : '담당자/브랜드명을 입력해 주세요.');
        setSubmitting(false);
        return;
      }
      const res = await fetch('/api/collab-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setOpen(false);
        reset();
        alert('접수되었습니다. 운영자 검토 후 연락드립니다!');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '등록에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={buttonClassName ?? 'w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-sm py-3 shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)] hover:from-blue-700 hover:to-indigo-700 active:scale-[0.99] transition-all'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
        {copy.title}
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4" onClick={() => !submitting && setOpen(false)}>
          <div
            className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom md:fade-in duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h3 className="text-base font-black text-slate-900">{copy.title}</h3>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">{copy.subtitle}</p>
              </div>
              <button onClick={() => !submitting && setOpen(false)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5">
              {variant === 'influencer' ? (
                <div className="space-y-3">
                  <Field label="이름" required value={infForm.name} onChange={v => setInfForm(f => ({ ...f, name: v }))} placeholder="홍길동" />
                  <Field label="연락처" value={infForm.contact} onChange={v => setInfForm(f => ({ ...f, contact: v }))} placeholder="010-0000-0000 / 이메일" />

                  <div className="pt-1">
                    <p className="text-xs font-black text-slate-500 mb-2">내 채널 · 팔로워 수</p>
                    <div className="space-y-2.5">
                      <ChannelRow
                        label="인스타그램" urlPlaceholder="https://instagram.com/..."
                        url={infForm.instagram_url} onUrl={v => setInfForm(f => ({ ...f, instagram_url: v }))}
                        followers={infForm.instagram_followers} onFollowers={v => setInfForm(f => ({ ...f, instagram_followers: v }))}
                      />
                      <ChannelRow
                        label="유튜브" urlPlaceholder="https://youtube.com/@..." followerPlaceholder="구독자"
                        url={infForm.youtube_url} onUrl={v => setInfForm(f => ({ ...f, youtube_url: v }))}
                        followers={infForm.youtube_followers} onFollowers={v => setInfForm(f => ({ ...f, youtube_followers: v }))}
                      />
                      <ChannelRow
                        label="틱톡" urlPlaceholder="https://tiktok.com/@..."
                        url={infForm.tiktok_url} onUrl={v => setInfForm(f => ({ ...f, tiktok_url: v }))}
                        followers={infForm.tiktok_followers} onFollowers={v => setInfForm(f => ({ ...f, tiktok_followers: v }))}
                      />
                      <Field label="네이버 블로그" value={infForm.naver_blog_url} onChange={v => setInfForm(f => ({ ...f, naver_blog_url: v }))} placeholder="https://blog.naver.com/..." />
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium leading-relaxed mt-2">
                      팔로워 수는 인스타/틱톡 링크에서 자동 확인을 시도하며, 확인이 어려운 경우 입력하신 값으로 분류됩니다.
                    </p>
                  </div>

                  <div className="pt-1">
                    <p className="text-xs font-black text-slate-500 mb-2">광고 단가</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="게시물 단가" value={infForm.post_price} onChange={v => setInfForm(f => ({ ...f, post_price: v }))} placeholder="예: 30만원" />
                      <Field label="숏폼 단가" value={infForm.short_price} onChange={v => setInfForm(f => ({ ...f, short_price: v }))} placeholder="예: 50만원" />
                    </div>
                  </div>

                  <Field label="카테고리" value={infForm.category} onChange={v => setInfForm(f => ({ ...f, category: v }))} placeholder="뷰티, 패션 등" />
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="담당자 이름 / 브랜드명" required value={brandForm.name} onChange={v => setBrandForm(f => ({ ...f, name: v }))} placeholder="브랜드명 또는 담당자" />
                  <Field label="연락처" value={brandForm.contact} onChange={v => setBrandForm(f => ({ ...f, contact: v }))} placeholder="010-0000-0000 / 이메일" />
                  <Field label="브랜드 홈페이지" value={brandForm.brand_homepage} onChange={v => setBrandForm(f => ({ ...f, brand_homepage: v }))} placeholder="https://..." />
                  <Field label="브랜드 인스타 링크" value={brandForm.brand_instagram} onChange={v => setBrandForm(f => ({ ...f, brand_instagram: v }))} placeholder="https://instagram.com/..." />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="희망 인원" value={brandForm.desired_count} onChange={v => setBrandForm(f => ({ ...f, desired_count: v }))} placeholder="예: 5명" />
                    <Field label="원하는 팔로워" value={brandForm.desired_followers} onChange={v => setBrandForm(f => ({ ...f, desired_followers: v }))} placeholder="예: 1만~5만" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="예산" value={brandForm.budget_text} onChange={v => setBrandForm(f => ({ ...f, budget_text: v }))} placeholder="예: 500만원" />
                    <Field label="원하는 일정" type="date" value={brandForm.desired_schedule} onChange={v => setBrandForm(f => ({ ...f, desired_schedule: v }))} />
                  </div>
                  <Field label="원하는 인플루언서 카테고리" value={brandForm.desired_category} onChange={v => setBrandForm(f => ({ ...f, desired_category: v }))} placeholder="뷰티, 패션, 푸드 등" />
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5">추가 메모</label>
                    <textarea
                      value={brandForm.note}
                      onChange={e => setBrandForm(f => ({ ...f, note: e.target.value }))}
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
                      placeholder="캠페인 상세, 요청 사항 등"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full mt-5 rounded-xl bg-blue-600 text-white font-black text-sm py-3.5 hover:bg-blue-700 active:scale-[0.99] transition-all disabled:opacity-60"
              >
                {submitting ? '접수 중...' : '지원하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// 채널 링크(넓게) + 팔로워 수(좁게)를 한 줄에 배치하는 입력 행
const ChannelRow: React.FC<{
  label: string; url: string; onUrl: (v: string) => void;
  followers: string; onFollowers: (v: string) => void;
  urlPlaceholder?: string; followerPlaceholder?: string;
}> = ({ label, url, onUrl, followers, onFollowers, urlPlaceholder, followerPlaceholder = '팔로워' }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 mb-1.5">{label}</label>
    <div className="flex gap-2">
      <input
        value={url}
        onChange={e => onUrl(e.target.value)}
        placeholder={urlPlaceholder}
        className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
      />
      <input
        value={followers}
        onChange={e => onFollowers(e.target.value.replace(/[^\d]/g, ''))}
        inputMode="numeric"
        placeholder={followerPlaceholder}
        className="w-24 shrink-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
      />
    </div>
  </div>
);

const Field: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}> = ({ label, value, onChange, placeholder, type = 'text', required }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 mb-1.5">
      {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
    />
  </div>
);

export default CollabMatchRegister;

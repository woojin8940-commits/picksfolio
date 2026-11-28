import React, { useCallback, useEffect, useState } from 'react';
import { brandTeamService, type TeamOverview } from '../services/brandTeamService';
import { BRAND_SEAT_PRICE } from '../utils/membershipTiers';
import { isNativeApp } from '../utils/appEnv';
import { useLanguage } from '../contexts/LanguageContext';

interface BrandTeamManagementProps {
  onOpenMembership?: () => void;
}

const won = (n: number) => `${Math.max(0, Math.round(n)).toLocaleString()}원`;

const formatDate = (iso: string | null | undefined, language: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(language === 'en' ? 'en-US' : language === 'ja' ? 'ja-JP' : 'ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
};

/** 서버(brand-seats.proratedSeatAmount)와 같은 계산 — 화면 안내용 예상 금액. */
const estimateProrated = (seats: number, nextBillingIso: string | null) => {
  const full = BRAND_SEAT_PRICE * seats;
  const next = nextBillingIso ? Date.parse(nextBillingIso) : NaN;
  const now = Date.now();
  if (!Number.isFinite(next) || next <= now) return full;
  const startDate = new Date(next);
  startDate.setUTCMonth(startDate.getUTCMonth() - 1);
  const cycle = next - startDate.getTime();
  if (cycle <= 0) return full;
  return Math.max(100, Math.round((full * Math.min(1, (next - now) / cycle)) / 10) * 10);
};

const BrandTeamManagement: React.FC<BrandTeamManagementProps> = ({ onOpenMembership }) => {
  const { language } = useLanguage();
  const [data, setData] = useState<TeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seatCount, setSeatCount] = useState(1);
  const [reduceTo, setReduceTo] = useState<number | null>(null);
  const [inviteLabel, setInviteLabel] = useState('');
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await brandTeamService.overview();
    if (res.success) {
      setData(res);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fn();
    if (!res.success) setError(res.error || '요청을 처리하지 못했습니다.');
    else if (done) setNotice(done);
    await load();
    setBusy(false);
    return res.success;
  };

  if (loading) {
    return (
      <main className="p-3 md:p-14 w-full">
        <div className="text-slate-400 text-sm font-bold">불러오는 중...</div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="p-3 md:p-14 w-full">
        <div className="max-w-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-xl px-4 py-3">
          {error || '팀원 정보를 불러오지 못했습니다.'}
        </div>
      </main>
    );
  }

  const viewerRole = data.viewer.teamRole;
  const isOwner = viewerRole === 'owner';
  // 역할은 회사 관리자 / 직원 두 가지뿐이다. 초대 · 내보내기 · 좌석 결제는 회사 관리자만 한다.
  // 팀 관리(초대 · 계정 삭제 · 관리자 변경)는 대표 계정과 관리자로 바뀐 직원이 한다. 좌석 결제는 대표 계정만.
  const canManage = isOwner || data.viewer.teamAdmin === true;
  const native = isNativeApp();
  const { plan, seats } = data;
  // 결제 좌석은 (직원 + 대기 초대) 중 등급 포함 좌석을 뺀 만큼 아래로 줄일 수 없다.
  const minimumSeats = Math.max(0, data.members.length + data.invites.length - (seats.included || 0));

  const purchase = async () => {
    const estimate = estimateProrated(seatCount, plan.nextBillingDate);
    const ok = window.confirm(
      `직원 좌석 ${seatCount}석을 추가합니다.\n\n지금 결제: 약 ${won(estimate)} (다음 결제일까지 남은 기간만큼)\n다음 달부터: 월 ${won(plan.nextMonthlyKrw + BRAND_SEAT_PRICE * seatCount)}\n\n등록된 결제 수단으로 바로 결제됩니다. 진행할까요?`,
    );
    if (!ok) return;
    await run(() => brandTeamService.addSeats(seatCount), `직원 좌석 ${seatCount}석을 추가했어요.`);
    setSeatCount(1);
  };

  const schedule = async (target: number) => {
    await run(
      () => brandTeamService.scheduleSeats(target),
      target === plan.extraSeats ? '좌석 줄이기 예약을 취소했어요.' : `다음 결제일부터 직원 좌석이 ${target}석으로 줄어들어요.`,
    );
    setReduceTo(null);
  };

  const createInvite = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCopied(false);
    const res = await brandTeamService.createInvite(inviteLabel);
    if (res.success) {
      setCreatedLink(res.url);
      setInviteLabel('');
    } else {
      setError(res.error);
    }
    await load();
    setBusy(false);
  };

  const copyLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="p-3 md:p-14 w-full animate-in fade-in duration-500">
      <header className="mb-8">
        <h2 className="text-xl md:text-3xl font-black text-slate-900">팀원 관리</h2>
        <p className="text-slate-500 mt-2 text-sm md:text-base leading-relaxed max-w-3xl">
          직원 좌석을 늘리고, 빈 좌석마다 초대 링크를 보내 직원 계정을 추가하세요. 직원은 링크로 자기 아이디와 비밀번호를 만들어 회사 워크스페이스에 들어옵니다.
        </p>
      </header>

      {notice && (
        <div className="mb-6 max-w-3xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold rounded-xl px-4 py-3">✓ {notice}</div>
      )}
      {error && (
        <div className="mb-6 max-w-3xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-xl px-4 py-3">{error}</div>
      )}

      {!plan.planActive ? (
        <section className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-2">멤버십을 구독하면 직원 계정을 추가할 수 있어요</h3>
          <p className="text-sm text-slate-500 leading-relaxed mb-5">
            {seats.included > 0
              ? `멤버십에는 관리자 계정 1개가 들어 있고, 직원 좌석 ${seats.included}석은 무료로 제공됩니다. 그 이상은 1석당 월 ${won(BRAND_SEAT_PRICE)}으로 늘릴 수 있습니다.`
              : `멤버십에는 관리자 계정 1개가 들어 있고, 직원 좌석은 1석당 월 ${won(BRAND_SEAT_PRICE)}으로 필요한 만큼 늘릴 수 있습니다.`}
          </p>
          {isOwner && onOpenMembership && !native && (
            <button
              type="button"
              onClick={onOpenMembership}
              className="px-5 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition-all text-sm"
            >
              멤버십 보기
            </button>
          )}
        </section>
      ) : (
        <>
          {/* 좌석 현황 */}
          <section className="max-w-3xl grid grid-cols-3 gap-2 md:gap-4 mb-6">
            {[
              { label: '전체 좌석', value: `${seats.total}석`, sub: seats.included > 0 ? `관리자 1 + 무료 ${seats.included} + 추가 ${seats.extra}` : `관리자 1 + 직원 ${seats.extra}` },
              { label: '사용 중', value: `${seats.used + 1}석`, sub: `직원 ${data.members.length} · 초대 ${data.invites.length}` },
              { label: '빈 좌석', value: `${seats.available}석`, sub: seats.available > 0 ? '바로 초대할 수 있어요' : '좌석을 추가해 주세요' },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
                <p className="text-[11px] md:text-xs font-black text-slate-400">{card.label}</p>
                <p className="text-xl md:text-2xl font-black text-slate-900 mt-1">{card.value}</p>
                <p className="text-[11px] text-slate-500 font-medium mt-1">{card.sub}</p>
              </div>
            ))}
          </section>

          <section className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm mb-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-xs font-black text-blue-500">다음 결제</p>
                <p className="text-lg font-black text-slate-900 mt-0.5">
                  월 {won(plan.nextMonthlyKrw)}
                  {plan.nextBillingDate && (
                    <span className="text-sm font-bold text-slate-500 ml-2">{formatDate(plan.nextBillingDate, language)}</span>
                  )}
                </p>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  {`멤버십 ${won(plan.baseMonthlyKrw)} + 직원 좌석 ${plan.scheduledSeats ?? plan.extraSeats}석 × ${won(plan.seatPriceKrw)}`}
                </p>
                {plan.scheduledSeats !== null && (
                  <p className="text-xs font-bold text-amber-600 mt-1">
                    다음 결제일부터 직원 좌석이 {plan.extraSeats}석 → {plan.scheduledSeats}석으로 줄어들어요.
                  </p>
                )}
                {plan.cancelAtPeriodEnd && (
                  <p className="text-xs font-bold text-amber-600 mt-1">해지 예약 중이라 좌석을 추가할 수 없어요.</p>
                )}
              </div>
            </div>

            {isOwner && !native && (
              <div className="mt-5 pt-5 border-t border-slate-100 grid md:grid-cols-2 gap-5">
                <div>
                  <p className="text-sm font-black text-slate-800 mb-2">직원 좌석 추가</p>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                      <button type="button" className="w-10 h-10 font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={seatCount <= 1 || busy} onClick={() => setSeatCount((n) => Math.max(1, n - 1))}>−</button>
                      <span className="w-10 text-center font-black text-slate-900">{seatCount}</span>
                      <button type="button" className="w-10 h-10 font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={seatCount >= 50 || busy} onClick={() => setSeatCount((n) => Math.min(50, n + 1))}>+</button>
                    </div>
                    <button
                      type="button"
                      onClick={purchase}
                      disabled={busy || plan.cancelAtPeriodEnd || plan.chargePending}
                      className="flex-1 h-10 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-all"
                    >
                      {seatCount}석 추가 결제
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mt-2 leading-relaxed">
                    지금은 다음 결제일까지 남은 기간만큼 약 {won(estimateProrated(seatCount, plan.nextBillingDate))}이 결제되고, 다음 달부터 1석당 월 {won(BRAND_SEAT_PRICE)}이 함께 청구됩니다.
                  </p>
                  {plan.chargePending && (
                    <p className="text-[11px] font-bold text-amber-600 mt-1">좌석 결제를 확인하는 중이에요. 잠시 후 새로고침해 주세요.</p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-black text-slate-800 mb-2">직원 좌석 줄이기</p>
                  {plan.extraSeats === 0 ? (
                    <p className="text-xs text-slate-500 font-medium">줄일 직원 좌석이 없어요.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <select
                          value={reduceTo ?? plan.scheduledSeats ?? plan.extraSeats}
                          onChange={(e) => setReduceTo(Number(e.target.value))}
                          className="h-10 flex-1 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-800 bg-white"
                          disabled={busy}
                        >
                          {Array.from({ length: plan.extraSeats + 1 }, (_, i) => i).map((n) => (
                            <option key={n} value={n} disabled={n < minimumSeats}>
                              {n}석{n === plan.extraSeats ? ' (지금 그대로)' : ''}{n < minimumSeats ? ' · 사용 중인 좌석보다 적음' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => schedule(reduceTo ?? plan.scheduledSeats ?? plan.extraSeats)}
                          disabled={busy || reduceTo === null}
                          className="h-10 px-4 rounded-xl font-bold text-sm border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          적용
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium mt-2 leading-relaxed">
                        이미 결제한 기간이 있어 다음 결제일부터 반영돼요(환불 없음). 직원과 대기 중인 초대보다 적게는 줄일 수 없어요.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
            {isOwner && native && (
              <p className="mt-4 text-xs text-slate-500 font-medium">좌석 결제는 PICKS Folio 웹사이트에서 할 수 있어요.</p>
            )}
          </section>

          {/* 초대 */}
          {canManage && (
            <section className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm mb-6">
              <h3 className="text-base font-black text-slate-900 mb-1">직원 초대</h3>
              <p className="text-xs text-slate-500 font-medium mb-4 leading-relaxed">
                빈 좌석마다 초대 링크를 하나씩 만들 수 있어요. 링크는 한 번만 쓸 수 있고 7일 뒤 만료됩니다.
              </p>
              {seats.available > 0 ? (
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    value={inviteLabel}
                    onChange={(e) => setInviteLabel(e.target.value)}
                    maxLength={40}
                    placeholder="누구에게 보낼 링크인지 (예: 마케팅팀 김지은)"
                    className="flex-1 h-11 border border-slate-200 rounded-xl px-3 text-sm font-medium text-slate-800"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={createInvite}
                    disabled={busy}
                    className="h-11 px-5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    초대 링크 만들기
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-500 font-medium">빈 좌석이 없어요. {isOwner ? '좌석을 추가하거나 ' : ''}직원 · 초대를 정리하면 다시 초대할 수 있어요.</p>
              )}

              {createdLink && (
                <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 p-4">
                  <p className="text-xs font-black text-blue-600 mb-2">초대 링크가 만들어졌어요 — 지금 복사해서 직원에게 보내 주세요</p>
                  <div className="flex flex-col md:flex-row gap-2">
                    <input readOnly value={createdLink} onFocus={(e) => e.currentTarget.select()} className="flex-1 h-10 rounded-lg border border-blue-200 bg-white px-3 text-xs font-mono text-slate-700" />
                    <button type="button" onClick={copyLink} className="h-10 px-4 rounded-lg font-bold text-sm text-blue-600 border border-blue-200 bg-white hover:bg-blue-100">
                      {copied ? '복사했어요' : '링크 복사'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mt-2">보안을 위해 이 링크는 다시 보여 드리지 않아요. 잃어버렸다면 초대를 취소하고 새로 만들어 주세요.</p>
                </div>
              )}

              {data.invites.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-black text-slate-400 mb-2">가입 대기 중인 초대</p>
                  <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {data.invites.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{inv.label || '이름 없는 초대'}</p>
                          <p className="text-[11px] text-slate-500 font-medium">{formatDate(inv.expiresAt, language)} 만료</p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => window.confirm('이 초대를 취소할까요? 링크는 더 이상 쓸 수 없고 좌석이 다시 비어요.') &&
                            run(() => brandTeamService.revokeInvite(inv.id), '초대를 취소했어요.')}
                          className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        >
                          초대 취소
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* 직원 목록 */}
      <section className="max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
        <h3 className="text-base font-black text-slate-900 mb-4">직원 {data.members.length}명</h3>
        {data.members.length === 0 ? (
          <p className="text-sm text-slate-500 font-medium">아직 들어온 직원이 없어요.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.members.map((m) => {
              const isSelf = !!data.viewer.memberUsername && data.viewer.memberUsername === m.memberUsername;
              const canRemove = canManage && !isSelf;
              return (
                <li key={m.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">
                      {m.displayName || m.memberUsername}
                      <span className="text-slate-400 font-medium ml-1.5">@{m.memberUsername}</span>
                      {isSelf && <span className="ml-1.5 text-[11px] font-black text-blue-500">나</span>}
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium">
                      {m.department ? `${m.department} · ` : ''}
                      {m.isAdmin ? <span className="font-black text-violet-600">관리자</span> : '직원'}
                      {!m.seated && <span className="ml-1.5 font-bold text-red-500">좌석 부족 — 로그인할 수 없어요</span>}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {canRemove && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => window.confirm(
                          m.isAdmin
                            ? `${m.displayName || m.memberUsername}님을 직원으로 바꿀까요? 직원 초대 · 계정 삭제 · 관리자 변경을 더 이상 할 수 없어요.`
                            : `${m.displayName || m.memberUsername}님을 관리자로 바꿀까요? 직원 초대 · 계정 삭제 · 관리자 변경을 함께 할 수 있어요. 좌석 결제와 멤버십 결제는 회사 대표 계정에서만 할 수 있어요.`,
                        ) &&
                          run(
                            () => brandTeamService.setAdmin(m.id, !m.isAdmin),
                            m.isAdmin ? '직원으로 바꿨어요.' : '관리자로 바꿨어요.',
                          )}
                        className="px-3 py-2 rounded-lg text-xs font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {m.isAdmin ? '직원으로 변경' : '관리자로 변경'}
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => window.confirm(`${m.displayName || m.memberUsername}님(${m.memberUsername}) 계정을 삭제할까요?\n\n· 계정이 삭제되어 이 아이디로는 더 이상 로그인할 수 없어요. 되돌릴 수 없습니다.\n· 맡고 있던 캠페인은 회사 대표 계정 담당으로 넘어와요.\n· 좌석은 추가 비용 없이 다시 비어요.`) &&
                          run(() => brandTeamService.removeMember(m.id), '직원 계정을 삭제했어요. 맡던 캠페인은 회사 대표 계정 담당으로 옮겼고, 좌석이 다시 비었습니다.')}
                        className="px-3 py-2 rounded-lg text-xs font-bold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                      >
                        계정 삭제
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="max-w-3xl mt-6">
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-500 marker:text-slate-400">
          <li>회사 대표 계정 = 회사 아이디로 로그인한 계정이에요. 멤버십 결제와 좌석 결제는 대표 계정만 할 수 있어요.</li>
          <li>대표 계정은 직원을 관리자로 바꿀 수 있어요. 관리자는 직원 초대 · 계정 삭제 · 관리자 변경을 함께 할 수 있어요.</li>
          <li>초대 링크로 가입할 때 직원이 부서와 이름을 적어요. 직원 목록에 함께 보여 누가 누구인지 알아보기 쉬워요.</li>
          <li>캠페인 메뉴에는 각자 맡은 캠페인만 보여요. 진행이 확정된 인플루언서의 연락처도 그 캠페인 담당자에게만 보입니다.</li>
          <li>캠페인 이력에서는 내 캠페인과 회사 전체 성과를 모두 볼 수 있어요. 캠페인 메뉴의 회사 전체 진행 예정에서는 누구나 회사 전체 업로드 일정을 볼 수 있어요.</li>
          <li>직원이 퇴사하면 계정을 삭제하세요. 맡던 캠페인은 회사 대표 계정 담당으로 넘어오고, 좌석은 추가 비용 없이 다시 비어요. 새 직원은 초대 링크로 새로 가입해 새 캠페인부터 맡으면 됩니다.</li>
        </ul>
      </section>
    </main>
  );
};

export default BrandTeamManagement;

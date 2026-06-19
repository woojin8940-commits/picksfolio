import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';

// 제출된 사업자등록증이 PDF 인지 판별한다(이미지가 아니면 미리보기 대신 PDF 카드로 노출).
const isPdfUrl = (url: string) => /\.pdf(\?|$)/i.test(url);

interface SellerBusiness {
  company_name?: string;
  business_number?: string;
  representative_name?: string;
  contact_phone?: string;
  business_type?: string;
  business_item?: string;
  business_address?: string;
  registration_image_url?: string;
}

interface SellerVerificationItem {
  username: string;
  business: SellerBusiness;
  business_verified: boolean;
  review_status: 'pending' | 'approved' | 'rejected';
  review_reason: string;
  submitted_at: string | null;
  reviewed_at: string | null;
}

interface AdminSellerVerificationsProps {
  token: string;
}

type FilterStatus = 'pending' | 'all' | 'approved' | 'rejected';

const AdminSellerVerifications: React.FC<AdminSellerVerificationsProps> = ({ token }) => {
  const [items, setItems] = useState<SellerVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const data = await apiService.getAdminSellerVerifications(token, filterStatus);
    setItems(data.items || []);
    setPendingCount(data.pendingCount || 0);
    setLoading(false);
  }, [token, filterStatus]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleApprove = async (username: string) => {
    if (!confirm(`@${username} 셀러의 사업자 인증을 수락하시겠습니까? 수락하면 라이브 송출이 가능해집니다.`)) return;
    setProcessing(username);
    const result = await apiService.adminSellerVerificationAction(token, username, 'approve');
    if (result.success) {
      fetchItems();
    } else {
      alert(result.error || '수락 실패');
    }
    setProcessing(null);
  };

  const handleReject = async (username: string) => {
    setProcessing(username);
    const result = await apiService.adminSellerVerificationAction(token, username, 'reject', rejectReason);
    if (result.success) {
      setRejectingId(null);
      setRejectReason('');
      fetchItems();
    } else {
      alert(result.error || '거절 실패');
    }
    setProcessing(null);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      approved: { bg: 'bg-green-100', text: 'text-green-700', label: '수락됨' },
      pending: { bg: 'bg-orange-100', text: 'text-orange-700', label: '심사 대기' },
      rejected: { bg: 'bg-red-100', text: 'text-red-700', label: '거절됨' },
    };
    const s = map[status] || { bg: 'bg-slate-100', text: 'text-slate-500', label: status };
    return <span className={`${s.bg} ${s.text} px-2.5 py-1 rounded-lg text-[10px] font-black`}>{s.label}</span>;
  };

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    const date = new Date(d);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const filters: { key: FilterStatus; label: string }[] = [
    { key: 'pending', label: '심사 대기' },
    { key: 'all', label: '전체' },
    { key: 'approved', label: '수락됨' },
    { key: 'rejected', label: '거절됨' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilterStatus(f.key)}
            className={`px-3 py-2 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 ${
              filterStatus === f.key
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
            }`}
          >
            {f.label}
            {f.key === 'pending' && filterStatus !== 'pending' && pendingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-orange-500 text-white">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">사업자 제출 내역을 불러오는 중...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <p className="text-4xl mb-3">🧾</p>
          <p className="text-sm text-slate-400 font-bold">해당 상태의 사업자 제출 내역이 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {items.map(item => {
            const b = item.business || {};
            const isOpen = expanded === item.username;
            return (
              <div key={item.username} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-4 cursor-pointer" onClick={() => setExpanded(isOpen ? null : item.username)}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-black text-blue-600">@{item.username}</span>
                    {statusBadge(item.review_status)}
                  </div>
                  <h3 className="font-black text-base text-slate-900 mb-1">{b.company_name || '상호 미입력'}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-bold">
                    <span>{b.business_number || '-'}</span>
                    <span className="text-slate-200">·</span>
                    <span>{b.representative_name || '-'}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold mt-2">제출 {formatDate(item.submitted_at)}</p>
                </div>

                {isOpen && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-4 space-y-4 animate-in fade-in duration-200">
                    {/* 사업자등록증 이미지 */}
                    <div>
                      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-2">사업자등록증</p>
                      {b.registration_image_url ? (
                        <a href={b.registration_image_url} target="_blank" rel="noreferrer" className="block">
                          {isPdfUrl(b.registration_image_url) ? (
                            <div className="flex items-center gap-3 w-full px-4 py-6 rounded-xl border border-slate-200 bg-slate-50">
                              <span className="text-3xl">📄</span>
                              <span className="text-sm font-bold text-slate-600">사업자등록증 PDF</span>
                            </div>
                          ) : (
                            <img
                              src={b.registration_image_url}
                              alt="사업자등록증"
                              className="w-full max-h-[420px] object-contain rounded-xl border border-slate-200 bg-slate-50"
                            />
                          )}
                          <span className="text-[11px] text-blue-600 font-bold mt-1.5 inline-block">새 창에서 원본 보기 →</span>
                        </a>
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 font-bold">
                          사업자등록증이 첨부되지 않았습니다.
                        </div>
                      )}
                    </div>

                    {/* 사업자 정보 */}
                    <div className="grid grid-cols-2 gap-2">
                      <Detail label="상호" value={b.company_name} />
                      <Detail label="대표자" value={b.representative_name} />
                      <Detail label="등록번호" value={b.business_number} />
                      <Detail label="연락처" value={b.contact_phone} />
                      {b.business_type && <Detail label="업태" value={b.business_type} />}
                      {b.business_item && <Detail label="종목" value={b.business_item} />}
                      {b.business_address && <Detail label="주소" value={b.business_address} full />}
                    </div>

                    {item.review_status === 'rejected' && item.review_reason && (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                        <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">거절 사유</p>
                        <p className="text-sm text-red-700 font-medium">{item.review_reason}</p>
                      </div>
                    )}

                    {item.review_status !== 'approved' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleApprove(item.username)}
                          disabled={processing === item.username}
                          className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {processing === item.username ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                          )}
                          수락
                        </button>
                        <button
                          onClick={() => setRejectingId(rejectingId === item.username ? null : item.username)}
                          disabled={processing === item.username}
                          className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                          거절
                        </button>
                      </div>
                    )}

                    {item.review_status === 'approved' && (
                      <button
                        onClick={() => setRejectingId(rejectingId === item.username ? null : item.username)}
                        disabled={processing === item.username}
                        className="w-full bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-600 py-2.5 rounded-xl font-black text-xs transition-all disabled:opacity-50"
                      >
                        인증 취소(거절로 전환)
                      </button>
                    )}

                    {rejectingId === item.username && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
                        <p className="text-sm font-black text-red-700">거절 사유 입력</p>
                        <textarea
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          className="w-full border border-red-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 min-h-[80px] resize-y bg-white"
                          placeholder="거절 사유를 입력해 주세요 (셀러에게 전달됩니다)"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleReject(item.username)}
                            disabled={processing === item.username}
                            className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-xl font-black text-sm transition-all disabled:opacity-50"
                          >
                            {processing === item.username ? '처리 중...' : '거절 확인'}
                          </button>
                          <button
                            onClick={() => { setRejectingId(null); setRejectReason(''); }}
                            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-black text-slate-600 transition-colors"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Detail: React.FC<{ label: string; value?: string; full?: boolean }> = ({ label, value, full }) => (
  <div className={`bg-slate-50 rounded-xl p-3 ${full ? 'col-span-2' : ''}`}>
    <p className="text-[9px] text-slate-400 font-black uppercase">{label}</p>
    <p className="text-xs font-bold text-slate-900 break-all">{value || '-'}</p>
  </div>
);

export default AdminSellerVerifications;

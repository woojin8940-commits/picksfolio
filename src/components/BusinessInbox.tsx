import React, { useState, useEffect } from 'react';

interface Proposal {
  id: string;
  title: string;
  company_name: string;
  description: string;
  fee: number;
  start_date: string;
  end_date: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  contact_email?: string;
}

interface BusinessInboxProps {
  userName: string;
}

const BusinessInbox: React.FC<BusinessInboxProps> = ({ userName }) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  useEffect(() => {
    if (!userName) return;
    const saved = localStorage.getItem(`picks_proposals_${userName.toLowerCase()}`);
    if (saved) setProposals(JSON.parse(saved));
  }, [userName]);

  const saveProposals = (records: Proposal[]) => {
    setProposals(records);
    localStorage.setItem(`picks_proposals_${userName.toLowerCase()}`, JSON.stringify(records));
  };

  const updateStatus = (id: string, status: 'accepted' | 'rejected') => {
    saveProposals(proposals.map(p => p.id === id ? { ...p, status } : p));
    if (selectedProposal?.id === id) {
      setSelectedProposal({ ...selectedProposal, status });
    }
  };

  const deleteProposal = (id: string) => {
    if (confirm('이 제안을 삭제하시겠습니까?')) {
      saveProposals(proposals.filter(p => p.id !== id));
      if (selectedProposal?.id === id) setSelectedProposal(null);
    }
  };

  const filteredProposals = proposals.filter(p => filter === 'all' || p.status === filter);

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending': return { label: '검토중', className: 'bg-amber-100 text-amber-700' };
      case 'accepted': return { label: '수락', className: 'bg-green-100 text-green-700' };
      case 'rejected': return { label: '거절', className: 'bg-red-100 text-red-700' };
      default: return { label: status, className: 'bg-slate-100 text-slate-600' };
    }
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    const date = new Date(d);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };

  const pendingCount = proposals.filter(p => p.status === 'pending').length;
  const acceptedCount = proposals.filter(p => p.status === 'accepted').length;

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <div className="mb-8 md:mb-12">
        <h2 className="text-2xl md:text-4xl font-black text-slate-900">비즈니스 수신함</h2>
        <p className="text-slate-400 text-sm md:text-base font-bold mt-1.5">브랜드로부터 받은 협업 제안을 확인하세요.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 md:gap-6 mb-8">
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">전체</p>
          <p className="text-xl md:text-3xl font-black text-slate-900">{proposals.length}</p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">검토중</p>
          <p className="text-xl md:text-3xl font-black text-amber-600">{pendingCount}</p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">수락</p>
          <p className="text-xl md:text-3xl font-black text-green-600">{acceptedCount}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        {(['all', 'pending', 'accepted', 'rejected'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 text-xs font-black rounded-xl transition-all ${filter === f ? 'bg-purple-600 text-white shadow-lg' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
            {f === 'all' ? '전체' : f === 'pending' ? '검토중' : f === 'accepted' ? '수락' : '거절'}
          </button>
        ))}
      </div>

      {/* Proposals List */}
      <div className="space-y-3">
        {filteredProposals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
            <p className="text-slate-400 font-bold text-sm">
              {filter === 'all' ? '아직 받은 제안이 없습니다.' : `${filter === 'pending' ? '검토중인' : filter === 'accepted' ? '수락한' : '거절한'} 제안이 없습니다.`}
            </p>
          </div>
        ) : (
          filteredProposals.map(p => {
            const badge = statusBadge(p.status);
            return (
              <div key={p.id} onClick={() => setSelectedProposal(p)}
                className={`bg-white rounded-2xl border shadow-sm p-4 md:p-6 cursor-pointer transition-all hover:shadow-md ${selectedProposal?.id === p.id ? 'border-purple-500' : 'border-slate-100'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-black text-slate-900 truncate">{p.title}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>{badge.label}</span>
                    </div>
                    <p className="text-xs text-slate-400 font-bold">{p.company_name} · {p.fee.toLocaleString()}원 · {formatDate(p.start_date)} ~ {formatDate(p.end_date)}</p>
                    {p.description && <p className="text-xs text-slate-500 font-medium mt-2 line-clamp-2">{p.description}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {p.status === 'pending' && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(p.id, 'accepted'); }}
                          className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors">수락</button>
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(p.id, 'rejected'); }}
                          className="px-3 py-1.5 bg-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-300 transition-colors">거절</button>
                      </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); deleteProposal(p.id); }}
                      className="p-1.5 text-slate-300 hover:text-red-500 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default BusinessInbox;

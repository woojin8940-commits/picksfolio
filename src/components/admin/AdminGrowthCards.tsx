import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/apiService';

interface GrowthData {
  newInfluencers: { today: number; last7d: number; last30d: number; total: number };
  activity: { dau: number; wau: number; mau: number };
  acceptance: { overall: number; last30d: number; recentTotal: number };
}

interface Props { token: string; }

const AdminGrowthCards: React.FC<Props> = ({ token }) => {
  const [data, setData] = useState<GrowthData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiService.getAdminGrowth(token).then(d => {
      setData(d);
      setLoaded(true);
    });
  }, [token]);

  if (!loaded) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <p className="text-slate-400 font-bold text-xs">성장 지표 로딩 중...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="font-black text-slate-900 mb-2">성장 지표</h3>
        <p className="text-slate-400 font-bold text-sm">아직 데이터가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <h3 className="font-black text-slate-900 mb-3">성장 지표</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">신규 인플루언서 (오늘)</p>
          <p className="text-xl font-black text-slate-900">{data.newInfluencers.today}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">신규 (7일)</p>
          <p className="text-xl font-black text-blue-600">{data.newInfluencers.last7d}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">신규 (30일)</p>
          <p className="text-xl font-black text-indigo-600">{data.newInfluencers.last30d}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">DAU</p>
          <p className="text-xl font-black text-rose-500">{data.activity.dau}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">WAU / MAU</p>
          <p className="text-xl font-black text-amber-600">{data.activity.wau} / {data.activity.mau}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">제안 승낙률 (30일)</p>
          <p className="text-xl font-black text-green-600">{data.acceptance.last30d}%</p>
          <p className="text-[10px] font-bold text-slate-400">전체 {data.acceptance.overall}%</p>
        </div>
      </div>
    </div>
  );
};

export default AdminGrowthCards;

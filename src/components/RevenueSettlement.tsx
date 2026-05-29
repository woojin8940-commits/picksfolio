
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell
} from 'recharts';
import { Wallet, Download, ArrowUpRight, CreditCard } from 'lucide-react';

const RevenueSettlement: React.FC = () => {
  const monthlyData = [
    { month: '10월', amount: 1200000 },
    { month: '11월', amount: 1800000 },
    { month: '12월', amount: 2400000 },
    { month: '1월', amount: 2100000 },
    { month: '2월', amount: 3200000 },
  ];

  const transactions = [
    { id: 1, date: '2024.02.22', type: '판매 수익', amount: '+ 124,000원', status: '정산완료' },
    { id: 2, date: '2024.02.21', type: '판매 수익', amount: '+ 89,000원', status: '정산대기' },
    { id: 3, date: '2024.02.20', type: '판매 수익', amount: '+ 210,000원', status: '정산완료' },
    { id: 4, date: '2024.02.19', type: '판매 수익', amount: '+ 45,000원', status: '정산완료' },
  ];

  return (
    <div className="p-3 md:p-14 w-full animate-in fade-in duration-500">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 md:mb-12">
        <div>
          <h2 className="text-base md:text-3xl font-black text-slate-900 whitespace-nowrap">수익 및 정산 관리</h2>
          <p className="text-slate-500 font-bold text-[9px] md:text-base whitespace-nowrap">발생한 수익 내역을 확인하고 정산을 신청하세요.</p>
        </div>
        <button className="bg-slate-900 text-white px-6 py-3 rounded-xl font-black text-[11px] md:text-sm flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg">
          <Download className="w-4 h-4" />
          리포트 다운로드
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
        {/* Earnings Overview */}
        <div className="lg:col-span-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-[1.5rem] md:rounded-[2.5rem] text-white shadow-xl">
              <div className="flex justify-between items-start mb-8">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                  <Wallet className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full uppercase tracking-widest">Available</span>
              </div>
              <p className="text-xs opacity-60 font-black uppercase tracking-widest mb-1">정산 가능 금액</p>
              <h3 className="text-3xl md:text-4xl font-black mb-8">₩ 1,240,000</h3>
              <button className="w-full bg-white text-blue-700 py-4 rounded-2xl font-black text-sm hover:bg-slate-50 transition-all">
                정산 신청하기
              </button>
            </div>

            <div className="bg-white p-8 rounded-[1.5rem] md:rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">이번 달 누적 수익</p>
                <h3 className="text-3xl font-black text-slate-900">₩ 3,200,000</h3>
                <p className="text-emerald-500 text-xs font-bold mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-3 h-3" />
                  지난달 대비 15% 상승
                </p>
              </div>
              <div className="pt-6 border-t border-slate-50 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">다음 정산 예정일</p>
                  <p className="text-sm font-black text-slate-900">2024년 3월 5일</p>
                </div>
                <CreditCard className="w-8 h-8 text-slate-100" />
              </div>
            </div>
          </div>

          {/* Monthly Chart */}
          <div className="bg-white p-6 md:p-10 rounded-[1.5rem] md:rounded-[2.5rem] border border-slate-100 shadow-sm">
            <h3 className="text-sm md:text-xl font-black text-slate-900 mb-8 flex items-center gap-2">
              <span className="text-xl">📊</span>
              월별 수익 추이
            </h3>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="month" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fontSize: 11, fontWeight: 700, fill: '#94a3b8'}}
                    dy={10}
                  />
                  <YAxis hide />
                  <Tooltip 
                    cursor={{fill: '#f8fafc'}}
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontWeight: 800}}
                  />
                  <Bar dataKey="amount" radius={[8, 8, 0, 0]}>
                    {monthlyData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={index === monthlyData.length - 1 ? '#2563EB' : '#e2e8f0'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Transaction History */}
        <div className="lg:col-span-4">
          <div className="bg-white p-6 md:p-10 rounded-[1.5rem] md:rounded-[2.5rem] border border-slate-100 shadow-sm h-full">
            <h3 className="text-sm md:text-xl font-black text-slate-900 mb-8 flex items-center gap-2">
              <span className="text-xl">📜</span>
              최근 정산 내역
            </h3>
            <div className="space-y-6">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between pb-6 border-b border-slate-50 last:border-0 last:pb-0">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{tx.date}</p>
                    <p className="text-sm font-black text-slate-900">{tx.type}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-900 mb-1">{tx.amount}</p>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${tx.status === '정산완료' ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500'}`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-8 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-blue-600 transition-colors">
              전체 내역 보기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RevenueSettlement;

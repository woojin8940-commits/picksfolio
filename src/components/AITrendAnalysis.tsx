import React, { useState, useEffect } from 'react';
import { TrendingUp, Sparkles, BarChart3, ArrowUpRight, Search, RefreshCw } from 'lucide-react';
import NaverCategoryRankings from './NaverCategoryRankings';

interface AITrendAnalysisProps {
  userName: string;
}

const AITrendAnalysis: React.FC<AITrendAnalysisProps> = () => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [topInsight, setTopInsight] = useState('분석 중...');

  const trends = [
    { id: 1, keyword: '발레코어', growth: '+124%', status: 'Rising', color: 'bg-pink-500' },
    { id: 2, keyword: '올드머니 룩', growth: '+85%', status: 'Stable', color: 'bg-amber-600' },
    { id: 3, keyword: '고프코어', growth: '+42%', status: 'Rising', color: 'bg-emerald-600' },
    { id: 4, keyword: 'Y2K 패션', growth: '+12%', status: 'Declining', color: 'bg-purple-600' }
  ];

  const fetchTopTrend = async () => {
    try {
      const res = await fetch('/.netlify/functions/api-naver-datalab');
      if (res.ok) {
        const data = await res.json();
        if (data.mainInsight?.keyword) {
          setTopInsight(data.mainInsight.keyword);
        }
      } else {
        setTopInsight('트렌드 데이터를 불러올 수 없습니다');
      }
    } catch (err) {
      console.error('Error fetching top trend:', err);
      setTopInsight('네트워크 오류가 발생했습니다');
    }
  };

  useEffect(() => { fetchTopTrend(); }, []);

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    fetchTopTrend().finally(() => setIsAnalyzing(false));
  };

  return (
    <div className="p-4 md:p-14 max-w-6xl mx-auto animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
        <div>
          <h2 className="text-lg md:text-3xl font-black text-slate-900 mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            AI 트렌드 분석 <Sparkles className="text-purple-600 w-5 h-5 md:w-6 md:h-6" />
          </h2>
          <p className="text-slate-500 font-medium text-[10px] md:text-base">현재 소셜 미디어에서 가장 핫한 패션 키워드를 분석합니다.</p>
        </div>
        <button 
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className="bg-purple-600 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-purple-500 transition-all shadow-lg shadow-purple-200 disabled:opacity-50"
        >
          <RefreshCw size={18} className={isAnalyzing ? 'animate-spin' : ''} />
          <span>실시간 분석 업데이트</span>
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Insight Card */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden shadow-2xl">
            <div className="relative z-10">
              <div className="bg-purple-600 text-[10px] font-black px-3 py-1 rounded-full w-fit mb-6 uppercase tracking-widest">Today's Top Insight</div>
              <h3 className="text-xl md:text-4xl font-black mb-4 leading-tight">
                지금 <span className="text-purple-400">"{topInsight}"</span> 룩이<br />다시 부상하고 있어요.
              </h3>
              <p className="text-slate-400 font-medium mb-8 max-w-md">
                지난 24시간 동안 인스타그램과 틱톡에서 관련 해시태그 언급량이 124% 증가했습니다. 리본 디테일과 튤 스커트 아이템을 추천 포스트에 추가해보세요.
              </p>
              <div className="flex flex-wrap gap-3">
                <span className="bg-white/10 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl text-xs font-bold">#발레코어</span>
                <span className="bg-white/10 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl text-xs font-bold">#리본스타일링</span>
                <span className="bg-white/10 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl text-xs font-bold">#여름코디</span>
              </div>
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/20 blur-[100px] -mr-20 -mt-20"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-black text-slate-900 flex items-center gap-2">
                  <TrendingUp size={18} className="text-purple-600" /> 급상승 키워드
                </h4>
                <span className="text-[10px] font-black text-slate-400 uppercase">Live</span>
              </div>
              <div className="space-y-4">
                {trends.map(trend => (
                  <div key={trend.id} className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${trend.color}`}></div>
                      <span className="font-black text-sm text-slate-700">{trend.keyword}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-purple-600">{trend.growth}</span>
                      <ArrowUpRight size={14} className="text-purple-600" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-black text-slate-900 flex items-center gap-2">
                  <BarChart3 size={18} className="text-purple-600" /> 카테고리 점유율
                </h4>
              </div>
              <div className="space-y-6">
                <CategoryBar label="의류" percent={65} color="bg-purple-600" />
                <CategoryBar label="액세서리" percent={20} color="bg-indigo-500" />
                <CategoryBar label="뷰티" percent={10} color="bg-pink-500" />
                <CategoryBar label="기타" percent={5} color="bg-slate-200" />
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Analysis */}
        <div className="space-y-8">
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
            <h4 className="font-black text-slate-900 mb-6 flex items-center gap-2">
              <Search size={18} className="text-purple-600" /> AI 추천 상품군
            </h4>
            <div className="space-y-4">
              <RecommendationItem title="실크 리본 헤어핀" reason="발레코어 트렌드 핵심 아이템" />
              <RecommendationItem title="시스루 볼레로" reason="레이어드 룩 수요 증가" />
              <RecommendationItem title="메리제인 슈즈" reason="데일리 슈즈 검색량 급증" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-600 to-indigo-700 p-8 rounded-[2rem] text-white shadow-xl">
            <h4 className="font-black text-lg mb-4">내 페이지 최적화</h4>
            <p className="text-white/80 text-xs font-medium mb-6 leading-relaxed">
              현재 트렌드에 맞춰 '발레코어' 테마의 템플릿으로 변경하면 클릭률이 약 15% 상승할 것으로 예측됩니다.
            </p>
            <button className="w-full bg-white text-purple-700 py-3 rounded-xl font-black text-xs hover:bg-purple-50 transition-all">
              테마 추천 적용하기
            </button>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <NaverCategoryRankings embedded />
      </div>
    </div>
  );
};

const CategoryBar: React.FC<{ label: string; percent: number; color: string }> = ({ label, percent, color }) => (
  <div className="space-y-2">
    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-900">{percent}%</span>
    </div>
    <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${percent}%` }}></div>
    </div>
  </div>
);

const RecommendationItem: React.FC<{ title: string; reason: string }> = ({ title, reason }) => (
  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-purple-200 transition-all cursor-pointer group">
    <h5 className="font-black text-sm text-slate-900 mb-1 group-hover:text-purple-600 transition-colors">{title}</h5>
    <p className="text-[10px] font-bold text-slate-400">{reason}</p>
  </div>
);

export default AITrendAnalysis;

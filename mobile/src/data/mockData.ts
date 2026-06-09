import type {
  Campaign,
  CreatorProfile,
  CreatorStats,
  PortfolioItem,
} from '@/types';

/**
 * Bundled sample data. Used to render a complete, demonstrable UI before a
 * live Supabase backend is connected (see `src/lib/supabase.ts`).
 */
export const sampleProfile: CreatorProfile = {
  id: 'creator-001',
  handle: 'soo.curates',
  displayName: '김수아',
  bio: '무신사 · 올리브영 트렌드를 큐레이션합니다.',
  avatarColor: '#C8A86B',
  followers: 48200,
  monthlyViews: 132540,
};

export const sampleStats: CreatorStats = {
  totalClicks: 18420,
  activeCampaigns: 3,
  monthlyEarnings: 2_640_000,
};

export const sampleCampaigns: Campaign[] = [
  {
    id: 'cmp-1',
    brand: 'OLIVE YOUNG',
    title: '여름 글로우 스킨케어 기획전',
    category: '뷰티',
    reward: 1_200_000,
    deadline: '2026-06-24',
    status: 'invited',
  },
  {
    id: 'cmp-2',
    brand: 'MUSINSA',
    title: '데일리 캐주얼 룩북 협업',
    category: '패션',
    reward: 900_000,
    deadline: '2026-06-18',
    status: 'in_progress',
  },
  {
    id: 'cmp-3',
    brand: 'KURLY',
    title: '신선식품 라이브 커머스',
    category: '푸드',
    reward: 1_500_000,
    deadline: '2026-06-12',
    status: 'in_progress',
  },
  {
    id: 'cmp-4',
    brand: 'WCONCEPT',
    title: 'SS 컬렉션 그리드 포스트',
    category: '패션',
    reward: 750_000,
    deadline: '2026-05-30',
    status: 'completed',
  },
];

export const samplePortfolio: PortfolioItem[] = [
  { id: 'p1', title: '오늘의 데일리 코디', platform: 'Instagram', swatch: '#C8A86B', clicks: 3120 },
  { id: 'p2', title: '6월 뷰티 픽 모음', platform: 'YouTube', swatch: '#E0655F', clicks: 2870 },
  { id: 'p3', title: '주말 홈카페 레시피', platform: 'Blog', swatch: '#5BBE8B', clicks: 1940 },
  { id: 'p4', title: '여행 패킹 리스트', platform: 'TikTok', swatch: '#6C8BD5', clicks: 1610 },
  { id: 'p5', title: '데스크 셋업 추천', platform: 'Link', swatch: '#B08BD5', clicks: 1325 },
  { id: 'p6', title: '러닝 기어 추천', platform: 'Instagram', swatch: '#D5A86C', clicks: 1180 },
];

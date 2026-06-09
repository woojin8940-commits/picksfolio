/** Shared domain types for the PICKS Folio mobile app. */

export interface CreatorProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarColor: string;
  followers: number;
  monthlyViews: number;
}

export type CampaignStatus = 'invited' | 'in_progress' | 'completed';

export interface Campaign {
  id: string;
  brand: string;
  title: string;
  category: string;
  reward: number; // KRW
  deadline: string; // ISO date
  status: CampaignStatus;
}

export interface PortfolioItem {
  id: string;
  title: string;
  platform: string;
  swatch: string;
  clicks: number;
}

export interface CreatorStats {
  totalClicks: number;
  activeCampaigns: number;
  monthlyEarnings: number; // KRW
}

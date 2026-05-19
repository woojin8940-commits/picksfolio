
export enum TemplateType {
  SHOPPABLE_GRID = 'shoppable_grid',
  PORTFOLIO = 'portfolio',
  LINK_LIST = 'link_list'
}

export interface ProductOption {
  id: string;
  name: string;       // e.g. "사이즈", "컬러"
  values: string[];   // e.g. ["S", "M", "L"] or ["블랙", "화이트"]
}

export interface LiveProductOptionValue {
  value: string;
  price?: number;     // absolute KRW override; when set, replaces base unit price for this variant
  discount?: number;  // percent off (0-100); applied on top of resolved unit price
}

export interface LiveProductOption {
  id: string;
  name: string;
  values: LiveProductOptionValue[];
}

export interface Product {
  id: string;
  name: string;
  price?: string;
  image?: string;
  link: string;
  options?: ProductOption[];
}

export interface ProductItem {
  name: string;
  price: string;
  image: string;
  description?: string;
}

export interface TrendAnalysis {
  keyword: string;
  trendScore: number;
  description: string;
  stylingTips: string[];
  recommendedItems: string[];
  colorPalette: string[];
}

export interface Block {
  id: string;
  title: string;
  category: string;
  coverMedia: string;
  mediaType: 'image' | 'video';
  products: Product[];
}

export interface DesignSettings {
  templateType: TemplateType;
  theme: string;
  accentColor: string;
  borderRadius: 'none' | 'md' | 'full';
  gridGap: number;
  gridColumns: number;
  gridStyle: 'magazine' | 'standard';
  fontFamily: 'Sans' | 'Serif' | 'Mono';
  buttonStyle: 'solid' | 'outline' | 'ghost';
  backgroundType: 'solid' | 'gradient' | 'image';
  customGradient?: string;
  profileLayout: 'center' | 'left';
  homePriority: 'products' | 'portfolio' | 'curation';
  background_image?: string;
  portfolioHeaderImage?: string;
  portfolioHeaderImagePosition?: string;
  portfolioHeaderColor?: string;
  portfolioFontSize?: 'small' | 'medium' | 'large';
  title?: string;
  description?: string;
}

export type ProposalCategory = '광고' | '커머스';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'completed';

export type CollabCategory = '광고' | '커머스' | '기타';
export type CollabStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface CollabRecord {
  id: string;
  title: string;
  company_name: string;
  category: CollabCategory;
  date: string;
  end_date?: string;
  fee: number;
  status: CollabStatus;
  memo?: string;
  created_at: string;
  updated_at?: string;
}

export interface ProductFolder {
  id: string;
  name: string;
  icon?: string;
  order: number;
  blockIds: string[];
}

export interface OpenScheduleItem {
  id: string;
  title: string;
  date: string;
  time?: string;
  description?: string;
  link?: string;
  isActive: boolean;
  created_at: string;
}

export interface BusinessProposal {
  id: string;
  influencer_username: string;
  category: ProposalCategory;
  company_name: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  title: string;
  content: string;
  start_date: string;
  end_date: string;
  fee: number;
  revenue_share?: number;
  reference_links: string[];
  attachments?: string[];
  business_username?: string;
  status: ProposalStatus;
  rejection_reason?: string;
  created_at: string;
  updated_at?: string;
}

// Business (Enterprise) Account Types
export interface BusinessAccount {
  id: string;
  company_name: string;
  business_number: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  username: string;
  password_hash?: string;
  created_at: string;
  updated_at?: string;
}

export interface SellerBusinessVerification {
  company_name: string;
  business_number: string;
  representative_name: string;
  contact_phone: string;
  business_type?: string;
  business_item?: string;
  business_address?: string;
}

export interface SellerSettlementAccount {
  bank_name: string;
  account_number: string;
  account_holder: string;
}

export interface SellerVerification {
  business?: SellerBusinessVerification | null;
  settlement?: SellerSettlementAccount | null;
  business_verified?: boolean;
  settlement_registered?: boolean;
  membership_active?: boolean;
  membership_plan?: 'standard' | 'commerce' | 'live' | null;
  membership_started_at?: string | null;
  billing_key?: string | null;
  billing_key_issued_at?: string | null;
  verified_at?: string;
  updated_at?: string;
}

export type SettlementStatus = 'scheduled' | 'pending' | 'completed';

export interface Settlement {
  id: string;
  proposal_id: string;
  influencer_username: string;
  business_username: string;
  company_name: string;
  title: string;
  amount: number;
  scheduled_date: string;
  status: SettlementStatus;
  completed_at?: string;
  memo?: string;
  created_at: string;
  updated_at?: string;
}

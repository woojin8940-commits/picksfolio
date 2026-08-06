
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

export type BlockDisplayType = 'grid' | 'minimal' | 'text';

export interface Block {
  id: string;
  title: string;
  category: string;
  coverMedia: string;
  coverMediaPosition?: { x: number; y: number };
  mediaType: 'image' | 'video';
  products: Product[];
  colSpan?: 1 | 2 | 3;
  displayType?: BlockDisplayType;
  textContent?: string;
  fontSizePx?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  highlight?: string;
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

// 셀러 레코드 — 지금은 멤버십·정기결제 상태만 담는다.
// 사업자등록증 심사와 정산 계좌 등록은 라이브 커머스 전용 절차였고, 라이브 커머스를
// 접으면서 함께 없앴다(예전 제출 기록은 서버 응답에서 걸러진다).
export interface SellerVerification {
  membership_active?: boolean;
  membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | 'live' | null;
  membership_started_at?: string | null;
  billing_key?: string | null;
  billing_key_issued_at?: string | null;
  // Recurring (anniversary) billing state for the paid memberships. The Claude
  // plan is billed separately and does not use these fields.
  membership_amount_krw?: number | null;
  last_billing_at?: string | null;
  next_billing_date?: string | null;
  billing_failures?: number;
  billing_history?: MembershipBillingHistoryEntry[];
  // 라이브 커머스 멤버십(별도 구독)은 판매를 종료했다. 아래 필드는 예전 구독자
  // 기록에만 남아 있는 레거시 값이며 새로 쓰이지 않는다.
  live_plan_active?: boolean;
  live_plan_started_at?: string | null;
  live_plan_amount_krw?: number | null;
  live_plan_last_billing_at?: string | null;
  live_plan_next_billing_date?: string | null;
  live_plan_billing_failures?: number;
  verified_at?: string;
  updated_at?: string;
}

export interface MembershipBillingHistoryEntry {
  at: string;
  // 'live_plan' 은 판매 종료된 라이브 커머스 멤버십의 과거 청구 기록에만 남는다.
  tier: 'standard' | 'standard_ai' | 'commerce' | 'pro' | 'live_plan';
  amountKrw: number;
  kind: 'initial' | 'recurring';
  success: boolean;
  paymentId?: string;
  error?: string;
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
  /**
   * 아직 금액이 정해지지 않은 정산. 공동구매처럼 담당자가 인플루언서와 조율해
   * 금액을 확정하는 협업은 담당자가 값을 넣기 전까지 0원이 아니라 "협의중"으로
   * 보여야 한다.
   */
  amount_pending?: boolean;
  scheduled_date: string;
  status: SettlementStatus;
  completed_at?: string;
  memo?: string;
  created_at: string;
  updated_at?: string;
}

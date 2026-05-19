-- Analytics events for tracking page views and clicks
CREATE TABLE IF NOT EXISTS analytics_events (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  action text NOT NULL,
  block_id text,
  date text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_username ON analytics_events(username);
CREATE INDEX IF NOT EXISTS idx_analytics_events_date ON analytics_events(username, date);

-- Live products displayed during streams
CREATE TABLE IF NOT EXISTS live_products (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  name text NOT NULL,
  price integer DEFAULT 0,
  image text,
  link text,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_products_username ON live_products(username);

-- Live cart items for viewers
CREATE TABLE IF NOT EXISTS live_cart_items (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  viewer_id text NOT NULL,
  product_id text NOT NULL,
  product_name text NOT NULL,
  product_price integer DEFAULT 0,
  product_image text,
  quantity integer DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_cart_username ON live_cart_items(username);
CREATE INDEX IF NOT EXISTS idx_live_cart_viewer ON live_cart_items(username, viewer_id);

-- Live orders from live commerce
CREATE TABLE IF NOT EXISTS live_orders (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  viewer_id text,
  viewer_name text,
  viewer_phone text,
  items jsonb DEFAULT '[]',
  total_amount integer DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  payment_id text,
  address text,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_orders_username ON live_orders(username);

-- Stream keys for live broadcasting
CREATE TABLE IF NOT EXISTS stream_keys (
  username text PRIMARY KEY NOT NULL,
  stream_key text,
  ingest_url text,
  playback_url text,
  channel_arn text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seller verification data
CREATE TABLE IF NOT EXISTS seller_verifications (
  username text PRIMARY KEY NOT NULL,
  business_number text,
  business_name text,
  representative_name text,
  business_type text,
  business_category text,
  bank_name text,
  account_number text,
  account_holder text,
  is_verified boolean DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Admin notifications
CREATE TABLE IF NOT EXISTS admin_notifications (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  data jsonb DEFAULT '{}',
  is_read boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_read ON admin_notifications(is_read);

-- Alimtalk notification settings per user
CREATE TABLE IF NOT EXISTS alimtalk_settings (
  username text PRIMARY KEY NOT NULL,
  live_alert boolean DEFAULT false,
  order_alert boolean DEFAULT false,
  proposal_alert boolean DEFAULT false,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Live notification subscriptions (viewers subscribing to influencer broadcasts)
CREATE TABLE IF NOT EXISTS live_notify_subscriptions (
  id text PRIMARY KEY NOT NULL,
  influencer_username text NOT NULL,
  phone text NOT NULL,
  nickname text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(influencer_username, phone)
);
CREATE INDEX IF NOT EXISTS idx_live_notify_influencer ON live_notify_subscriptions(influencer_username);

-- Timeline entries for business-influencer communication
CREATE TABLE IF NOT EXISTS timeline_entries (
  id text PRIMARY KEY NOT NULL,
  proposal_id text,
  influencer_username text NOT NULL,
  business_username text,
  type text NOT NULL DEFAULT 'proposal',
  title text,
  content text,
  status text DEFAULT 'unread',
  data jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timeline_influencer ON timeline_entries(influencer_username);
CREATE INDEX IF NOT EXISTS idx_timeline_proposal ON timeline_entries(proposal_id);

-- Timeline comments
CREATE TABLE IF NOT EXISTS timeline_comments (
  id text PRIMARY KEY NOT NULL,
  proposal_id text NOT NULL,
  author_type text NOT NULL,
  author_name text,
  author_username text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timeline_comments_proposal ON timeline_comments(proposal_id);

-- Broadcast replays
CREATE TABLE IF NOT EXISTS broadcast_replays (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  title text,
  thumbnail_url text,
  video_url text,
  duration_seconds integer DEFAULT 0,
  viewer_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcast_replays_username ON broadcast_replays(username);

-- Viewer diagnostics/error reports
CREATE TABLE IF NOT EXISTS viewer_diagnostics (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  viewer_id text,
  error_type text,
  error_message text,
  user_agent text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_viewer_diagnostics_username ON viewer_diagnostics(username);

-- Live usage statistics
CREATE TABLE IF NOT EXISTS live_usage_stats (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  month text NOT NULL,
  total_duration_seconds integer DEFAULT 0,
  total_streams integer DEFAULT 0,
  total_viewers integer DEFAULT 0,
  total_sales integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(username, month)
);
CREATE INDEX IF NOT EXISTS idx_live_usage_username ON live_usage_stats(username);

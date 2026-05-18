CREATE TABLE creator_profiles (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  category TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  profile_code TEXT UNIQUE NOT NULL,
  is_public BOOLEAN DEFAULT true,
  page_url TEXT DEFAULT '',
  block_count INTEGER DEFAULT 0,
  sns_links JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_creator_profiles_code ON creator_profiles(profile_code);
CREATE INDEX idx_creator_profiles_category ON creator_profiles(category);
CREATE INDEX idx_creator_profiles_public ON creator_profiles(is_public);
CREATE INDEX idx_creator_profiles_updated ON creator_profiles(updated_at DESC);

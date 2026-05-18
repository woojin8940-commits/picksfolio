CREATE TABLE site_data (
  username TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}',
  profile_code TEXT UNIQUE NOT NULL,
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_site_data_profile_code ON site_data(profile_code);
CREATE INDEX idx_site_data_public ON site_data(is_public);
CREATE INDEX idx_site_data_updated ON site_data(updated_at DESC);

INSERT INTO site_data (username, data, profile_code, is_public, created_at, updated_at)
SELECT
  username,
  CASE
    WHEN site_data IS NOT NULL AND site_data != '{}'::jsonb THEN site_data
    ELSE jsonb_build_object(
      'profile', jsonb_build_object('name', display_name, 'bio', bio, 'avatar_url', avatar_url),
      'design', jsonb_build_object('portfolioHeaderImage', cover_url),
      'socials', sns_links,
      'category', category,
      'tags', string_to_array(tags, ',')
    )
  END,
  profile_code,
  is_public,
  created_at,
  updated_at
FROM creator_profiles;

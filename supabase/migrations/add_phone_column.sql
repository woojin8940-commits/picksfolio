-- Add phone column to profiles table (if not already present)
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS phone text;

-- Optional: add a comment for documentation
COMMENT ON COLUMN public.profiles.phone IS 'User phone number in Korean local format (e.g. 01012345678)';

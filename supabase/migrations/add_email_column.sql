-- Add email column to profiles table so that signup/login handlers can persist
-- the user's email (virtual @picks.me address for username-based accounts,
-- real contact email for business accounts, Kakao account email for OAuth).
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.profiles.email IS 'User email address. Mirrors auth.users.email for regular signups (virtual ${username}@picks.me), stores contact_email for business accounts, and the Kakao account email for OAuth logins.';

-- Add birthdate and gender columns to profiles table for demographic-based alimtalk targeting
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS birthdate date;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male', 'female', 'other'));

COMMENT ON COLUMN public.profiles.birthdate IS 'User date of birth (YYYY-MM-DD) collected at signup for alimtalk targeting';
COMMENT ON COLUMN public.profiles.gender IS 'User self-reported gender: male, female, or other — collected at signup for alimtalk targeting';

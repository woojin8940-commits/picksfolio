-- Migration: store recording metadata on broadcast_history so admins can
-- replay a past broadcast and overlay payment density.

ALTER TABLE public.broadcast_history
  ADD COLUMN IF NOT EXISTS recording_blob_key text,
  ADD COLUMN IF NOT EXISTS recording_mime text,
  ADD COLUMN IF NOT EXISTS recording_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS recording_duration_seconds numeric;

CREATE INDEX IF NOT EXISTS idx_broadcast_history_has_recording
  ON public.broadcast_history(started_at DESC)
  WHERE recording_blob_key IS NOT NULL;

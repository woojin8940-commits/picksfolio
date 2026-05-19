import { supabase, withTimeout } from './supabase';

/**
 * Supabase Stream Channels Service
 *
 * SQL Schema (run in Supabase SQL Editor):
 *
 * CREATE TABLE IF NOT EXISTS stream_channels (
 *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *   username TEXT NOT NULL UNIQUE,
 *   ingest_server TEXT NOT NULL DEFAULT 'rtmps://9bb0dddfd063.global-contribute.live-video.net:443/app/',
 *   stream_key TEXT NOT NULL,
 *   playback_url TEXT NOT NULL,
 *   is_shared BOOLEAN DEFAULT true,
 *   is_live BOOLEAN DEFAULT false,
 *   viewer_count INTEGER DEFAULT 0,
 *   last_live_at TIMESTAMPTZ,
 *   created_at TIMESTAMPTZ DEFAULT now(),
 *   updated_at TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Index for fast lookups
 * CREATE INDEX IF NOT EXISTS idx_stream_channels_username ON stream_channels(username);
 * CREATE INDEX IF NOT EXISTS idx_stream_channels_is_live ON stream_channels(is_live);
 *
 * -- Row Level Security
 * ALTER TABLE stream_channels ENABLE ROW LEVEL SECURITY;
 *
 * -- ⚠️ IMPORTANT: RLS policies below use auth.uid()::text which returns a UUID,
 * -- but the username column stores human-readable usernames (e.g. "john").
 * -- If the client is unauthenticated (anon key), auth.uid() is NULL and all
 * -- write policies are denied. Either disable RLS for this table, use a
 * -- service_role key on the server, or fix the policies to match correctly.
 *
 * -- Sellers can read their own stream config
 * CREATE POLICY "Users can read own stream config" ON stream_channels
 *   FOR SELECT USING (auth.uid()::text = username OR is_shared = true);
 *
 * -- Sellers can update their own stream config
 * CREATE POLICY "Users can update own stream config" ON stream_channels
 *   FOR UPDATE USING (auth.uid()::text = username);
 *
 * -- ⚠️ MISSING: INSERT policy required for first-time broadcasters.
 * -- Without this, upsert for new users will be silently denied by RLS.
 * -- Example fix:
 * -- CREATE POLICY "Users can insert own stream config" ON stream_channels
 * --   FOR INSERT WITH CHECK (auth.uid()::text = username);
 *
 * -- Anyone can view live channels (for discovery)
 * CREATE POLICY "Anyone can view live channels" ON stream_channels
 *   FOR SELECT USING (is_live = true);
 */

const SUPABASE_TIMEOUT_MS = 5000;

export interface StreamChannel {
  id?: string;
  username: string;
  ingest_server: string;
  stream_key: string;
  playback_url: string;
  is_shared: boolean;
  is_live: boolean;
  viewer_count: number;
  last_live_at?: string;
  created_at?: string;
  updated_at?: string;
}

export const streamChannelService = {
  /**
   * Get stream channel config for a seller
   */
  async getChannel(username: string): Promise<StreamChannel | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('stream_channels')
          .select('*')
          .eq('username', username.toLowerCase())
          .single(),
        SUPABASE_TIMEOUT_MS,
        'getChannel'
      );
      if (error) return null;
      return data;
    } catch {
      return null;
    }
  },

  /**
   * Create or update stream channel config
   */
  async upsertChannel(channel: Partial<StreamChannel> & { username: string }): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await withTimeout(
        supabase
          .from('stream_channels')
          .upsert({
            ...channel,
            username: channel.username.toLowerCase(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'username' }),
        SUPABASE_TIMEOUT_MS,
        'upsertChannel'
      );
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Set live status for a channel.
   * Uses upsert so the row is created automatically if it doesn't exist yet
   * (first-time broadcasters). Required fields get sensible defaults.
   */
  async setLiveStatus(username: string, isLive: boolean, channelDefaults?: { ingest_server?: string; stream_key?: string; playback_url?: string }): Promise<boolean> {
    if (!supabase) return false;
    try {
      const now = new Date().toISOString();
      const updateData: Record<string, any> = {
        is_live: isLive,
        updated_at: now,
      };
      if (isLive) {
        updateData.last_live_at = now;
      } else {
        updateData.viewer_count = 0;
      }

      // Try update first (most common case: row already exists)
      const { data, error: updateError } = await withTimeout(
        supabase
          .from('stream_channels')
          .update(updateData)
          .eq('username', username.toLowerCase())
          .select('id'),
        SUPABASE_TIMEOUT_MS,
        'setLiveStatus.update'
      );

      if (updateError) return false;

      // If update matched no rows, create the channel via upsert
      if (!data || data.length === 0) {
        const defaults = {
          ingest_server: channelDefaults?.ingest_server || 'rtmps://9bb0dddfd063.global-contribute.live-video.net:443/app/',
          stream_key: channelDefaults?.stream_key || 'default',
          playback_url: channelDefaults?.playback_url || '',
        };
        const { error: upsertError } = await withTimeout(
          supabase
            .from('stream_channels')
            .upsert({
              username: username.toLowerCase(),
              ...defaults,
              ...updateData,
            }, { onConflict: 'username' }),
          SUPABASE_TIMEOUT_MS,
          'setLiveStatus.upsert'
        );
        return !upsertError;
      }

      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get all currently live channels
   */
  async getLiveChannels(): Promise<StreamChannel[]> {
    if (!supabase) return [];
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('stream_channels')
          .select('*')
          .eq('is_live', true)
          .order('viewer_count', { ascending: false }),
        SUPABASE_TIMEOUT_MS,
        'getLiveChannels'
      );
      if (error) return [];
      return data || [];
    } catch {
      return [];
    }
  },

  /**
   * Update viewer count
   */
  async updateViewerCount(username: string, count: number): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { error } = await withTimeout(
        supabase
          .from('stream_channels')
          .update({ viewer_count: count, updated_at: new Date().toISOString() })
          .eq('username', username.toLowerCase()),
        SUPABASE_TIMEOUT_MS,
        'updateViewerCount'
      );
      return !error;
    } catch {
      return false;
    }
  },
};

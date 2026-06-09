import React, { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import BroadcastScreen from '@/broadcast/BroadcastScreen';

/**
 * Native live-broadcast route. Reached from the WebView shell (the web "방송 시작"
 * action hands off to native here), carrying the seller username and optionally
 * pre-resolved IVS credentials as query params.
 */
export default function BroadcastRoute() {
  const params = useLocalSearchParams<{
    username?: string;
    ingestServer?: string;
    streamKey?: string;
  }>();

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  return (
    <BroadcastScreen
      username={params.username}
      initialIngestServer={params.ingestServer}
      initialStreamKey={params.streamKey}
      onClose={handleClose}
    />
  );
}

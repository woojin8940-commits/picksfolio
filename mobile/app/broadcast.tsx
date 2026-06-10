import React, { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import BroadcastScreen from '@/broadcast/BroadcastScreen';

/**
 * Native live-broadcast route. Reached from the WebView shell when the seller
 * taps "라이브 시작" (the web console calls `PicksFolioNative.startBroadcast`),
 * carrying the seller username and the per-broadcast product selection.
 *
 * The studio streams the phone camera to Amazon IVS with the device's hardware
 * encoder, and layers the web live console (products/banners/cart/chat) over the
 * camera as a transparent overlay so the seller keeps the full web console.
 */
export default function BroadcastRoute() {
  const params = useLocalSearchParams<{
    username?: string;
    products?: string;
  }>();

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  return (
    <BroadcastScreen
      username={params.username}
      productIds={params.products}
      onClose={handleClose}
    />
  );
}

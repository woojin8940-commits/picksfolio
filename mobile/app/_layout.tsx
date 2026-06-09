import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@/theme';

/**
 * Root layout. The app is a single full-screen WebView shell over the PICKS
 * Folio mobile web app, so there is no native navigation beyond the entry
 * screen and the not-found fallback.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen
          name="broadcast"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

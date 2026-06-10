import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { config } from '@/constants/config';

/**
 * Native push notifications for the PICKS Folio shell.
 *
 * The app renders the web app inside a WebView, so push is the only channel
 * that reaches the user when the app is closed. This module registers the
 * device's Expo push token against the logged-in user (the web app calls
 * `PicksFolioNative.registerPush` once signed in) so the server can deliver an
 * immediate alert when a new collaboration-timeline message arrives. Tapping a
 * notification deep-links the WebView straight to the conversation.
 */

// Show alerts (and play a sound / badge) even while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Android requires an explicit high-importance channel for heads-up alerts. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('messages', {
    name: '협업 메시지',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF4D7D',
  });
}

/**
 * Ask for permission (if not already granted) and resolve the device's Expo
 * push token. Returns null on a simulator, when permission is denied, or if the
 * token cannot be resolved — callers treat that as "push unavailable".
 */
async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return null;

  // EAS injects the project id into the build config; fall back gracefully.
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } })?.easConfig?.projectId;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return data;
  } catch (e) {
    console.warn('[push] failed to get token', e);
    return null;
  }
}

let lastRegistered = '';

/**
 * Register the current device for the signed-in user. Idempotent per
 * (user, type) within a session so repeated bridge calls are cheap.
 */
export async function registerPushForUser(
  username: string,
  userType: 'business' | 'influencer',
): Promise<void> {
  const uname = (username || '').trim();
  if (!uname) return;

  const key = `${userType}:${uname.toLowerCase()}`;
  if (key === lastRegistered) return;

  try {
    const token = await getPushToken();
    if (!token) return;

    await fetch(`${config.webUrl}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, username: uname, userType, platform: Platform.OS }),
    });
    lastRegistered = key;
  } catch (e) {
    console.warn('[push] register failed', e);
  }
}

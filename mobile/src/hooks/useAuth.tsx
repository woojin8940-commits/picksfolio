import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sampleProfile } from '@/data/mockData';
import type { CreatorProfile } from '@/types';

const SESSION_KEY = 'picksfolio.session';

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  profile: CreatorProfile | null;
  signIn: (handle: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY)
      .then((value) => setSignedIn(value === 'active'))
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (_handle: string) => {
    await AsyncStorage.setItem(SESSION_KEY, 'active');
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(SESSION_KEY);
    setSignedIn(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      signedIn,
      profile: signedIn ? sampleProfile : null,
      signIn,
      signOut,
    }),
    [ready, signedIn, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

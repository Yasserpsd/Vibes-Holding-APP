import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { colors } from '@/theme/tokens';

/** How long a visitor may look around before an account is required (the owner's rule: one minute at most). */
export const GUEST_SESSION_MS = 60_000;

type GuestGateValue = {
  /** The app is closed to this visitor: only the gate and the account screens open. */
  locked: boolean;
  /** The guest minute of this launch has been used. */
  guestOver: boolean;
  /** «المتابعة كضيف»: opens the app for one guest minute. */
  startGuest: () => void;
};

const GuestGateContext = createContext<GuestGateValue | null>(null);

/**
 * The app opens for members only. A visitor passes the gate (`/welcome`) by signing in, creating an
 * account, or taking a guest minute; when the minute is over the gate comes back. The minute is kept
 * per launch and never saved: a new launch starts at the gate again.
 */
export function GuestGateProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [guestUntil, setGuestUntil] = useState<number | null>(null);
  const [guestOver, setGuestOver] = useState(false);

  useEffect(() => {
    if (guestUntil === null) return;
    const timer = setTimeout(() => setGuestOver(true), Math.max(0, guestUntil - Date.now()));
    // Timers sleep while the app is in the background: the clock is read again on the way back.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() >= guestUntil) setGuestOver(true);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [guestUntil]);

  const startGuest = useCallback(() => {
    setGuestOver(false);
    setGuestUntil(Date.now() + GUEST_SESSION_MS);
  }, []);

  const locked = status === 'guest' && (guestUntil === null || guestOver);
  const value = useMemo<GuestGateValue>(() => ({ locked, guestOver, startGuest }), [locked, guestOver, startGuest]);

  return <GuestGateContext.Provider value={value}>{children}</GuestGateContext.Provider>;
}

export function useGuestGate(): GuestGateValue {
  const context = useContext(GuestGateContext);
  if (!context) throw new Error('useGuestGate must be used inside GuestGateProvider');
  return context;
}

/**
 * Sends a locked visitor to the gate from wherever he is, and covers the screen under him until the
 * gate has drawn (also while the saved session is still being read at start, so a visitor never sees
 * the home screen flash first). Rendered once, next to the root stack.
 */
export function GuestGate() {
  const { locked } = useGuestGate();
  const { hasSession } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navigationReady = useRootNavigationState()?.key != null;
  const first = segments[0];
  const atGate = first === 'welcome' || first === 'auth';

  useEffect(() => {
    if (!navigationReady || !locked || atGate) return;
    if (router.canDismiss()) router.dismissAll();
    router.replace('/welcome');
  }, [navigationReady, locked, atGate, router]);

  const covered = hasSession === null || (locked && !atGate);
  return covered ? <View style={styles.cover} /> : null;
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.black },
});

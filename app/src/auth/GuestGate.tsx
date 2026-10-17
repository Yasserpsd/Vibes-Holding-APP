import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { colors } from '@/theme/tokens';

/** How long a visitor may look around before an account is required (M74: a full week). */
export const GUEST_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/** The guest week survives launches: the first «المتابعة كضيف» tap is recorded on the device. */
const GUEST_START_KEY = 'investorsclub.guestStart';

type GuestGateValue = {
  /** The app is closed to this visitor: only the gate and the account screens open. */
  locked: boolean;
  /** The guest week has been used up. */
  guestOver: boolean;
  /** The saved guest start has been read: lock decisions are final. */
  ready: boolean;
  /** «المتابعة كضيف»: opens the app for a guest week. */
  startGuest: () => void;
};

const GuestGateContext = createContext<GuestGateValue | null>(null);

/**
 * The app opens for members only. A visitor passes the gate (`/welcome`) by signing in, creating an
 * account, or taking a guest week; when the week is over the gate comes back. The week's start is
 * saved on the device, so a returning visitor walks straight in until his week runs out (M74).
 */
export function GuestGateProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  // undefined = the saved start is still being read; null = no guest window.
  const [guestUntil, setGuestUntil] = useState<number | null | undefined>(undefined);
  const [guestOver, setGuestOver] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadSetting(GUEST_START_KEY).then((saved) => {
      if (!alive) return;
      const start = Number(saved);
      if (!saved || !Number.isFinite(start)) {
        setGuestUntil(null);
        return;
      }
      const until = start + GUEST_SESSION_MS;
      if (until > Date.now()) {
        setGuestUntil(until);
      } else {
        setGuestUntil(null);
        setGuestOver(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (guestUntil == null) return;
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
    const start = Date.now();
    void saveSetting(GUEST_START_KEY, String(start));
    setGuestOver(false);
    setGuestUntil(start + GUEST_SESSION_MS);
  }, []);

  const ready = guestUntil !== undefined;
  const locked = status === 'guest' && ready && (guestUntil === null || guestOver);
  const value = useMemo<GuestGateValue>(
    () => ({ locked, guestOver, ready, startGuest }),
    [locked, guestOver, ready, startGuest],
  );

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
  const { locked, ready } = useGuestGate();
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

  const covered = hasSession === null || !ready || (locked && !atGate);
  return covered ? <View style={styles.cover} /> : null;
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.black },
});

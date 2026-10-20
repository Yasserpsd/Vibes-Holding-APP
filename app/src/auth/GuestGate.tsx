import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { colors } from '@/theme/tokens';

/** The «المتابعة كضيف» tap is recorded on the device: a returning visitor walks straight in. */
const GUEST_START_KEY = 'investorsclub.guestStart';

type GuestGateValue = {
  /** The app is closed to this visitor: only the gate and the account screens open. */
  locked: boolean;
  /** The saved guest start has been read: lock decisions are final. */
  ready: boolean;
  /** «المتابعة كضيف»: opens the app's open content for good. */
  startGuest: () => void;
};

const GuestGateContext = createContext<GuestGateValue | null>(null);

/**
 * M109f (owner, 2026-10-20): guest mode is PERMANENT — the M74 guest week and its expiry are gone.
 * A visitor passes the gate (`/welcome`) once, by signing in, creating an account or choosing
 * «المتابعة كضيف», and from then on always browses the open content; member-only features answer
 * with the membership upsell instead of a closed door.
 */
export function GuestGateProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  // undefined = the saved choice is still being read; false = the visitor never passed the gate.
  const [guest, setGuest] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void loadSetting(GUEST_START_KEY).then((saved) => {
      if (alive) setGuest(Boolean(saved));
    });
    return () => {
      alive = false;
    };
  }, []);

  const startGuest = useCallback(() => {
    void saveSetting(GUEST_START_KEY, String(Date.now()));
    setGuest(true);
  }, []);

  const ready = guest !== undefined;
  const locked = status === 'guest' && ready && !guest;
  const value = useMemo<GuestGateValue>(() => ({ locked, ready, startGuest }), [locked, ready, startGuest]);

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

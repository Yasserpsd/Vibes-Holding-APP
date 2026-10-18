import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoldGradient } from '@/components/lux';
import { usePulse } from '@/components/motion';
import { colors, radii, shadows, spacing } from '@/theme/tokens';

import { contextParams, type ChatContext } from './context';

/**
 * Bottom padding of a scroll's content: air above the fixed bottom bar, enough for the advisor dock's
 * crown, which rises above the bar's top edge (owner, 2026-10-18: the floating button left; the advisor
 * lives as the golden circle docked in the middle of the bar).
 */
export const ASK_ADVISOR_CLEARANCE = spacing.xl;

/**
 * The same for any screen. Screens without a bar under them (the gate, auth, the player) run to the physical
 * bottom edge, so the bottom safe-area inset is part of their clearance; `aboveTabBar` leaves it out.
 */
export function useAskAdvisorClearance(aboveTabBar = false): number {
  const insets = useSafeAreaInsets();
  return ASK_ADVISOR_CLEARANCE + (aboveTabBar ? 0 : insets.bottom);
}

type Registration = { owner: string; context: ChatContext; aboveTabBar: boolean };
type Registry = { register: (registration: Registration) => void; release: (owner: string) => void };

// Two contexts: screens only register (stable functions), the button alone re-renders when the context changes.
const RegistryContext = createContext<Registry | null>(null);
const CurrentContext = createContext<Registration | null>(null);

/** Holds what the focused screen says the member is looking at. */
export function AskAdvisorProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Registration | null>(null);
  const registry = useMemo<Registry>(
    () => ({
      register: (registration) => setCurrent(registration),
      // A pushed screen focuses before the one under it blurs: only the owner may clear its own context.
      release: (owner) => setCurrent((previous) => (previous?.owner === owner ? null : previous)),
    }),
    [],
  );
  return (
    <RegistryContext.Provider value={registry}>
      <CurrentContext.Provider value={current}>{children}</CurrentContext.Provider>
    </RegistryContext.Provider>
  );
}

/**
 * A content screen names what it shows; while it is focused the floating «اسأل المستشار» button opens the
 * advisor with that context. Pass null until the data is loaded. Tab screens set `aboveTabBar`.
 */
export function useAdvisorScreen(context: ChatContext | null, aboveTabBar = false): void {
  const registry = useContext(RegistryContext);
  const owner = useId();
  // The context is rebuilt on every render of the screen: register again only when its content changes.
  const serialized = context ? JSON.stringify(context) : '';
  useFocusEffect(
    useCallback(() => {
      if (!registry || !serialized) return undefined;
      registry.register({ owner, context: JSON.parse(serialized) as ChatContext, aboveTabBar });
      return () => registry.release(owner);
    }, [registry, owner, serialized, aboveTabBar]),
  );
}

/** Opens the advisor tab with a context (inline «ناقش … مع المستشار» buttons use it too). */
export function useAskAdvisor(): (context: ChatContext, prompt?: string) => void {
  const router = useRouter();
  return useCallback((context, prompt) => router.navigate({ pathname: '/(tabs)/advisor', params: contextParams(context, prompt) }), [router]);
}

/** The focused screen's registered context, for the dock press in both bottom bars. */
export function useCurrentAdvisorContext(): ChatContext | null {
  return useContext(CurrentContext)?.context ?? null;
}

/** The dock circle's size and how far its crown rises above the bar's top edge. */
const DOCK_SIZE = 54;
export const ADVISOR_DOCK_RISE = 18;

/**
 * The advisor's home (owner, 2026-10-18): a raised golden circle docked in the MIDDLE of the bottom
 * bar — the world-class center-action pattern — in place of the old floating pill. Visual only: the
 * surrounding tab slot or Pressable handles the press (and passes the screen's context).
 */
export function AdvisorDockButton({ focused = false }: { focused?: boolean }) {
  const breath = usePulse(0.3, 0.85, 2200);
  return (
    <View style={dockStyles.slot} pointerEvents="none">
      <View style={dockStyles.circleBox}>
        <Animated.View style={[StyleSheet.absoluteFill, dockStyles.halo, { opacity: breath }]} />
        <GoldGradient variant="gold" style={[dockStyles.circle, focused && dockStyles.circleFocused]}>
          <Ionicons name="sparkles" size={24} color={colors.goldInk} />
        </GoldGradient>
      </View>
    </View>
  );
}

const dockStyles = StyleSheet.create({
  slot: { alignItems: 'center', justifyContent: 'flex-start' },
  // The crown rises above the bar; the dark ring cuts the circle out of the sheet like a socket.
  circleBox: { marginTop: -ADVISOR_DOCK_RISE },
  circle: {
    width: DOCK_SIZE,
    height: DOCK_SIZE,
    borderRadius: radii.pill,
    borderWidth: 3,
    borderColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGold,
  },
  circleFocused: { borderColor: colors.goldLight, boxShadow: shadows.glowGoldStrong },
  halo: { borderRadius: radii.pill, boxShadow: shadows.glowGold },
});

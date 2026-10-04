import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Animated, Keyboard, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoldGradient } from '@/components/lux';
import { FadeInView, PressScale, usePulse } from '@/components/motion';
import { t } from '@/i18n';
import { colors, fonts, gradients, radii, shadows, spacing } from '@/theme/tokens';

import { contextParams, type ChatContext } from './context';

/** Height of the bottom tab bar (React Navigation's default), for screens that sit above it. */
const TAB_BAR_HEIGHT = 49;
/** The button's geometry: the gold mark, the padding around it and the 1 px border make it 44 high. */
const MARK_SIZE = 30;
const BUTTON_PADDING = spacing.xs + 2;
const BUTTON_HEIGHT = MARK_SIZE + 2 * (BUTTON_PADDING + 1);
/** The button's distance from what it stands on: the bottom safe-area inset, or the tab bar. */
const BUTTON_OFFSET = spacing.md;

/**
 * Bottom padding of a tab screen's scroll content, so its last element scrolls clear of the floating button: the
 * button, its offset and some air above it. The tab bar already takes the bottom safe-area inset.
 */
export const ASK_ADVISOR_CLEARANCE = BUTTON_OFFSET + BUTTON_HEIGHT + spacing.md + spacing.xs;

/**
 * The same for any screen. A stack screen's scroll content runs to the physical bottom edge while the button stands
 * on the bottom safe-area inset (home indicator, Android navigation bar), so the inset is part of its clearance;
 * `aboveTabBar` leaves it out.
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

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return open;
}

/**
 * The floating button, rendered once above the navigator. Hidden when no screen registered a context, on the
 * auth screens, inside the advisor tab itself, and while the keyboard is open (it would cover the field).
 */
export function AskAdvisorButton() {
  const current = useContext(CurrentContext);
  const pathname = usePathname();
  const keyboardOpen = useKeyboardOpen();
  if (!current || keyboardOpen || pathname.startsWith('/auth') || pathname === '/advisor') return null;
  return <FloatingButton key={current.owner} registration={current} />;
}

/** The hero affordance of the app: it slides in, breathes a golden halo, and dips under the finger. */
function FloatingButton({ registration }: { registration: Registration }) {
  const ask = useAskAdvisor();
  const insets = useSafeAreaInsets();
  const breath = usePulse(0.3, 0.9, 1900);

  const bottom = insets.bottom + BUTTON_OFFSET + (registration.aboveTabBar ? TAB_BAR_HEIGHT : 0);

  return (
    <FadeInView delay={120} duration={260} offset={12} style={[styles.anchor, { bottom }]}>
      <PressScale
        onPress={() => ask(registration.context)}
        glow
        glowRadius={radii.pill}
        accessibilityLabel={t('advisor.askAbout', { title: registration.context.title })}
        style={styles.button}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.halo, { opacity: breath }]} />
        <GoldGradient variant="gold" style={styles.mark}>
          <Ionicons name="sparkles" size={16} color={colors.goldInk} />
        </GoldGradient>
        <Text style={styles.label} numberOfLines={1}>
          {t('advisor.ask')}
        </Text>
      </PressScale>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  // `end` is the left edge in the forced RTL layout, away from the text's starting side.
  anchor: { position: 'absolute', end: spacing.md, pointerEvents: 'box-none' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: BUTTON_PADDING,
    paddingStart: BUTTON_PADDING,
    paddingEnd: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.surfaceElevated,
    experimental_backgroundImage: gradients.surface,
    boxShadow: shadows.glowGoldFaint,
  },
  // The slow breathing neon halo around the button.
  halo: { borderRadius: radii.pill, boxShadow: shadows.glowGold },
  mark: { width: MARK_SIZE, height: MARK_SIZE, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  label: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22, color: colors.goldLight },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdvisorDockButton, useAskAdvisor, useCurrentAdvisorContext } from '@/components/advisor/AskAdvisor';
import { t, type StringKey } from '@/i18n';
import { useTabBadges } from '@/lib/badges';
import { useHiddenTabs } from '@/lib/personaTabs';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type TabDefinition = { key: string; path: Href; title: StringKey; icon: IoniconName; iconOutline: IoniconName };

// Mirrors the (tabs) bar (same order, icons and labels) so the two bars read as ONE fixed bar.
const TABS: TabDefinition[] = [
  { key: 'home', path: '/', title: 'tabs.home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'projects', path: '/projects', title: 'tabs.projects', icon: 'briefcase', iconOutline: 'briefcase-outline' },
  { key: 'advisor', path: '/advisor', title: 'tabs.advisor', icon: 'sparkles', iconOutline: 'sparkles-outline' },
  { key: 'news', path: '/news', title: 'tabs.inbox', icon: 'notifications', iconOutline: 'notifications-outline' },
  { key: 'account', path: '/account', title: 'tabs.account', icon: 'person', iconOutline: 'person-outline' },
];

// On these routes the bar stays away: the gate and auth flow (no tabs yet) and the fullscreen player.
const HIDDEN = ['/welcome', '/auth', '/watch'];
const TAB_PATHS = new Set(['/', '/projects', '/advisor', '/news', '/account']);

/** Which tab a detail screen belongs to, so the bar keeps a lit section while browsing deep pages. */
function sectionOf(path: string): string {
  if (path.startsWith('/project') || path.startsWith('/golden')) return 'projects';
  if (path.startsWith('/news') || path.startsWith('/posts')) return 'news';
  if (
    path.startsWith('/membership') ||
    path.startsWith('/payment') ||
    path.startsWith('/card') ||
    path.startsWith('/invite') ||
    path.startsWith('/security') ||
    path.startsWith('/delete-account') ||
    path.startsWith('/profile-edit')
  )
    return 'account';
  return 'home';
}

/**
 * Owner (2026-10-17): «خلي الشريط اللي تحت ثابت في كل الصفحات». The (tabs) navigator draws its own bar
 * only on the five tab screens; this bar renders on every OTHER screen, visually identical, so the
 * bottom bar never disappears. It lives in the root layout UNDER the Stack (normal flow, not overlay),
 * so every screen keeps its full height above it.
 */
export function GlobalTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const badges = useTabBadges();
  // The advisor dock opens the conversation knowing which detail page the member is on.
  const ask = useAskAdvisor();
  const advisorContext = useCurrentAdvisorContext();
  // M99: mirror the (tabs) bar — a tab the persona hides leaves this twin too.
  const hiddenTabs = useHiddenTabs();
  if (TAB_PATHS.has(pathname) || HIDDEN.some((prefix) => pathname.startsWith(prefix))) return null;
  const active = sectionOf(pathname);
  const badgeOf = (key: string): number =>
    key === 'news' ? badges.inbox : key === 'projects' ? badges.projects : key === 'home' ? badges.home : key === 'account' ? badges.account : 0;
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {TABS.filter((tab) => !hiddenTabs.has(tab.key)).map((tab) => {
        if (tab.key === 'advisor') {
          // Owner (2026-10-18): the raised golden circle in the middle — same dock as the (tabs) bar.
          return (
            <Pressable
              key={tab.key}
              onPress={() => (advisorContext ? ask(advisorContext) : router.navigate(tab.path))}
              accessibilityRole="button"
              accessibilityLabel={t(tab.title)}
              style={styles.item}
            >
              <AdvisorDockButton />
            </Pressable>
          );
        }
        const current = tab.key === active;
        const count = badgeOf(tab.key);
        return (
          <Pressable
            key={tab.key}
            onPress={() => router.navigate(tab.path)}
            accessibilityRole="button"
            accessibilityLabel={t(tab.title)}
            accessibilityState={{ selected: current }}
            style={styles.item}
          >
            <View style={styles.iconBox}>
              {current ? <View style={styles.halo} /> : null}
              <Ionicons name={current ? tab.icon : tab.iconOutline} size={22} color={current ? colors.gold : colors.textMuted} />
              {count > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{count > 9 ? '+9' : `+${count}`}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, current && styles.labelActive]} numberOfLines={1}>
              {t(tab.title)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // The same machined sheet as the (tabs) bar: rounded shoulders, golden hairline, lift.
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    experimental_backgroundImage: gradients.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderGoldSoft,
    borderTopStartRadius: radii.xxl,
    borderTopEndRadius: radii.xxl,
    boxShadow: shadows.lift,
    paddingTop: 4,
    paddingHorizontal: spacing.xs,
  },
  item: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  iconBox: { width: 38, height: 28, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 38,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  badge: {
    position: 'absolute',
    top: -4,
    end: -8,
    minWidth: 20,
    paddingHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 14, color: colors.goldInk, textAlign: 'center' },
  label: { ...typography.tabLabel, color: colors.textMuted },
  labelActive: { color: colors.gold },
});

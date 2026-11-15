import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter, useSegments, type Href } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdvisorDockButton, useAskAdvisor, useCurrentAdvisorContext } from '@/components/advisor/AskAdvisor';
import { NeonPulse } from '@/components/lux';
import { t, type StringKey } from '@/i18n';
import { useAppIconBadge, useTabBadges } from '@/lib/badges';
import { useHiddenTabs } from '@/lib/personaTabs';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type TabDefinition = { key: string; path: Href; title: StringKey; icon: IoniconName; iconOutline: IoniconName };

// Mirrors the (tabs) bar (same order, icons and labels) so the two bars read as ONE fixed bar.
const TABS: TabDefinition[] = [
  { key: 'home', path: '/', title: 'tabs.home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'projects', path: '/projects', title: 'tabs.projects', icon: 'briefcase', iconOutline: 'briefcase-outline' },
  { key: 'advisor', path: '/advisor', title: 'tabs.advisor', icon: 'sparkles', iconOutline: 'sparkles-outline' },
  // The group is spelled out: «/news» alone also names the news list (app/news/index), which is not this tab.
  { key: 'news', path: '/(tabs)/news', title: 'tabs.inbox', icon: 'mail', iconOutline: 'mail-outline' },
  { key: 'account', path: '/account', title: 'tabs.account', icon: 'person', iconOutline: 'person-outline' },
];

// The navigator's measurements (expo-router's bottom-tabs): the bar is 49 pt over the bottom inset, the icon
// is 25 pt in a 31×28 box, the badge is 0.75 × the icon.
const TAB_BAR_HEIGHT = 49;
const TAB_ICON_SIZE = 25;
const TAB_BADGE_SIZE = TAB_ICON_SIZE * 0.75;

// On these routes the bar stays away: the gate and auth flow (no tabs yet) and the fullscreen player.
const HIDDEN = ['/welcome', '/auth', '/watch'];
const TAB_PATHS = new Set(['/', '/projects', '/advisor', '/news', '/account']);

/** Which tab a detail screen belongs to, so the bar keeps a lit section while browsing deep pages. */
function sectionOf(path: string): string {
  if (path.startsWith('/project') || path.startsWith('/golden')) return 'projects';
  // The inbox tab lights for the management's messages only; news pages belong to the home's news door.
  if (path.startsWith('/posts')) return 'news';
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

/** Android resizes the window for the keyboard, which lifts this in-flow bar above it; the bar steps aside while typing (the (tabs) bar does the same). */
function useKeyboardOpenOnAndroid(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
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
  // M242: this component lives for the whole launch (it only draws nothing on some routes), so it also keeps
  // the number on the app icon equal to the unread management messages.
  useAppIconBadge();
  // The advisor dock opens the conversation knowing which detail page the member is on.
  const ask = useAskAdvisor();
  const advisorContext = useCurrentAdvisorContext();
  // M99: mirror the (tabs) bar — a tab the persona hides leaves this twin too.
  const hiddenTabs = useHiddenTabs();
  const keyboardOpen = useKeyboardOpenOnAndroid();
  const segments = useSegments();
  // The inbox tab and the news list both answer to «/news»; only the tab has the navigator's own bar,
  // so on the news list (first segment «news») this twin must show.
  const newsList = pathname === '/news' && segments[0] === 'news';
  if (keyboardOpen || (TAB_PATHS.has(pathname) && !newsList) || HIDDEN.some((prefix) => pathname.startsWith(prefix))) return null;
  const active = sectionOf(pathname);
  const badgeOf = (key: string): number =>
    key === 'news' ? badges.inbox : key === 'projects' ? badges.projects : key === 'home' ? badges.home : key === 'account' ? badges.account : 0;
  return (
    // The navigator's own box, number for number (see the styles): 49 pt of bar over the bottom inset.
    <View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom, paddingHorizontal: Math.max(insets.left, insets.right) }]}>
      {TABS.map((tab) => {
        // A tab the persona hides keeps its (empty) slot, as in the (tabs) bar: the advisor circle stays
        // in the middle with two slots on each side.
        if (hiddenTabs.has(tab.key)) return <View key={tab.key} style={styles.slot} />;
        if (tab.key === 'advisor') {
          // Owner (2026-10-18): the raised golden circle in the middle — same dock as the (tabs) bar,
          // inside the same icon box so it sits at the same height.
          return (
            <Pressable
              key={tab.key}
              onPress={() => (advisorContext ? ask(advisorContext) : router.navigate(tab.path))}
              accessibilityRole="button"
              accessibilityLabel={t(tab.title)}
              style={styles.item}
            >
              <View style={styles.iconBox}>
                <View style={styles.iconFill}>
                  <AdvisorDockButton />
                </View>
              </View>
            </Pressable>
          );
        }
        const current = tab.key === active;
        const count = badgeOf(tab.key);
        // M242: an unread management message lights «بريد وارد» here exactly as in the (tabs) bar.
        const unread = tab.key === 'news' && count > 0;
        const iconName = unread ? (current ? 'mail-unread' : 'mail-unread-outline') : current ? tab.icon : tab.iconOutline;
        return (
          <Pressable
            key={tab.key}
            onPress={() => router.navigate(tab.path)}
            accessibilityRole="button"
            accessibilityLabel={unread ? t('inbox.tabUnread', { count }) : t(tab.title)}
            accessibilityState={{ selected: current }}
            style={styles.item}
          >
            <View style={styles.iconBox}>
              {/* The glow first, the icon over it, the count last: the drawing order does the layering (no zIndex, M240). */}
              {unread ? (
                <View style={styles.unreadGlow} pointerEvents="none">
                  <NeonPulse radius={radii.pill} intensity="strong" duration={1300} />
                </View>
              ) : null}
              {current ? <View style={styles.halo} /> : null}
              <Ionicons name={iconName} size={TAB_ICON_SIZE} color={current || unread ? colors.gold : colors.textMuted} />
              {count > 0 ? (
                <Text style={styles.badge} numberOfLines={1} allowFontScaling={false}>
                  {count > 9 ? '+9' : `+${count}`}
                </Text>
              ) : null}
            </View>
            {/* Same rule as the (tabs) bar's TabLabel: no system font scaling, shrink to fit before any cut. */}
            <Text style={[styles.label, current && styles.labelActive]} numberOfLines={1} allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.75}>
              {t(tab.title)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
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
  },
  // Emulator review 2026-11-15 (item 35): this twin was 3 pt taller, its icons sat 3 pt inward and its active
  // mark was a pill, so the bar moved when a page opened. Every number below is the navigator's own
  // (expo-router's bottom-tabs: BottomTabItem `tabVerticalUiKit`, TabBarIcon `wrapperUikit`, Badge).
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', padding: 5 },
  slot: { flex: 1 },
  iconBox: { width: 31, height: 28, alignItems: 'center', justifyContent: 'center' },
  iconFill: { position: 'absolute', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' },
  // The active mark: the same 38 pt circle as the (tabs) bar's `haloFill`.
  halo: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  // The navigator's Badge (size = 0.75 × the icon) wearing the (tabs) bar's `tabBarBadgeStyle`.
  badge: {
    position: 'absolute',
    top: -3,
    end: -3,
    height: TAB_BADGE_SIZE,
    minWidth: 20,
    paddingHorizontal: 4,
    borderRadius: TAB_BADGE_SIZE / 2,
    overflow: 'hidden',
    textAlign: 'center',
    backgroundColor: colors.gold,
    color: colors.goldInk,
    fontFamily: fonts.bold,
    fontSize: 10,
    lineHeight: 14,
    boxShadow: shadows.glowGoldFaint,
  },
  // M242: the unread glow behind the envelope — the same pill as the (tabs) bar.
  unreadGlow: { position: 'absolute', width: 40, height: 30, borderRadius: radii.pill, backgroundColor: colors.goldSoft },
  label: { ...typography.tabLabel, color: colors.textMuted, textAlign: 'center' },
  labelActive: { color: colors.goldText },
}));

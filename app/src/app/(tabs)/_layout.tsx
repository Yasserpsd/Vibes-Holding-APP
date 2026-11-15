import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, Platform, StyleSheet, Text, View, type ColorValue } from 'react-native';

import { AdvisorDockButton, useAskAdvisor, useCurrentAdvisorContext } from '@/components/advisor/AskAdvisor';
import { NeonPulse } from '@/components/lux';
import { PopIn } from '@/components/motion';
import { t, type StringKey } from '@/i18n';
import { useTabBadges } from '@/lib/badges';
import { useHiddenTabs } from '@/lib/personaTabs';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type TabDefinition = {
  name: string;
  title: StringKey;
  icon: IoniconName;
  iconOutline: IoniconName;
};

// Order matters: the first tab sits where reading starts (the right in Arabic, the left in English).
const TABS: TabDefinition[] = [
  { name: 'index', title: 'tabs.home', icon: 'home', iconOutline: 'home-outline' },
  { name: 'projects', title: 'tabs.projects', icon: 'briefcase', iconOutline: 'briefcase-outline' },
  { name: 'advisor', title: 'tabs.advisor', icon: 'sparkles', iconOutline: 'sparkles-outline' },
  // M75 (owner): the news tab became the fixed «الإشعارات» center for every persona.
  // M232 (owner): it is the member's «بريد وارد» / Inbox — an envelope, with the management's messages first.
  { name: 'news', title: 'tabs.inbox', icon: 'mail', iconOutline: 'mail-outline' },
  { name: 'account', title: 'tabs.account', icon: 'person', iconOutline: 'person-outline' },
];

/** M38/V2: the chosen tab's icon pops and settles over a golden halo — the bar answers the finger. */
function TabIcon({ name, color, size, focused, unread = false }: { name: IoniconName; color: ColorValue; size: number; focused: boolean; unread?: boolean }) {
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!focused) return;
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.22, speed: 40, bounciness: 14, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 30, bounciness: 6, useNativeDriver: true }),
    ]).start();
  }, [focused, scale]);
  return (
    <Animated.View style={[styles.icon, { transform: [{ scale }] }]}>
      {/* M242: an unread management message lights the envelope — a soft gold glow breathing BEHIND the icon
          (drawn first, no zIndex: M240); NeonPulse holds still under «reduce motion». */}
      {unread ? (
        <View style={styles.halo} pointerEvents="none">
          <View style={styles.unreadGlow}>
            <NeonPulse radius={radii.pill} intensity="strong" duration={1300} />
          </View>
        </View>
      ) : null}
      {focused ? (
        <PopIn style={styles.halo}>
          <View style={styles.haloFill} />
        </PopIn>
      ) : null}
      <Ionicons name={name} color={unread ? colors.gold : color} size={size} />
    </Animated.View>
  );
}

/**
 * The bar's label. Never scaled by the system font size and shrunk to fit before it is ever cut: a fifth of the
 * width holds one line, and a Samsung phone with a larger font drew «بنك المشا…». Same face, size and colour as
 * the navigator's own label, so nothing changes on a phone where the words already fit.
 */
function TabLabel({ title, color }: { title: string; color: ColorValue }) {
  return (
    <Text style={[styles.label, { color }]} numberOfLines={1} allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.75}>
      {title}
    </Text>
  );
}

export default function TabsLayout() {
  // M75: «+N» on the tabs — fresh things since this device last looked.
  const badges = useTabBadges();
  // The advisor dock opens the conversation knowing what the member was looking at (the old FAB's brain).
  const ask = useAskAdvisor();
  const advisorContext = useCurrentAdvisorContext();
  // M99: the persona decides the bar — a hidden tab leaves it (its screen stays reachable by path).
  const hiddenTabs = useHiddenTabs();
  const badgeOf = (name: string): number =>
    name === 'news' ? badges.inbox : name === 'projects' ? badges.projects : name === 'index' ? badges.home : name === 'account' ? badges.account : 0;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.black },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textMuted,
        // V2: the bar reads as a machined dark sheet — rounded top shoulders over the black,
        // a lit golden hairline along its edge. Attached (not floating), so the default bar
        // height stays true and every screen's existing bottom clearance keeps working.
        tabBarStyle: {
          backgroundColor: colors.surface,
          experimental_backgroundImage: gradients.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.borderGoldSoft,
          borderTopStartRadius: radii.xxl,
          borderTopEndRadius: radii.xxl,
          // No overflow:'hidden': the advisor dock's crown rises above the bar's top edge
          // (the twin GlobalTabBar already renders these corners fine without it).
          boxShadow: shadows.lift,
        },
        tabBarLabelStyle: typography.tabLabel,
        // The labels and the count badge keep their size whatever the system font size is (see TabLabel).
        tabBarAllowFontScaling: false,
        // Android resizes the window for the keyboard, so the bar would ride above it and eat the
        // composer's room (advisor chat, searches); it steps aside while typing. iOS keeps its bar.
        tabBarHideOnKeyboard: Platform.OS === 'android',
      }}
    >
      {TABS.map((tab) =>
        tab.name === 'advisor' ? (
          // Owner (2026-10-18): the advisor is THE raised golden circle in the middle of the bar — no label.
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.title),
              tabBarIcon: ({ focused }) => <AdvisorDockButton focused={focused} />,
              tabBarLabel: () => null,
              // No visible label, so the screen reader needs one of its own.
              tabBarAccessibilityLabel: t(tab.title),
            }}
            listeners={{
              tabPress: (event) => {
                // With a registered screen context, the dock opens the advisor already briefed on it.
                if (!advisorContext) return;
                event.preventDefault();
                ask(advisorContext);
              },
            }}
          />
        ) : (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.title),
              // A tab the persona hides (M99) draws nothing but KEEPS its slot, so the advisor circle stays in
              // the middle of the bar — two slots on each side (emulator review, item 17). `href: null` removed
              // the slot and pushed the circle off-centre. The screen itself stays reachable by its path.
              tabBarButton: hiddenTabs.has(tab.name) ? () => null : undefined,
              tabBarIcon: ({ color, focused, size }) =>
                // M242: «بريد وارد» with an unread management message — the gold «unread» envelope over its glow.
                tab.name === 'news' && badges.inbox > 0 ? (
                  <TabIcon name={focused ? 'mail-unread' : 'mail-unread-outline'} color={color} size={size} focused={focused} unread />
                ) : (
                  <TabIcon name={focused ? tab.icon : tab.iconOutline} color={color} size={size} focused={focused} />
                ),
              tabBarLabel: ({ color }) => <TabLabel title={t(tab.title)} color={color} />,
              // The label is drawn by TabLabel, so the screen reader's words are set here.
              tabBarAccessibilityLabel: tab.name === 'news' && badges.inbox > 0 ? t('inbox.tabUnread', { count: badges.inbox }) : t(tab.title),
              tabBarBadge: badgeOf(tab.name) > 0 ? (badgeOf(tab.name) > 9 ? '+9' : `+${badgeOf(tab.name)}`) : undefined,
              tabBarBadgeStyle: styles.badge,
            }}
          />
        ),
      )}
    </Tabs>
  );
}

const styles = themedStyles(() => ({
  icon: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  haloFill: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  // M242: the unread glow behind the envelope — the same pill in both bars (GlobalTabBar).
  unreadGlow: { width: 40, height: 30, borderRadius: radii.pill, backgroundColor: colors.goldSoft },
  // The navigator's own label style (centred, transparent) on the app's tab face.
  label: { ...typography.tabLabel, textAlign: 'center', backgroundColor: 'transparent' },
  // M75: the «+N» pill on a tab — small, golden, impossible to miss.
  badge: {
    backgroundColor: colors.gold,
    color: colors.goldInk,
    fontFamily: fonts.bold,
    fontSize: 10,
    lineHeight: 14,
    minWidth: 20,
    boxShadow: shadows.glowGoldFaint,
  },
}));

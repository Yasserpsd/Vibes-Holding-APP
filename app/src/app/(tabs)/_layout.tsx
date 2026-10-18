import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, StyleSheet, View, type ColorValue } from 'react-native';

import { AdvisorDockButton, useAskAdvisor, useCurrentAdvisorContext } from '@/components/advisor/AskAdvisor';
import { PopIn } from '@/components/motion';
import { t, type StringKey } from '@/i18n';
import { useTabBadges } from '@/lib/badges';
import { useHiddenTabs } from '@/lib/personaTabs';
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
  { name: 'news', title: 'tabs.inbox', icon: 'notifications', iconOutline: 'notifications-outline' },
  { name: 'account', title: 'tabs.account', icon: 'person', iconOutline: 'person-outline' },
];

/** M38/V2: the chosen tab's icon pops and settles over a golden halo — the bar answers the finger. */
function TabIcon({ name, color, size, focused }: { name: IoniconName; color: ColorValue; size: number; focused: boolean }) {
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
      {focused ? (
        <PopIn style={styles.halo}>
          <View style={styles.haloFill} />
        </PopIn>
      ) : null}
      <Ionicons name={name} color={color} size={size} />
    </Animated.View>
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
              href: hiddenTabs.has(tab.name) ? null : undefined,
              tabBarIcon: ({ color, focused, size }) => (
                <TabIcon name={focused ? tab.icon : tab.iconOutline} color={color} size={size} focused={focused} />
              ),
              tabBarBadge: badgeOf(tab.name) > 0 ? (badgeOf(tab.name) > 9 ? '+9' : `+${badgeOf(tab.name)}`) : undefined,
              tabBarBadgeStyle: styles.badge,
            }}
          />
        ),
      )}
    </Tabs>
  );
}

const styles = StyleSheet.create({
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
});

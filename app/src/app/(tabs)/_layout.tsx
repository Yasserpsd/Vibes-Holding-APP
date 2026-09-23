import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, type ColorValue } from 'react-native';

import { t, type StringKey } from '@/i18n';
import { colors, typography } from '@/theme/tokens';

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
  { name: 'news', title: 'tabs.news', icon: 'newspaper', iconOutline: 'newspaper-outline' },
  { name: 'account', title: 'tabs.account', icon: 'person', iconOutline: 'person-outline' },
];

/** M38: the chosen tab's icon pops and settles — the bar answers the finger. */
function TabIcon({ name, color, size, focused }: { name: IoniconName; color: ColorValue; size: number; focused: boolean }) {
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!focused) return;
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.2, speed: 40, bounciness: 12, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 30, bounciness: 6, useNativeDriver: true }),
    ]).start();
  }, [focused, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons name={name} color={color} size={size} />
    </Animated.View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.black },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: typography.tabLabel,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.title),
            tabBarIcon: ({ color, focused, size }) => (
              <TabIcon name={focused ? tab.icon : tab.iconOutline} color={color} size={size} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

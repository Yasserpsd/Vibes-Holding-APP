import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

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
              <Ionicons name={focused ? tab.icon : tab.iconOutline} color={color} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

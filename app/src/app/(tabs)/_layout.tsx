import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { colors, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type TabDefinition = {
  name: string;
  title: string;
  icon: IoniconName;
  iconOutline: IoniconName;
};

// Order matters: in RTL the first tab is rendered on the right.
const TABS: TabDefinition[] = [
  { name: 'index', title: 'الرئيسية', icon: 'home', iconOutline: 'home-outline' },
  { name: 'projects', title: 'بنك المشاريع', icon: 'briefcase', iconOutline: 'briefcase-outline' },
  { name: 'advisor', title: 'المستشار', icon: 'sparkles', iconOutline: 'sparkles-outline' },
  { name: 'news', title: 'الأخبار', icon: 'newspaper', iconOutline: 'newspaper-outline' },
  { name: 'account', title: 'حسابي', icon: 'person', iconOutline: 'person-outline' },
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
            title: tab.title,
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons name={focused ? tab.icon : tab.iconOutline} color={color} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

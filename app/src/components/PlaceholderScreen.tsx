import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { env } from '@/config/env';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const clubLogo = require('../../assets/images/club-logo.png');

type Props = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function PlaceholderScreen({ title, description, children }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Image source={clubLogo} style={styles.logo} resizeMode="contain" accessibilityLabel="نادي المستثمرين" />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {children ?? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>قيد الإنشاء</Text>
          </View>
        )}
      </View>
      <Text style={styles.footer}>
        {env.isProduction ? `الإصدار ${env.appVersion}` : `نسخة تجريبية · الإصدار ${env.appVersion}`}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.gold,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  badge: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  badgeText: {
    ...typography.caption,
    color: colors.goldLight,
  },
  footer: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingBottom: spacing.md,
  },
});

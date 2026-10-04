import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeInView, Floating } from '@/components/motion';
import { env } from '@/config/env';
import { t } from '@/i18n';
import { colors, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const clubEmblem = require('../../assets/images/club-emblem.png');

type Props = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function PlaceholderScreen({ title, description, children }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Floating>
          <View style={styles.emblemWrap}>
            <View style={styles.halo} />
            <Image source={clubEmblem} style={styles.emblem} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
          </View>
        </Floating>
        <FadeInView delay={120} offset={12}>
          <Text style={styles.title}>{title}</Text>
        </FadeInView>
        <FadeInView delay={200} offset={12}>
          <Text style={styles.description}>{description}</Text>
        </FadeInView>
        {children ?? (
          <FadeInView delay={280} offset={10}>
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {t('common.underConstruction')}
              </Text>
            </View>
          </FadeInView>
        )}
      </View>
      <Text style={styles.footer}>
        {t(env.isProduction ? 'account.version' : 'account.versionPreview', { version: env.appVersion })}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.black,
    experimental_backgroundImage: gradients.screen,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  emblemWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  halo: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: radii.pill,
    backgroundColor: colors.goldFaint,
    boxShadow: shadows.glowGold,
  },
  emblem: {
    width: 140,
    height: 140,
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
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
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

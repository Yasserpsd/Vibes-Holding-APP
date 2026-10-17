import Ionicons from '@expo/vector-icons/Ionicons';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FadeInView, SkeletonCards, usePulse, Wiggle } from '@/components/motion';
import { t } from '@/i18n';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
};

/** Loading, error and empty states for list and detail screens. */
export function StateView({ loading, error, onRetry, empty, emptyText }: Props) {
  // Hook order must not depend on which state renders.
  const pulse = usePulse(0.55, 1, 900);
  if (loading) {
    // M38: ghost cards breathe while the list loads, instead of a bare spinner.
    return (
      <View style={styles.skeleton} accessibilityLabel={t('common.loading')}>
        <SkeletonCards />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.box}>
        <FadeInView offset={10}>
          {/* M84e: the offline cloud nudges every few seconds — the eye lands on the retry. */}
          <Wiggle delay={400} repeatEvery={3600}>
            <View style={styles.iconRing}>
              <Ionicons name="cloud-offline-outline" size={32} color={colors.goldLight} />
            </View>
          </Wiggle>
        </FadeInView>
        <FadeInView delay={90} offset={10}>
          <Text style={styles.text}>{errorMessage(error)}</Text>
        </FadeInView>
        {onRetry ? (
          <FadeInView delay={180} offset={10}>
            <AppButton label={t('common.retry')} variant="outline" icon="refresh" onPress={onRetry} />
          </FadeInView>
        ) : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.box}>
        <FadeInView offset={10}>
          <Animated.View style={{ opacity: pulse }}>
            <View style={styles.iconRing}>
              <Ionicons name="search-outline" size={32} color={colors.goldLight} />
            </View>
          </Animated.View>
        </FadeInView>
        <FadeInView delay={90} offset={10}>
          <Text style={styles.text}>{emptyText ?? t('common.noResults')}</Text>
        </FadeInView>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  skeleton: {
    paddingVertical: spacing.md,
  },
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

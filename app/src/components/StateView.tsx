import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FadeInView, SkeletonCards } from '@/components/motion';
import { t } from '@/i18n';
import { colors, spacing, typography } from '@/theme/tokens';

type Props = {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
};

/** Loading, error and empty states for list and detail screens. */
export function StateView({ loading, error, onRetry, empty, emptyText }: Props) {
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
      <FadeInView style={styles.box}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={styles.text}>{errorMessage(error)}</Text>
        {onRetry ? <AppButton label={t('common.retry')} variant="outline" icon="refresh" onPress={onRetry} /> : null}
      </FadeInView>
    );
  }
  if (empty) {
    return (
      <FadeInView style={styles.box}>
        <Ionicons name="search-outline" size={36} color={colors.textMuted} />
        <Text style={styles.text}>{emptyText ?? t('common.noResults')}</Text>
      </FadeInView>
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
  text: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

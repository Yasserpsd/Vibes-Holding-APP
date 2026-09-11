import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { colors, spacing, typography } from '@/theme/tokens';

type Props = {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
};

/** Loading, error and empty states for list and detail screens. */
export function StateView({ loading, error, onRetry, empty, emptyText = 'لا توجد نتائج' }: Props) {
  if (loading) {
    return (
      <View style={styles.box}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.box}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={styles.text}>{errorMessage(error)}</Text>
        {onRetry ? <AppButton label="إعادة المحاولة" variant="outline" icon="refresh" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.box}>
        <Ionicons name="search-outline" size={36} color={colors.textMuted} />
        <Text style={styles.text}>{emptyText}</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
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

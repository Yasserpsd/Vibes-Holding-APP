import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = { text: string; tone?: 'info' | 'warning' | 'success' };

/** Short inline notice (policy hint, test-mode reminder, success message). */
export function Notice({ text, tone = 'info' }: Props) {
  const color = tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.goldLight;
  const icon = tone === 'warning' ? 'warning-outline' : tone === 'success' ? 'checkmark-circle-outline' : 'information-circle-outline';
  return (
    <View style={[styles.box, { borderColor: color }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  text: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: 'right' },
});

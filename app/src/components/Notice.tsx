import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { FadeInView, PopIn, Wiggle } from '@/components/motion';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = { text: string; tone?: 'info' | 'warning' | 'success' };

/** Short inline notice (policy hint, test-mode reminder, success message). */
export function Notice({ text, tone = 'info' }: Props) {
  const color = tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.goldLight;
  const icon = tone === 'warning' ? 'warning-outline' : tone === 'success' ? 'checkmark-circle-outline' : 'information-circle-outline';
  return (
    <FadeInView offset={8}>
      <View style={[styles.box, tone === 'info' ? styles.boxGold : { borderColor: color }]}>
        {/* M84e: a warning shakes once to be seen; the others pop into place. */}
        {tone === 'warning' ? (
          <Wiggle delay={260}>
            <View style={styles.iconChip}>
              <Ionicons name={icon} size={16} color={color} />
            </View>
          </Wiggle>
        ) : (
          <PopIn delay={120}>
            <View style={styles.iconChip}>
              <Ionicons name={icon} size={16} color={color} />
            </View>
          </PopIn>
        )}
        <Text style={styles.text}>{text}</Text>
      </View>
    </FadeInView>
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
  // Gold tone reads as a soft golden wash instead of a hard outline.
  boxGold: {
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldSoft,
  },
  iconChip: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldFaint,
  },
  text: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: textStart },
});

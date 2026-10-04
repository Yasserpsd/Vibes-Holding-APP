import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { PressScale } from '@/components/motion';
import { chevronForward, textStart } from '@/i18n/direction';
import { colors, fonts, gradients, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  title: string;
  subtitle?: string | null;
  cta?: string | null;
  onPress?: () => void;
};

/** Section title behind a small gold accent bar, with an optional «عرض الكل» link on the far side. */
export function SectionHeader({ title, subtitle, cta, onPress }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.accent} />
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {cta && onPress ? (
        <PressScale onPress={onPress} hitSlop={8} accessibilityRole="button" wrapStyle={styles.ctaWrap} style={styles.cta}>
          <Text style={styles.ctaText}>{cta}</Text>
          <Ionicons name={chevronForward()} size={14} color={colors.gold} />
        </PressScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  accent: {
    width: 4,
    alignSelf: 'stretch',
    minHeight: 24,
    borderRadius: 2,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGoldFaint,
    marginBottom: 2,
  },
  texts: { flex: 1, gap: 2 },
  title: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  ctaWrap: { flexShrink: 0 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: 4 },
  ctaText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.gold },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing, typography } from '@/theme/tokens';

type Props = {
  title: string;
  subtitle?: string | null;
  cta?: string | null;
  onPress?: () => void;
};

/** Section title with an optional «عرض الكل» link on the far side. */
export function SectionHeader({ title, subtitle, cta, onPress }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {cta && onPress ? (
        <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
          <Text style={styles.ctaText}>{cta}</Text>
          <Ionicons name="chevron-back" size={14} color={colors.gold} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  texts: { flex: 1, gap: 2 },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'right' },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: 4, flexShrink: 0 },
  ctaText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.gold },
  pressed: { opacity: 0.7 },
});

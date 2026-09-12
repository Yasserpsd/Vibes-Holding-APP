import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HomePortal } from '@/api/content';
import { iconFor } from '@/lib/icons';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = { portal: HomePortal; onPress: () => void };

/** One of the three home portals: a large gold-accented card. */
export function PortalCard({ portal, onPress }: Props) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.accent} />
      <View style={styles.iconBox}>
        <Ionicons name={iconFor(portal.icon, 'grid-outline')} size={28} color={colors.black} />
      </View>
      <View style={styles.texts}>
        <Text style={styles.title}>{portal.title}</Text>
        <Text style={styles.subtitle}>{portal.subtitle}</Text>
      </View>
      <Ionicons name="chevron-back" size={22} color={colors.gold} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.md,
    paddingStart: spacing.md + 6,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', start: 0, top: 0, bottom: 0, width: 5, backgroundColor: colors.gold },
  pressed: { opacity: 0.85 },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  texts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 28, color: colors.textPrimary, textAlign: 'right' },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
});

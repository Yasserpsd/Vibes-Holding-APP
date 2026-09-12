import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Service } from '@/api/content';
import { iconFor } from '@/lib/icons';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = { service: Service; onPress: () => void };

/** A service row; member-only services appear dimmed with a lock for guests and unactivated accounts. */
export function ServiceCard({ service, onPress }: Props) {
  const { locked } = service;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, locked && styles.lockedCard, pressed && styles.pressed]}>
      <View style={[styles.iconBox, locked && styles.dim]}>
        <Ionicons name={iconFor(service.icon)} size={22} color={locked ? colors.textMuted : colors.gold} />
      </View>
      <View style={styles.texts}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, locked && styles.dim]} numberOfLines={2}>
            {service.title}
          </Text>
          {locked ? (
            <View style={styles.lock}>
              <Ionicons name="lock-closed" size={11} color={colors.goldLight} />
              <Text style={styles.lockText}>للأعضاء</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.summary, locked && styles.dim]} numberOfLines={2}>
          {service.summary}
        </Text>
        {service.priceLabel || service.memberLabel ? (
          <View style={styles.labels}>
            {service.priceLabel ? <Text style={[styles.price, locked && styles.dim]}>{service.priceLabel}</Text> : null}
            {service.memberLabel ? <Text style={[styles.member, locked && styles.dim]}>{service.memberLabel}</Text> : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-back" size={18} color={locked ? colors.textMuted : colors.gold} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  lockedCard: { borderStyle: 'dashed' },
  pressed: { opacity: 0.8 },
  dim: { opacity: 0.5 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  texts: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: 'right', flexShrink: 1 },
  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  lockText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  summary: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  price: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.textPrimary },
  member: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldLight },
});

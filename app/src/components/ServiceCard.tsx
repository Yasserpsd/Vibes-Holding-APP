import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { Service } from '@/api/content';
import { GlassCard } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = { service: Service; onPress: () => void };

/** A service row; member-only services keep full-strength layout but muted colors, with a bright lock pill. */
export function ServiceCard({ service, onPress }: Props) {
  const { locked } = service;
  return (
    <PressScale onPress={onPress}>
      <GlassCard style={[styles.card, locked && styles.lockedCard]}>
        <View style={[styles.iconBox, !locked && styles.iconBoxLit]}>
          <Ionicons name={iconFor(service.icon)} size={22} color={locked ? colors.textMuted : colors.gold} />
        </View>
        <View style={styles.texts}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, locked && styles.lockedTitle]} numberOfLines={2}>
              {service.title}
            </Text>
            {locked ? (
              <View style={styles.lock}>
                <Ionicons name="lock-closed" size={11} color={colors.goldLight} />
                <Text style={styles.lockText}>{t('services.membersOnly')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.summary, locked && styles.lockedBody]} numberOfLines={2}>
            {service.summary}
          </Text>
          {service.priceLabel || service.memberLabel ? (
            <View style={styles.labels}>
              {service.priceLabel ? <Text style={[styles.price, locked && styles.lockedBody]}>{service.priceLabel}</Text> : null}
              {service.memberLabel ? <Text style={[styles.member, locked && styles.lockedGold]}>{service.memberLabel}</Text> : null}
            </View>
          ) : null}
        </View>
        <Ionicons name={chevronForward()} size={18} color={locked ? colors.textMuted : colors.gold} />
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  lockedCard: { borderStyle: 'dashed' },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  // Unlocked services carry the brand: a golden wash with a whisper of neon.
  iconBoxLit: {
    backgroundColor: colors.goldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  texts: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart, flexShrink: 1 },
  lockedTitle: { color: colors.textSecondary },
  lockedBody: { color: colors.textMuted },
  lockedGold: { color: colors.goldDark },
  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  lockText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  summary: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  price: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.textPrimary },
  member: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldLight },
});

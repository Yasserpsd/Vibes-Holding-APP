import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { Service } from '@/api/content';
import { PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { colors, fonts, radii, serviceAccents, shadows, spacing, typography } from '@/theme/tokens';

type Props = { service: Service; onPress: () => void };

/**
 * M85 (owner, from the reference app): a compact light tile for the 2-column services grid —
 * white card, ink text, a soft-tinted icon badge in the group's accent, and the imperative
 * CTA as a small corner pill. Locked services dim and wear the lock pill instead.
 */
export function ServiceTile({ service, onPress }: Props) {
  const { locked } = service;
  const accent = serviceAccents[service.group] ?? serviceAccents.entrepreneur;
  return (
    <PressScale onPress={onPress} wrapStyle={styles.wrap} accessibilityRole="button" accessibilityLabel={service.title}>
      <View style={[styles.card, locked && styles.lockedCard]}>
        <View style={styles.topRow}>
          {/* M84e: the icon badge pops into place — the tile's icon leads, alive. */}
          <PopIn delay={120}>
            <View style={[styles.badge, { backgroundColor: locked ? colors.paperBorder : accent.tint }]}>
              <Ionicons name={iconFor(service.icon)} size={22} color={locked ? colors.paperMuted : accent.ink} />
            </View>
          </PopIn>
          {locked ? (
            <View style={[styles.pill, styles.lockPill]}>
              <Ionicons name="lock-closed" size={10} color={colors.paperGold} />
              <Text style={[styles.pillText, { color: colors.paperGold }]} numberOfLines={1}>
                {t('services.membersOnly')}
              </Text>
            </View>
          ) : service.cta ? (
            <View style={[styles.pill, { backgroundColor: accent.tint }]}>
              <Text style={[styles.pillText, { color: accent.ink }]} numberOfLines={1}>
                {service.cta}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.title, locked && styles.lockedText]} numberOfLines={2}>
          {service.title}
        </Text>
        <Text style={[styles.summary, locked && styles.lockedText]} numberOfLines={2}>
          {service.summary}
        </Text>
        {service.memberLabel || service.priceLabel ? (
          <Text style={[styles.meta, locked && styles.lockedText]} numberOfLines={1}>
            {service.memberLabel ?? service.priceLabel}
          </Text>
        ) : null}
      </View>
    </PressScale>
  );
}

/** The grid container: two tiles per row with an even gutter. */
export const serviceGridStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm } as const;

/** The grid CHILD (the FadeInView around a tile): basis + grow halve the row whatever the width. */
export const serviceTileWrapStyle = { flexBasis: '47%' as const, flexGrow: 1 };

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  card: {
    flex: 1,
    backgroundColor: colors.paperCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.paperBorder,
    padding: spacing.sm + 4,
    gap: spacing.xs,
    boxShadow: shadows.lift,
  },
  lockedCard: { backgroundColor: colors.paper, opacity: 0.82 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.xs },
  badge: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    maxWidth: 110,
  },
  lockPill: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.paperBorder },
  pillText: { fontFamily: fonts.semiBold, fontSize: 10, lineHeight: 15 },
  title: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 21, color: colors.paperInk, textAlign: textStart },
  summary: { ...typography.caption, fontSize: 11, lineHeight: 17, color: colors.paperInkSoft, textAlign: textStart },
  meta: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.paperGold, textAlign: textStart },
  lockedText: { opacity: 0.75 },
});

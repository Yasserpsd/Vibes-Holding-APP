import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import type { Service } from '@/api/content';
import { GlassCard, GoldHairline } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { PopIn, PressScale } from '@/components/motion';
import { SarText } from '@/components/SarText';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { iconFor } from '@/lib/icons';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = { service: Service; onPress: () => void };

/**
 * M220 (owner, 2026-11-09: «شكله حد علق … محتاج تغيير كامل»): the services tile is now dark glass
 * with a gold hairline, like the rest of the V2 home — a lit gold icon ring, the imperative CTA as an
 * outlined gold pill, then a gold filament above the member price and the saving. The old ivory
 * block with the washed photo is gone. The summary gets three lines so it rarely ends in «…».
 * Locked services dim, go dashed and wear the lock pill instead of the CTA.
 */
export function ServiceTile({ service, onPress }: Props) {
  const { locked } = service;
  return (
    // M120 (owner): tapping a members-only service answers with the subscribe popup, not the page.
    <PressScale onPress={locked ? showMembershipGate : onPress} wrapStyle={styles.wrap} accessibilityRole="button" accessibilityLabel={service.title}>
      <GlassCard golden={!locked} style={[styles.card, locked && styles.lockedCard]}>
        <View style={styles.topRow}>
          {/* M84e: the icon ring pops into place — the tile's icon leads, alive. */}
          <PopIn delay={120}>
            <View style={[styles.badge, locked && styles.badgeLocked]}>
              <Ionicons name={iconFor(service.icon)} size={22} color={locked ? colors.textMuted : colors.gold} />
            </View>
          </PopIn>
          {locked ? (
            <View style={[styles.pill, styles.lockPill]}>
              <Ionicons name="lock-closed" size={10} color={colors.gold} />
              <Text style={[styles.pillText, { color: colors.gold }]} numberOfLines={1}>
                {t('services.membersOnly')}
              </Text>
            </View>
          ) : service.cta ? (
            <View style={styles.pill}>
              <Text style={[styles.pillText, { color: colors.gold }]} numberOfLines={1}>
                {service.cta}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.title, locked && styles.lockedText]} numberOfLines={2}>
          {service.title}
        </Text>
        <Text style={[styles.summary, locked && styles.lockedText]} numberOfLines={3}>
          {service.summary}
        </Text>
        <GoldHairline style={styles.hairline} />
        {/* Always rendered: the reserved lines keep every tile in the grid the same height. */}
        <SarText style={[styles.meta, locked && styles.lockedText]} numberOfLines={1}>
          {service.memberLabel ?? service.priceLabel ?? ''}
        </SarText>
        {/* M109b: the membership saving, loud on every priced tile (reserved so rows stay even). */}
        <SarText style={[styles.savings, locked && styles.lockedText]} numberOfLines={1}>
          {service.savingsSar ? t('service.save', { amount: formatNumber(service.savingsSar) }) : ''}
        </SarText>
      </GlassCard>
    </PressScale>
  );
}

/** The grid container: two tiles per row with an even gutter. */
export const serviceGridStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm } as const;

/**
 * The grid CHILD (the FadeInView around a tile): basis + grow halve the row whatever the width.
 * The cap keeps a lone last tile at half width instead of stretching across the whole row.
 */
export const serviceTileWrapStyle = { flexBasis: '47%' as const, flexGrow: 1, maxWidth: '50%' as const };

const styles = themedStyles(() => ({
  wrap: { flex: 1 },
  card: {
    flex: 1,
    padding: spacing.sm + 4,
    gap: spacing.xs,
  },
  lockedCard: { borderStyle: 'dashed', opacity: 0.85 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.xs },
  // The lit ring: gold hairline, golden wash, a whisper of glow.
  badge: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  badgeLocked: { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
    maxWidth: 110,
  },
  lockPill: { borderColor: colors.borderGold, backgroundColor: colors.goldSoft },
  pillText: { fontFamily: fonts.semiBold, fontSize: 10, lineHeight: 15 },
  // Reserved heights: a short title or summary keeps the tile as tall as its neighbors.
  title: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 21, minHeight: 42, color: colors.textPrimary, textAlign: textStart },
  summary: { ...typography.caption, fontSize: 11, lineHeight: 17, minHeight: 51, color: colors.textSecondary, textAlign: textStart },
  hairline: { marginVertical: spacing.xs },
  meta: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 17, minHeight: 17, color: colors.gold, textAlign: textStart },
  savings: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 16, minHeight: 16, color: colors.goldNeon, textAlign: textStart },
  lockedText: { opacity: 0.75 },
}));

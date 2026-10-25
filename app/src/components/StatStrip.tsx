import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, useCountUp } from '@/components/motion';
import { formatNumber } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

export type Stat = { icon: IoniconName; value: number; label: string };

/**
 * Icons pass (owner's priority 1): a band of live club numbers — golden icon, a figure that
 * counts up into place, a quiet label. Values come from the API; a zero hides its tile, so the
 * strip never shows an empty boast while something is still loading.
 */
export function StatStrip({ stats, delay = 0 }: { stats: Stat[]; delay?: number }) {
  const shown = stats.filter((stat) => stat.value > 0);
  if (!shown.length) return null;
  return (
    <View style={styles.row}>
      {shown.map((stat, index) => (
        <FadeInView key={stat.label} delay={delay + entranceDelay(index, 90)} style={styles.item}>
          <GlassCard golden radius={radii.lg} style={styles.card}>
            <View style={styles.icon}>
              <Ionicons name={stat.icon} size={18} color={colors.gold} />
            </View>
            <StatValue value={stat.value} />
            <Text style={styles.label} numberOfLines={2}>
              {stat.label}
            </Text>
          </GlassCard>
        </FadeInView>
      ))}
    </View>
  );
}

function StatValue({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <Text style={styles.value}>{formatNumber(shown)}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  item: { flex: 1 },
  card: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.xs },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  value: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 28, color: colors.gold },
  // Reserved two-line height: a one-line label keeps its tile as tall as the rest of the row.
  label: { ...typography.caption, fontSize: 10, lineHeight: 15, minHeight: 30, color: colors.textSecondary, textAlign: 'center' },
});

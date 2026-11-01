import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useMonthlyDeal } from '@/api/payments';
import { GlassCard, NeonPulse } from '@/components/lux';
import { PopIn } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const LRM = '‎';

export function dealAmount(amount: number, percent: number): number {
  return Math.max(0, Math.round((amount * (100 - percent)) / 100));
}

/**
 * M176 (owner, 2026-11-01): where a discount code would go, the month's code (NOVDEAL…) already
 * sits there, applied — a golden badge with the price after it, so the member feels the saving
 * without typing anything. The server applies the same code when he pays.
 */
export function MonthlyDealBadge({ amount, currency }: { amount?: number; currency?: string }) {
  const deal = useMonthlyDeal();
  if (!deal) return null;
  const after = amount ? dealAmount(amount, deal.percent) : null;
  return (
    <PopIn>
      <GlassCard golden style={styles.card}>
        <NeonPulse intensity="soft" />
        <View style={styles.head}>
          <View style={styles.check}>
            <Ionicons name="checkmark" size={16} color={colors.goldInk} />
          </View>
          <Text style={styles.title}>{t('deal.active')}</Text>
          <View style={styles.codePill}>
            <Text style={styles.code} numberOfLines={1}>{deal.code}</Text>
          </View>
        </View>
        <Text style={styles.line}>{t('deal.percent', { percent: formatNumber(deal.percent) })}</Text>
        {amount && after !== null ? (
          <View style={styles.prices}>
            <Text style={styles.after}>{`${LRM}${formatNumber(after)} ${currency ?? t('deal.sar')}`}</Text>
            <Text style={styles.before}>{`${LRM}${formatNumber(amount)} ${currency ?? t('deal.sar')}`}</Text>
          </View>
        ) : null}
        <Text style={styles.hint}>{t('deal.hint')}</Text>
      </GlassCard>
    </PopIn>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs, padding: spacing.md, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.subtitle, fontSize: 16, lineHeight: 24, color: colors.goldLight, flex: 1, textAlign: textStart },
  codePill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.gold, backgroundColor: colors.goldSoft },
  code: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.gold, letterSpacing: 1.5 },
  line: { ...typography.body, fontSize: 15, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  prices: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  after: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.gold },
  before: { ...typography.caption, color: colors.textSecondary, textDecorationLine: 'line-through' },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
});

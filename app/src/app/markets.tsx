import { StyleSheet, Text, View } from 'react-native';

import { useMarkets, type MarketGroup, type MarketQuote } from '@/api/markets';
import { GlassCard } from '@/components/lux';
import { ChangeText, priceText } from '@/components/MarketsStrip';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { getLang, t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber, formatRelativeTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const LRM = '‎';
const GROUPS: MarketGroup[] = ['stocks', 'metals', 'fx', 'oil', 'crypto'];

/**
 * M178 (owner, 2026-11-01, «مكان واحد تدخل عليه تلاقي كل ده … Rate فوري»): every quote the server
 * reads, grouped, live every 30 s. Each row carries its own quote time so a closed market or a
 * delayed feed (TASI, 15 min) is never mistaken for a live price.
 */
export default function MarketsScreen() {
  const { data, isLoading, error, refetch } = useMarkets();
  const quotes = data?.quotes ?? [];

  if (!quotes.length) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const groups = GROUPS.map((group) => ({ group, items: quotes.filter((quote) => quote.group === group) })).filter((entry) => entry.items.length);
  return (
    <Screen>
      <Text style={styles.live}>{t('markets.live', { time: data?.updatedAt ? formatRelativeTime(data.updatedAt) : '' })}</Text>
      {groups.map((entry, index) => (
        <FadeInView key={entry.group} delay={entranceDelay(index, 60)}>
          <Text style={styles.groupTitle}>{t(`markets.group.${entry.group}`)}</Text>
          <GlassCard style={styles.card}>
            {entry.items.map((quote, row) => (
              <QuoteRow key={quote.key} quote={quote} last={row === entry.items.length - 1} />
            ))}
          </GlassCard>
        </FadeInView>
      ))}
      <Text style={styles.note}>{t('markets.note', { source: data?.source ?? '' })}</Text>
    </Screen>
  );
}

function QuoteRow({ quote, last }: { quote: MarketQuote; last: boolean }) {
  const english = getLang() === 'en';
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={styles.start}>
        <Text style={styles.label} numberOfLines={1}>{english ? quote.labelEn : quote.label}</Text>
        <Text style={styles.meta} numberOfLines={1}>{english ? quote.unitEn : quote.unit}</Text>
        {quote.gramSar ? <Text style={styles.gram} numberOfLines={1}>{t('markets.gram', { price: formatNumber(quote.gramSar) })}</Text> : null}
        <Text style={styles.meta} numberOfLines={1}>
          {quote.delayedMin ? `${formatRelativeTime(quote.at)} · ${t('markets.delayed', { min: quote.delayedMin })}` : formatRelativeTime(quote.at)}
        </Text>
      </View>
      <View style={styles.end}>
        <Text style={styles.price} numberOfLines={1}>{`${LRM}${priceText(quote.price)}`}</Text>
        <ChangeText quote={quote} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  live: { ...typography.caption, color: colors.textMuted, textAlign: textStart, marginBottom: spacing.sm },
  groupTitle: { ...typography.subtitle, fontSize: 16, color: colors.goldLight, textAlign: textStart, marginTop: spacing.md, marginBottom: spacing.xs },
  card: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radii.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderGoldSoft },
  start: { flex: 1, gap: 1 },
  end: { alignItems: 'flex-end', gap: 2 },
  label: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 23, color: colors.textPrimary, textAlign: textStart },
  meta: { fontSize: 11, lineHeight: 16, fontFamily: fonts.regular, color: colors.textMuted, textAlign: textStart },
  gram: { fontSize: 12, lineHeight: 18, fontFamily: fonts.medium, color: colors.gold, textAlign: textStart },
  price: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 26, color: colors.textPrimary },
  note: { ...typography.caption, color: colors.textMuted, textAlign: textStart, marginTop: spacing.lg },
});

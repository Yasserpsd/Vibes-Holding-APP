import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMarkets, type MarketGroup, type MarketQuote } from '@/api/markets';
import { useAdvisorScreen, useAskAdvisor } from '@/components/advisor/AskAdvisor';
import { GlassCard } from '@/components/lux';
import { ChangeText, isRiyalUnit, priceText, QuoteIcon } from '@/components/MarketsStrip';
import { SarText } from '@/components/SarText';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { getLang, t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber, formatRelativeTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const LRM = '‎';

/**
 * M178 (owner, 2026-11-01, «مكان واحد تدخل عليه تلاقي كل ده … Rate فوري»): every quote the server
 * reads, grouped, live every 30 s. Each row carries its own quote time so a closed market or a
 * delayed feed (TASI, 15 min) is never mistaken for a live price.
 */
export default function MarketsScreen() {
  const { data, isLoading, error, refetch } = useMarkets();
  const quotes = data?.quotes ?? [];
  const ask = useAskAdvisor();
  // M179: the floating advisor button opens the chat on this screen; the server builds the context from the live quotes.
  useAdvisorScreen(quotes.length ? { type: 'screen', id: 'markets', title: t('nav.markets') } : null);

  if (!quotes.length) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  // Sections follow the server's order (each group where its first quote sits), so a reorder needs no OTA.
  const order = [...new Set<MarketGroup>(quotes.map((quote) => quote.group))];
  const groups = order.map((group) => ({ group, items: quotes.filter((quote) => quote.group === group) }));
  return (
    <Screen>
      <Pressable style={styles.ask} onPress={() => ask({ type: 'screen', id: 'markets', title: t('nav.markets') })} accessibilityRole="button" accessibilityLabel={t('markets.askAdvisor')}>
        <Ionicons name="sparkles" size={16} color={colors.gold} />
        <Text style={styles.askText}>{t('markets.askAdvisor')}</Text>
      </Pressable>
      <Text style={styles.live}>{t('markets.live', { time: data?.updatedAt ? formatRelativeTime(data.updatedAt) : '' })}</Text>
      {groups.map((entry, index) => (
        <FadeInView key={entry.group} delay={entranceDelay(index, 60)}>
          <Text style={styles.groupTitle}>{t(`markets.group.${entry.group}`)}</Text>
          <GlassCard style={styles.card}>
            {entry.items.map((quote, row) => (
              <QuoteRow key={quote.key} quote={quote} last={row === entry.items.length - 1} onAsk={(label) => ask({ type: 'screen', id: 'markets', title: t('nav.markets') }, t('markets.askPrompt', { label }))} />
            ))}
          </GlassCard>
        </FadeInView>
      ))}
      <Text style={styles.note}>{t('markets.note', { source: data?.source ?? '' })}</Text>
    </Screen>
  );
}

function QuoteRow({ quote, last, onAsk }: { quote: MarketQuote; last: boolean; onAsk: (label: string) => void }) {
  const english = getLang() === 'en';
  const label = english ? quote.labelEn : quote.label;
  const unit = english ? quote.unitEn : quote.unit;
  // Owner (2026-11-02, «الرقم الأول وبعدين العلامة»): a riyal price carries the symbol after the number, no unit word.
  const riyal = isRiyalUnit(unit);
  return (
    <View style={[styles.row, !last && styles.divider]}>
      {/* Owner (2026-11-02): each quote wears its icon, and the «متأخر 15 دقيقة» line left the screens. */}
      <QuoteIcon quote={quote} size={20} />
      <View style={styles.start}>
        <Text style={styles.label} numberOfLines={1}>{english ? quote.labelEn : quote.label}</Text>
        {riyal ? null : <SarText style={styles.meta} numberOfLines={1}>{unit}</SarText>}
        {quote.gramSar ? <SarText style={styles.gram} numberOfLines={1}>{t('markets.gram', { price: formatNumber(quote.gramSar) })}</SarText> : null}
        <Text style={styles.meta} numberOfLines={1}>{formatRelativeTime(quote.at)}</Text>
      </View>
      <Pressable style={styles.rowAsk} hitSlop={8} onPress={() => onAsk(label)} accessibilityRole="button" accessibilityLabel={t('markets.askAbout', { label })}>
        <Ionicons name="sparkles-outline" size={16} color={colors.gold} />
      </Pressable>
      <View style={styles.end}>
        <SarText style={styles.price} numberOfLines={1}>{riyal ? `${LRM}${priceText(quote.price)} ريال` : `${LRM}${priceText(quote.price)}`}</SarText>
        <ChangeText quote={quote} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ask: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderGold, marginBottom: spacing.sm },
  askText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.gold },
  rowAsk: { padding: spacing.xs },
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

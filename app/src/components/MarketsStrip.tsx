import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMarkets, type MarketQuote } from '@/api/markets';
import { PressScale } from '@/components/motion';
import { getLang, t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const LRM = '‎';
const HOME_COUNT = 3;

/** Big prices as whole numbers with separators; small ones (currencies, silver) keep two decimals, tiny coins four. */
export function priceText(price: number): string {
  if (price >= 1000) return formatNumber(price);
  return price < 1 ? price.toFixed(4) : price.toFixed(2);
}

export function ChangeText({ quote }: { quote: MarketQuote }) {
  const up = quote.changePct >= 0;
  const color = up ? colors.success : colors.danger;
  return (
    <View style={styles.change}>
      <Ionicons name={up ? 'caret-up' : 'caret-down'} size={11} color={color} />
      <Text style={[styles.pct, { color }]} numberOfLines={1}>{`${LRM}${Math.abs(quote.changePct)}%`}</Text>
    </View>
  );
}

/**
 * M176 strip, M178 (owner, 2026-11-01, «السوق السعودي في البداية … وبعدين مشاهدة الكل»): the home shows
 * only the server's featured quotes (TASI, gold, dollar) and a «مشاهدة الكل» tile opening /markets.
 * Real quotes from the server's shared cache; hidden when none are available.
 */
export function MarketsStrip() {
  const router = useRouter();
  const { data } = useMarkets();
  const quotes = data?.quotes ?? [];
  if (!quotes.length) return null;
  const featured = quotes.filter((quote) => quote.featured);
  const shown = featured.length ? featured : quotes.slice(0, HOME_COUNT);
  const english = getLang() === 'en';
  const open = () => router.push('/markets' as Href);
  return (
    <View style={styles.markets}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {shown.map((quote) => (
          <PressScale key={quote.key} onPress={open} accessibilityRole="button" accessibilityLabel={english ? quote.labelEn : quote.label}>
            <View style={styles.quote}>
              <Text style={styles.label} numberOfLines={1}>{english ? quote.labelEn : quote.label}</Text>
              <Text style={styles.price} numberOfLines={1}>{`${LRM}${priceText(quote.price)}`}</Text>
              <ChangeText quote={quote} />
              <Text style={styles.unit} numberOfLines={1}>{english ? quote.unitEn : quote.unit}</Text>
              {quote.gramSar ? <Text style={styles.extra} numberOfLines={1}>{t('markets.gram', { price: formatNumber(quote.gramSar) })}</Text> : null}
              {quote.delayedMin ? <Text style={styles.unit} numberOfLines={1}>{t('markets.delayed', { min: quote.delayedMin })}</Text> : null}
            </View>
          </PressScale>
        ))}
        <PressScale onPress={open} accessibilityRole="button" accessibilityLabel={t('markets.viewAll')}>
          <View style={[styles.quote, styles.all]}>
            <Ionicons name="stats-chart" size={20} color={colors.gold} />
            <Text style={styles.label} numberOfLines={1}>{t('markets.viewAll')}</Text>
            <Text style={styles.unit} numberOfLines={1}>{t('markets.viewAllSub')}</Text>
          </View>
        </PressScale>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  markets: { gap: 4, marginBottom: spacing.sm },
  row: { gap: spacing.sm },
  quote: { minWidth: 104, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm + 2, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderGoldSoft, backgroundColor: colors.surface, gap: 1 },
  all: { alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.goldSoft },
  label: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.goldLight, textAlign: textStart },
  price: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  change: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pct: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  unit: { fontSize: 10, lineHeight: 15, fontFamily: fonts.regular, color: colors.textMuted, textAlign: textStart },
  extra: { fontSize: 11, lineHeight: 16, fontFamily: fonts.medium, color: colors.gold, textAlign: textStart },
});

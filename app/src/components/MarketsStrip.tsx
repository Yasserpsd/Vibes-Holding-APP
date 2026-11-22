import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMarkets, type MarketQuote } from '@/api/markets';
import { PressScale } from '@/components/motion';
import { SarText } from '@/components/SarText';
import { getLang, t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const LRM = '‎';
const HOME_COUNT = 3;
// One width for every tile (owner, 2026-11-01: «كلهم نفس المقاس»); the row stretches them to the tallest.
const QUOTE_WIDTH = 138;

// Owner (2026-11-02, then 2026-11-08 «عايز العلم الأصلي يظهر حقيقي»): every quote wears its real face —
// the coin's own logo (spothq/cryptocurrency-icons, CC0), the country's real flag (flagcdn, public
// domain), drawn bars for gold and silver, an oil drum for brent/WTI. Bundled PNGs through the plain
// RN Image: no native module, so the set ships by OTA; eas update uploads the assets with the bundle.
const COIN_LOGO: Record<string, number> = {
  btc: require('../../assets/images/markets/btc.png'),
  eth: require('../../assets/images/markets/eth.png'),
  usdt: require('../../assets/images/markets/usdt.png'),
  bnb: require('../../assets/images/markets/bnb.png'),
  xrp: require('../../assets/images/markets/xrp.png'),
  sol: require('../../assets/images/markets/sol.png'),
  ada: require('../../assets/images/markets/ada.png'),
};
const FLAG: Record<string, number> = {
  tasi: require('../../assets/images/markets/tasi.png'),
  usd: require('../../assets/images/markets/usd.png'),
  aed: require('../../assets/images/markets/aed.png'),
  eur: require('../../assets/images/markets/eur.png'),
  gbp: require('../../assets/images/markets/gbp.png'),
};
const COMMODITY: Record<string, number> = {
  gold: require('../../assets/images/markets/gold.png'),
  silver: require('../../assets/images/markets/silver.png'),
  brent: require('../../assets/images/markets/oil.png'),
  wti: require('../../assets/images/markets/oil.png'),
};

export function QuoteIcon({ quote, size = 15 }: { quote: MarketQuote; size?: number }) {
  const coin = COIN_LOGO[quote.key];
  if (coin) return <Image source={coin} style={{ width: size + 2, height: size + 2, borderRadius: (size + 2) / 2 }} />;
  const flag = FLAG[quote.key];
  // Flags keep their rectangle (a real flag, not a badge): 3:2 inside a soft-cornered frame, hairline edge for the pale ones.
  if (flag) {
    return (
      <Image
        source={flag}
        resizeMode="cover"
        style={{ width: Math.round(size * 1.5), height: size, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}
      />
    );
  }
  const commodity = COMMODITY[quote.key];
  if (commodity) return <Image source={commodity} style={{ width: size + 4, height: size + 4 }} />;
  const emoji = quote.group === 'crypto' ? '🪙' : '📈';
  return <Text style={{ fontSize: size - 1, lineHeight: size + 5 }}>{emoji}</Text>;
}

/** Big prices as whole numbers with separators; small ones (currencies, silver) keep two decimals, tiny coins four. */
export function priceText(price: number): string {
  if (price >= 1000) return formatNumber(price);
  return price < 1 ? price.toFixed(4) : price.toFixed(2);
}

/** Owner (2026-11-02, «خلي الرقم الأول وبعدين العلامة»): a riyal-priced quote carries the symbol right after the number. */
export function isRiyalUnit(unit: string): boolean {
  return unit === 'ريال' || unit === 'SAR';
}

export function ChangeText({ quote, align = 'start' }: { quote: MarketQuote; align?: 'start' | 'end' }) {
  const size = Math.abs(quote.changePct);
  // A zero change is neutral: no arrow, muted colour (gold showed «0%» with a green up arrow — emulator review item 41).
  const flat = size === 0;
  const up = quote.changePct > 0;
  const color = flat ? colors.textMuted : up ? colors.success : colors.danger;
  // M261 (owner: «نطور جدا من شكل المؤشرات»): the change wears a pill tinted with its own colour — the hex
  // token with a two-digit alpha (~13%), so both themes follow without a new token.
  return (
    <View style={[styles.change, { backgroundColor: flat ? colors.surfaceElevated : `${color}22`, alignSelf: align === 'end' ? 'flex-end' : 'flex-start' }]}>
      {flat ? null : <Ionicons name={up ? 'caret-up' : 'caret-down'} size={11} color={color} />}
      <Text style={[styles.pct, { color }]} numberOfLines={1}>{`${LRM}${size}%`}</Text>
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
          <PressScale key={quote.key} onPress={open} wrapStyle={styles.tile} style={[styles.quote, quote.key === 'gold' && styles.quoteGold]} accessibilityRole="button" accessibilityLabel={english ? quote.labelEn : quote.label}>
            <View style={styles.labelRow}>
              {/* Owner (2026-11-02): no flag on TASI in the strip — «السوق السعودي» keeps its full name. */}
              {quote.key === 'tasi' ? null : <QuoteIcon quote={quote} />}
              {/* One line that shrinks to fit: a larger system font cut «السوق السعودي» (emulator review item 30). */}
              <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{english ? quote.labelEn : quote.label}</Text>
            </View>
            <SarText style={styles.price} numberOfLines={1}>
              {isRiyalUnit(english ? quote.unitEn : quote.unit) ? `${LRM}${priceText(quote.price)} ريال` : `${LRM}${priceText(quote.price)}`}
            </SarText>
            <ChangeText quote={quote} />
            {isRiyalUnit(english ? quote.unitEn : quote.unit) ? null : <SarText style={styles.unit} numberOfLines={1}>{english ? quote.unitEn : quote.unit}</SarText>}
            {quote.gramSar ? <SarText style={styles.extra} numberOfLines={1}>{t('markets.gram', { price: formatNumber(quote.gramSar) })}</SarText> : null}
          </PressScale>
        ))}
        <PressScale onPress={open} wrapStyle={styles.tile} style={[styles.quote, styles.all]} accessibilityRole="button" accessibilityLabel={t('markets.viewAll')}>
          <Ionicons name="stats-chart" size={20} color={colors.gold} />
          <Text style={[styles.label, styles.allText]} numberOfLines={1}>{t('markets.viewAll')}</Text>
          <Text style={[styles.unit, styles.allText]} numberOfLines={1}>{t('markets.viewAllSub')}</Text>
        </PressScale>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => ({
  // The top margin keeps the tiles off the last line of the section's description (emulator review item 25).
  markets: { gap: 4, marginTop: spacing.sm, marginBottom: spacing.sm },
  // The vertical room keeps the gold tile's glow from being cut by the scroller's edge.
  row: { gap: spacing.sm, paddingVertical: 6 },
  tile: { width: QUOTE_WIDTH },
  quote: { flex: 1, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderGoldSoft, backgroundColor: colors.surface, gap: 3 },
  // M261: gold is the strip's lead tile — a lit gold border over the gold wash.
  quoteGold: { borderColor: colors.borderGold, experimental_backgroundImage: gradients.goldWash, boxShadow: shadows.glowGoldFaint },
  all: { alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.goldSoft },
  allText: { alignSelf: 'stretch', textAlign: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.goldLightText, textAlign: textStart, flexShrink: 1 },
  price: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 28, color: colors.textPrimary, textAlign: textStart },
  change: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 7, paddingVertical: 1, borderRadius: radii.pill },
  pct: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  unit: { fontSize: 10, lineHeight: 15, fontFamily: fonts.regular, color: colors.textMuted, textAlign: textStart },
  extra: { fontSize: 11, lineHeight: 16, fontFamily: fonts.medium, color: colors.goldText, textAlign: textStart },
}));

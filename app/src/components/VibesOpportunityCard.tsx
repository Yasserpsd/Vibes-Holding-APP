import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { goldenCodeForUrl } from '@/api/queries';
import type { GoldenContent, GoldenOpportunityEntry } from '@/api/types';
import { GoldGradient } from '@/components/lux';
import { PressScale, Sheen } from '@/components/motion';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatMillionsSar } from '@/lib/format';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M121 «فرصة Vibes Ventures»: the owner's own opportunity LEADS the golden slot in a top-tier premium
 * dress no other card wears — a solid machined-gold frame, a metal sheen sweeping the surface, and the
 * owner's dashboard photo (golden emblem wash while the slot is empty). All copy is server-driven.
 * M115 lesson respected: nothing opaque ever sits above the photo layers (no GoldSweep here).
 */
export function VibesOpportunityCard({ entry, content }: { entry: GoldenOpportunityEntry; content: GoldenContent }) {
  const router = useRouter();
  // The owner can swap the photo from the dashboard: a new url resets the latched failure (M109h pattern).
  const [imageBroken, setImageBroken] = useState(false);
  const [brokenFor, setBrokenFor] = useState(entry.imageUrl);
  if (brokenFor !== entry.imageUrl) {
    setBrokenFor(entry.imageUrl);
    setImageBroken(false);
  }
  const [size, setSize] = useState({ width: 0, height: 0 });
  const showImage = Boolean(entry.imageUrl) && !imageBroken;

  const open = () => {
    // A portfolio offer URL opens the native golden page (§5.1); anything else stays in-app in the WebView screen.
    const code = goldenCodeForUrl(content, entry.ctaUrl);
    if (code) router.push(`/golden/${code}`);
    else router.push({ pathname: '/webpage', params: { url: entry.ctaUrl, title: entry.title } });
  };

  return (
    <PressScale onPress={open} glow glowRadius={radii.xl + 3} accessibilityRole="button" accessibilityLabel={`${entry.badge} — ${entry.title}`}>
      {/* The frame is real metal, not a hairline: a gradient-gold band no other card has. */}
      <GoldGradient style={styles.frame}>
        <View
          style={styles.card}
          onLayout={({ nativeEvent: { layout } }) => {
            const width = Math.round(layout.width);
            const height = Math.round(layout.height);
            setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
          }}
        >
          {/* The emblem layer ALWAYS renders underneath (M106b): a stalled photo is never a black card. */}
          <View style={styles.fallback} pointerEvents="none">
            <Image source={require('../../assets/images/club-emblem.png')} style={styles.fallbackEmblem} resizeMode="contain" />
          </View>
          {showImage ? (
            <Image
              source={{ uri: entry.imageUrl ?? undefined }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              resizeMethod="resize"
              accessibilityLabel={entry.title}
              onError={() => setImageBroken(true)}
            />
          ) : null}
          {/* The dark scrim belongs on a photo only (M107b). */}
          {showImage ? <View style={styles.scrim} pointerEvents="none" /> : null}
          <View style={styles.inner}>
            <View style={styles.badgeRow}>
              <GoldGradient style={styles.badge}>
                <Ionicons name="diamond" size={12} color={colors.black} />
                <Text style={styles.badgeText} numberOfLines={1}>
                  {entry.badge}
                </Text>
              </GoldGradient>
            </View>
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2}>
                {entry.title}
              </Text>
              <Text style={styles.tagline} numberOfLines={2}>
                {entry.tagline}
              </Text>
              {entry.valuationSarMillions !== null ? (
                <View style={styles.valueRow}>
                  <View style={styles.valuePill}>
                    <Text style={styles.valueLabel}>{t('golden.valuation')}</Text>
                    <Text style={styles.valueText}>{formatMillionsSar(entry.valuationSarMillions)}</Text>
                  </View>
                </View>
              ) : null}
              <View style={styles.ctaRow}>
                <Text style={styles.cta}>{entry.ctaLabel}</Text>
                <Ionicons name={chevronForward()} size={14} color={colors.goldLight} />
              </View>
              {/* Valuations never travel without the brief's disclaimer. */}
              {entry.valuationSarMillions !== null ? (
                <Text style={styles.disclaimer} numberOfLines={2}>
                  {content.disclaimer}
                </Text>
              ) : null}
            </View>
          </View>
          {size.width > 0 ? <Sheen width={size.width} height={size.height} /> : null}
        </View>
      </GoldGradient>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: spacing.sm,
    padding: 2,
    borderRadius: radii.xl + 3,
    boxShadow: shadows.glowGold,
  },
  card: {
    minHeight: 250,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: gradients.goldWash,
  },
  fallbackEmblem: { width: 120, height: 120, opacity: 0.45 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  inner: { flex: 1, justifyContent: 'space-between', padding: spacing.md, gap: spacing.md },
  badgeRow: { flexDirection: 'row' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    boxShadow: shadows.glowGoldFaint,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 18, color: colors.black },
  body: { gap: spacing.xs },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 32, color: colors.textPrimary, textAlign: textStart },
  tagline: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  valueRow: { flexDirection: 'row' },
  valuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  valueLabel: { ...typography.caption, color: colors.textMuted },
  valueText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.goldLight },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cta: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22, color: colors.goldLight },
  disclaimer: { ...typography.caption, fontSize: 10, lineHeight: 15, color: colors.textMuted, textAlign: textStart },
});

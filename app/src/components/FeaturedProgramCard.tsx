import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import type { Service } from '@/api/content';
import { GoldGradient } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { chevronForward, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing } from '@/theme/tokens';

/** How many of the programme's strengths the card lists; the rest wait on the service page. */
const POINTS_SHOWN = 3;

/**
 * Owner (2026-11-22: «في خدمات النادي اول حاجه تظهر بشكل مميز جدا شركاء النجاح ده اهم برنامج عندي… للمحايدين و
 * رواد الأعمال فقط»): the club's flagship programme leads the services as one gold card — its name, the line that
 * says what it is, three of its strengths, the two stores by their marks, and its own call to action. The words
 * are the service's content (title, `program`, `cta`); a server without the programme block still gets the card,
 * on the service's summary alone. Who sees it is the caller's rule (the investor's services stay as they are).
 */
export function FeaturedProgramCard({ service, onPress }: { service: Service; onPress: () => void }) {
  const program = service.program;
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={service.title}>
      <GoldGradient style={styles.card}>
        <View style={styles.head}>
          <View style={styles.badge}>
            <Ionicons name="ribbon" size={26} color={colors.gold} />
          </View>
          <View style={styles.headTexts}>
            <Text style={styles.title}>{service.title}</Text>
            <Text style={styles.tagline}>{program?.tagline ?? service.summary}</Text>
          </View>
        </View>

        {program ? (
          <View style={styles.points}>
            {program.points.slice(0, POINTS_SHOWN).map((point) => (
              <View key={point} style={styles.point}>
                <Ionicons name="checkmark-circle" size={16} color={colors.goldInk} style={styles.pointTick} />
                <Text style={styles.pointText}>{point}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.foot}>
          {program ? (
            <View style={styles.stores}>
              <View style={styles.store}>
                <Ionicons name="logo-google-playstore" size={16} color={colors.gold} />
              </View>
              <View style={styles.store}>
                <Ionicons name="logo-apple" size={16} color={colors.gold} />
              </View>
            </View>
          ) : null}
          <View style={styles.cta}>
            <Text style={styles.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {service.cta ?? service.title}
            </Text>
            <Ionicons name={chevronForward()} size={16} color={colors.gold} />
          </View>
        </View>
      </GoldGradient>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  card: { padding: spacing.md, gap: spacing.md, borderRadius: radii.xl, boxShadow: shadows.glowGold },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 54, height: 54, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldInk },
  headTexts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 21, lineHeight: 32, color: colors.goldInk, textAlign: textStart },
  tagline: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 21, color: colors.goldInk, textAlign: textStart },
  points: { gap: spacing.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  pointTick: { marginTop: 3 },
  pointText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, color: colors.goldInk, textAlign: textStart },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  stores: { flexDirection: 'row', gap: spacing.xs },
  store: { width: 34, height: 34, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldInk },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.goldInk,
    maxWidth: '70%',
  },
  ctaText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.gold },
}));

import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import type { Service } from '@/api/content';
import { GoldGradient, GoldHairline } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { chevronForward, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing } from '@/theme/tokens';

/** How many of the programme's strengths the card lists; the rest wait on the service page. */
const POINTS_SHOWN = 3;

/**
 * Owner (2026-11-22: «في خدمات النادي اول حاجه تظهر بشكل مميز جدا شركاء النجاح ده اهم برنامج عندي… للمحايدين و
 * رواد الأعمال فقط»): the club's flagship programme leads the services as one card — its name, the line that
 * says what it is, three of its strengths and its own call to action. The words are the service's content
 * (title, `program`, `cta`); a server without the programme block still gets the card, on the summary alone.
 * Who sees it is the caller's rule (the investor's services stay as they are).
 *
 * Second pass the same evening, on TestFlight («خلي واضح ان خدمة التطبيق و الويب سايت كاملة متوفرة من البداية
 * وتكون الخلفية بيضاء مميزة جدا والكلام مكتوب بطريقة شيك»): the card is a WHITE sheet with a gold edge — the one
 * white surface on the dark home, so it cannot be missed — with ink text, and a gold band right under the name
 * that says the website and the full app are his from the start, beside the web and the two store marks.
 */
export function FeaturedProgramCard({ service, onPress }: { service: Service; onPress: () => void }) {
  const program = service.program;
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={service.title}>
      <View style={styles.card}>
        <View style={styles.head}>
          <GoldGradient style={styles.badge}>
            <Ionicons name="ribbon" size={26} color={colors.goldInk} />
          </GoldGradient>
          <View style={styles.headTexts}>
            <Text style={styles.title}>{service.title}</Text>
            <Text style={styles.tagline}>{program?.tagline ?? service.summary}</Text>
          </View>
        </View>

        {program?.highlight ? (
          <GoldGradient style={styles.highlight}>
            <View style={styles.marks}>
              <Mark icon="globe-outline" />
              <Mark icon="logo-google-playstore" />
              <Mark icon="logo-apple" />
            </View>
            <Text style={styles.highlightText}>{program.highlight}</Text>
          </GoldGradient>
        ) : null}

        {program ? (
          <View style={styles.points}>
            {program.points.slice(0, POINTS_SHOWN).map((point) => (
              <View key={point} style={styles.point}>
                <Ionicons name="checkmark-circle" size={17} color={colors.paperGold} style={styles.pointTick} />
                <Text style={styles.pointText}>{point}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <GoldHairline />

        <View style={styles.foot}>
          {/* Without the highlight band (an older server) the two stores keep their place beside the button. */}
          {program && !program.highlight ? (
            <View style={styles.marks}>
              <Mark icon="logo-google-playstore" />
              <Mark icon="logo-apple" />
            </View>
          ) : null}
          <GoldGradient style={styles.cta}>
            <Text style={styles.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {service.cta ?? service.title}
            </Text>
            <Ionicons name={chevronForward()} size={18} color={colors.goldInk} />
          </GoldGradient>
        </View>
      </View>
    </PressScale>
  );
}

function Mark({ icon }: { icon: 'globe-outline' | 'logo-google-playstore' | 'logo-apple' }) {
  return (
    <View style={styles.mark}>
      <Ionicons name={icon} size={16} color={colors.gold} />
    </View>
  );
}

const styles = themedStyles(() => ({
  // The paper tokens are the same white and ink in the dark and the light theme, so the card reads alike in both.
  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.gold,
    backgroundColor: colors.paperCard,
    boxShadow: shadows.glowGold,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 56, height: 56, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  headTexts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 23, lineHeight: 35, color: colors.paperInk, textAlign: textStart },
  tagline: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 21, color: colors.paperGold, textAlign: textStart },
  highlight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radii.lg },
  highlightText: { flex: 1, fontFamily: fonts.bold, fontSize: 14, lineHeight: 23, color: colors.goldInk, textAlign: textStart },
  marks: { flexDirection: 'row', gap: 4 },
  mark: { width: 30, height: 30, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldInk },
  points: { gap: spacing.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  pointTick: { marginTop: 3 },
  pointText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 23, color: colors.paperInk, textAlign: textStart },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  ctaText: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 25, color: colors.goldInk },
}));

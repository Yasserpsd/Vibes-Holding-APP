import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import type { Service } from '@/api/content';
import { usePhotoSet } from '@/api/images';
import { FadingPhotos } from '@/components/FadingPhotos';
import { GoldGradient } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { chevronForward, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing } from '@/theme/tokens';

/**
 * Owner (2026-11-22: «في خدمات النادي اول حاجه تظهر بشكل مميز جدا شركاء النجاح ده اهم برنامج عندي… للمحايدين و
 * رواد الأعمال فقط»): the club's flagship programme leads the services as one card. The words are the
 * service's content (title, `program`, `cta`). Who sees it is the caller's rule (the investor's services
 * stay as they are).
 *
 * M270 (owner, 2026-11-25, on the white sheet with its tick list: «شكله مش عاجبني خالص نهائي… عايزك تزود اوي
 * الصور… لازم نعيد التفكير في الشكل»): the card is now a PHOTOGRAPH. The programme's own pictures (the
 * dashboard set `home.card.<service>`) fill the top and change on their own; the name and its line are
 * written on the picture, and under it sit only the one promise the owner insisted on («موقع إلكتروني وتطبيق
 * كامل… من بداية تسجيلك», with the web and the two store marks) and the call to action. The tick list left
 * for the service page, where the whole programme is told. Until the set is filled (or on an older server)
 * the same card stands without the picture, the name under a gold ribbon.
 */
export function FeaturedProgramCard({ service, onPress }: { service: Service; onPress: () => void }) {
  const program = service.program;
  const photos = usePhotoSet(`home.card.${service.key}`);
  const tagline = program?.tagline ?? service.summary;
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={service.title}>
      <View style={styles.card}>
        {/* Two different views, each with its own key: the set can arrive after the first draw, and turning the
            plain head INTO the photo box in place breaks Android's view mounting (addViewAt, seen on the emulator). */}
        {photos.length ? (
          <View key="photo" style={styles.photo}>
            <FadingPhotos urls={photos} points={360} />
            <View style={styles.scrim} />
            <View style={styles.onPhoto}>
              <Text style={styles.photoTitle}>{service.title}</Text>
              <Text style={styles.photoTagline}>{tagline}</Text>
            </View>
          </View>
        ) : (
          <View key="head" style={styles.head}>
            <GoldGradient style={styles.badge}>
              <Ionicons name="ribbon" size={24} color={colors.goldInk} />
            </GoldGradient>
            <View style={styles.headTexts}>
              <Text style={styles.title}>{service.title}</Text>
              <Text style={styles.tagline}>{tagline}</Text>
            </View>
          </View>
        )}

        <View style={styles.body}>
          {program?.highlight ? (
            <View style={styles.promise}>
              <View style={styles.marks}>
                <Mark icon="globe-outline" />
                <Mark icon="logo-google-playstore" />
                <Mark icon="logo-apple" />
              </View>
              <Text style={styles.promiseText}>{program.highlight}</Text>
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
      <Ionicons name={icon} size={15} color={colors.gold} />
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.gold,
    backgroundColor: colors.surfaceElevated,
    boxShadow: shadows.glowGold,
    overflow: 'hidden',
  },
  // The picture is dark in both themes, so the words on it use the on-photo tokens.
  photo: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#0B0B0E', justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  onPhoto: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm + 2, gap: 2 },
  photoTitle: { fontFamily: fonts.bold, fontSize: 25, lineHeight: 38, color: colors.onPhoto, textAlign: textStart },
  photoTagline: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 21, color: colors.onPhotoGold, textAlign: textStart },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingBottom: 0 },
  badge: { width: 52, height: 52, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  headTexts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 34, color: colors.textPrimary, textAlign: textStart },
  tagline: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 21, color: colors.goldText, textAlign: textStart },
  body: { padding: spacing.md, gap: spacing.md },
  promise: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  promiseText: { flex: 1, fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 21, color: colors.textPrimary, textAlign: textStart },
  marks: { flexDirection: 'row', gap: 4 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  cta: {
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

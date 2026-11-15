import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { meetupsFor, useMeetupsContent, type Meetup, type PortalKey } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { youtubeIdOf } from '@/lib/player';
import { textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 200;
/** A floor, not a fixed height: a larger system font grows the card, and the strip's cards all take the tallest one's height. */
const CARD_MIN_HEIGHT = 196;

/** M119: the five club meetups as a home strip — the persona's order decides who leads. */
export function MeetupsBlock({ block, ctaLabel }: { block: { title: string; subtitle: string; cta: string }; ctaLabel?: string }) {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data } = useMeetupsContent();
  const personaKey: PortalKey | 'guest' = status === 'signedIn' && me ? me.persona || 'neutral' : 'guest';
  const { meetups } = meetupsFor(data, personaKey);
  if (meetups.length === 0) return null;

  return (
    <FadeInView delay={160}>
      <SectionHeader
        icon="people-outline"
        title={block.title}
        subtitle={block.subtitle}
        cta={ctaLabel ?? block.cta}
        onPress={() => router.push('/meetups' as Href)}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        snapToInterval={CARD_WIDTH + spacing.sm}
        decelerationRate="fast"
      >
        {meetups.map((meetup, index) => (
          <FadeInView key={meetup.key} delay={entranceDelay(index, 70)}>
            <MiniMeetup meetup={meetup} onPress={() => router.push(`/meetup/${meetup.key}` as Href)} />
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

/**
 * The film's thumbnail fills the card and the texts sit on its dark scrim. With NO thumbnail the card is a themed
 * surface with the gold wash: the mark is a faint icon in the top row (in the flow, never under the title), there is
 * no dark scrim, and the texts take themed colours (the on-photo colours are for a photo's dark ground only).
 */
function MiniMeetup({ meetup, onPress }: { meetup: Meetup; onPress: () => void }) {
  const youtubeId = youtubeIdOf(meetup.videoUrl);
  const plain = !youtubeId;
  return (
    // flexGrow down the chain: the strip stretches every card to the tallest one's height.
    <PressScale onPress={onPress} glow glowRadius={radii.lg} wrapStyle={styles.grow} style={styles.grow} accessibilityRole="button" accessibilityLabel={meetup.title}>
      <View style={styles.card}>
        {youtubeId ? (
          <>
            <Image source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <View style={styles.scrim} pointerEvents="none" />
          </>
        ) : (
          <View style={styles.fallback} pointerEvents="none" />
        )}
        <View style={[styles.topRow, plain && styles.topRowPlain]}>
          {plain ? <Ionicons name="people-outline" size={26} color={colors.goldText} style={styles.mark} /> : null}
          <View style={[styles.pill, plain && styles.pillPlain]}>
            <Text style={[styles.pillText, plain && styles.goldPlain]} numberOfLines={1}>
              {meetup.badge}
            </Text>
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={[styles.title, plain && styles.titlePlain]} numberOfLines={2}>
            {meetup.title}
          </Text>
          <Text style={[styles.meta, plain && styles.goldPlain]} numberOfLines={2}>
            {meetup.cta}
          </Text>
        </View>
      </View>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  // The strip keeps its own distance from the section's description line above it.
  strip: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  grow: { flexGrow: 1 },
  card: {
    flexGrow: 1,
    width: CARD_WIDTH,
    minHeight: CARD_MIN_HEIGHT,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  // No thumbnail: the themed gold wash alone.
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.sm },
  topRowPlain: { justifyContent: 'space-between', alignItems: 'center' },
  mark: { opacity: 0.45 },
  // The themed colours of a card with no thumbnail (same roles as the on-photo ones).
  titlePlain: { color: colors.textPrimary },
  goldPlain: { color: colors.goldText },
  pillPlain: { backgroundColor: colors.goldSoft },
  bottom: { padding: spacing.sm + 2, gap: spacing.xs },
  title: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.onPhoto, textAlign: textStart },
  meta: { ...typography.caption, color: colors.onPhotoGold, textAlign: textStart },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  pillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.onPhotoGold },
}));

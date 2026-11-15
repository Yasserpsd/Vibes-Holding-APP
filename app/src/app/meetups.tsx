import { useRouter, type Href } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { meetupsFor, useMeetupsContent, type Meetup, type PortalKey } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { ClampText } from '@/components/ClampText';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { youtubeIdOf } from '@/lib/player';
import { textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, spacing, typography } from '@/theme/tokens';

/** M119: the five club meetups (vibesholding.com/mup) — ordered and introduced per persona. */
export default function MeetupsScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useMeetupsContent();
  const personaKey: PortalKey | 'guest' = status === 'signedIn' && me ? me.persona || 'neutral' : 'guest';
  useAdvisorScreen(data ? { type: 'service', id: 'meetups', title: data.title } : null);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { intro, meetups } = meetupsFor(data, personaKey);

  return (
    <Screen title={data.title} subtitle={data.subtitle}>
      {intro ? (
        <FadeInView>
          <ClampText style={styles.intro} text={intro} />
        </FadeInView>
      ) : null}
      {meetups.length === 0 ? <StateView empty /> : null}
      {meetups.map((meetup, index) => (
        <FadeInView key={meetup.key} delay={entranceDelay(index, 70)}>
          <MeetupCard meetup={meetup} onPress={() => router.push(`/meetup/${meetup.key}` as Href)} />
        </FadeInView>
      ))}
    </Screen>
  );
}

/**
 * The photo is the king (M96 pattern): the film's thumbnail fills the card, the pitch sits on a scrim.
 * With NO thumbnail the card is a themed surface with the gold wash: no placeholder icon under the text (the
 * number and the badge already head the card), no dark scrim, and themed text colours.
 */
function MeetupCard({ meetup, onPress }: { meetup: Meetup; onPress: () => void }) {
  const youtubeId = youtubeIdOf(meetup.videoUrl);
  const plain = !youtubeId;
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={meetup.title}>
      <View style={styles.card}>
        {youtubeId ? (
          <>
            <Image source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <View style={styles.scrim} pointerEvents="none" />
          </>
        ) : (
          <View style={styles.fallback} pointerEvents="none" />
        )}
        <View style={styles.topRow}>
          <Text style={[styles.number, plain && styles.goldPlain]}>{meetup.number}</Text>
          <View style={[styles.badge, plain && styles.badgePlain]}>
            <Text style={[styles.badgeText, plain && styles.goldPlain]} numberOfLines={1}>
              {meetup.badge}
            </Text>
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={[styles.title, plain && styles.titlePlain]} numberOfLines={1}>
            {meetup.title}
          </Text>
          <Text style={[styles.teaser, plain && styles.teaserPlain]} numberOfLines={2}>
            {meetup.description}
          </Text>
          <Text style={[styles.cta, plain && styles.goldPlain]}>{meetup.cta}</Text>
        </View>
      </View>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  intro: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  card: {
    // A floor, not a fixed height: a larger system font grows the card instead of clipping the pitch.
    minHeight: 210,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  // No thumbnail: the themed gold wash alone.
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  // The themed colours of a card with no thumbnail (same roles as the on-photo ones).
  titlePlain: { color: colors.textPrimary },
  teaserPlain: { color: colors.textSecondary },
  goldPlain: { color: colors.goldText },
  badgePlain: { backgroundColor: colors.goldSoft },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sm },
  number: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18, color: colors.onPhotoGold, opacity: 0.9 },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.onPhotoGold },
  bottom: { padding: spacing.md, gap: spacing.xs },
  title: { ...typography.subtitle, color: colors.onPhoto, textAlign: textStart },
  teaser: { ...typography.caption, color: colors.onPhotoSoft, textAlign: textStart },
  cta: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18, color: colors.onPhotoGold, textAlign: textStart },
}));

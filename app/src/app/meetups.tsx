import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { meetupsFor, useMeetupsContent, type Meetup, type PortalKey } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { youtubeIdOf } from '@/lib/player';
import { textStart } from '@/i18n/direction';
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
          <Text style={styles.intro}>{intro}</Text>
        </FadeInView>
      ) : null}
      {meetups.map((meetup, index) => (
        <FadeInView key={meetup.key} delay={entranceDelay(index, 70)}>
          <MeetupCard meetup={meetup} onPress={() => router.push(`/meetup/${meetup.key}` as Href)} />
        </FadeInView>
      ))}
    </Screen>
  );
}

/** The photo is the king (M96 pattern): the film's thumbnail fills the card, the pitch sits on a scrim. */
function MeetupCard({ meetup, onPress }: { meetup: Meetup; onPress: () => void }) {
  const youtubeId = youtubeIdOf(meetup.videoUrl);
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={meetup.title}>
      <View style={styles.card}>
        {youtubeId ? (
          <Image source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="people-outline" size={52} color={colors.goldDark} />
          </View>
        )}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.topRow}>
          <Text style={styles.number}>{meetup.number}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{meetup.badge}</Text>
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={styles.title} numberOfLines={1}>
            {meetup.title}
          </Text>
          <Text style={styles.teaser} numberOfLines={2}>
            {meetup.description}
          </Text>
          <Text style={styles.cta}>{meetup.cta}</Text>
        </View>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  intro: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  card: {
    height: 210,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.sm },
  number: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18, color: colors.goldLight, opacity: 0.9 },
  badge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  bottom: { padding: spacing.md, gap: spacing.xs },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  teaser: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  cta: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18, color: colors.goldLight, textAlign: textStart },
});

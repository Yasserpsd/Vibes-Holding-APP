import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { meetupsFor, useMeetupsContent, type Meetup, type PortalKey } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { youtubeIdOf } from '@/lib/player';
import { textStart } from '@/i18n/direction';
import { colors, fonts, gradients, radii, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 200;
const CARD_HEIGHT = 196;

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

function MiniMeetup({ meetup, onPress }: { meetup: Meetup; onPress: () => void }) {
  const youtubeId = youtubeIdOf(meetup.videoUrl);
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={meetup.title}>
      <View style={styles.card}>
        {youtubeId ? (
          <Image source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="people-outline" size={44} color={colors.goldDark} />
          </View>
        )}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.topRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText} numberOfLines={1}>
              {meetup.badge}
            </Text>
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={styles.title} numberOfLines={2}>
            {meetup.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meetup.cta}
          </Text>
        </View>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingBottom: spacing.xs },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.sm },
  bottom: { padding: spacing.sm + 2, gap: spacing.xs },
  title: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.textPrimary, textAlign: textStart },
  meta: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  pillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldLight },
});

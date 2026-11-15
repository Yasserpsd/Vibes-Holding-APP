import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Text, View, type ScrollView } from 'react-native';

import { useMeetupsContent, type Meetup } from '@/api/content';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { FormEmbed } from '@/components/FormEmbed';
import { t } from '@/i18n';
import { markParagraphs, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, spacing, typography } from '@/theme/tokens';

/**
 * M119 (owner): a meetup page opens on its film, then the pitch and the three features, and the
 * registration form sits right under them on the same screen — no detour.
 */
export default function MeetupScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { data, isLoading, error, refetch } = useMeetupsContent();
  const meetup: Meetup | undefined = data?.meetups.find((entry) => entry.key === key);
  useAdvisorScreen(meetup ? { type: 'service', id: `meetup-${meetup.key}`, title: meetup.title } : null);
  // The registration form scrolls the page to its first red field.
  const scrollRef = useRef<ScrollView | null>(null);

  if (!meetup) {
    return (
      <Screen>
        {/* Content loaded but this key is not in it (a stale deep link): say so instead of a blank screen. */}
        <StateView loading={isLoading} error={error} empty={Boolean(data)} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scrollRef={scrollRef} title={meetup.title} subtitle={meetup.tagline || undefined}>
      <Stack.Screen options={{ title: `${meetup.badge} ${meetup.title}` }} />
      {meetup.videoUrl ? (
        <FadeInView>
          <YouTubeEmbed url={meetup.videoUrl} title={meetup.title} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(1)}>
        <Text style={styles.description}>{markParagraphs(meetup.description)}</Text>
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <View style={styles.features}>
          {meetup.features.map((feature) => (
            <View key={feature.title} style={styles.feature}>
              <Ionicons name="sparkles-outline" size={18} color={colors.gold} />
              <View style={styles.featureBody}>
                <Text style={styles.featureTitle}>{markParagraphs(feature.title)}</Text>
                <Text style={styles.featureText}>{markParagraphs(feature.text)}</Text>
              </View>
            </View>
          ))}
        </View>
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <SectionHeader icon="create-outline" title={meetup.cta} subtitle={t('meetups.formHint')} />
      </FadeInView>
      <FormEmbed formKey={meetup.formKey} scrollRef={scrollRef} />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  description: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  features: { gap: spacing.sm },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    experimental_backgroundImage: gradients.goldWash,
  },
  featureBody: { flex: 1, gap: 2 },
  featureTitle: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.goldLightText, textAlign: textStart },
  featureText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
}));

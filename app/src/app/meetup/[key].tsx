import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useMeetupsContent, type Meetup } from '@/api/content';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { FormEmbed } from '@/components/FormEmbed';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
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

  if (!meetup) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen title={meetup.title} subtitle={meetup.tagline || undefined}>
      <Stack.Screen options={{ title: `${meetup.badge} ${meetup.title}` }} />
      {meetup.videoUrl ? (
        <FadeInView>
          <YouTubeEmbed url={meetup.videoUrl} title={meetup.title} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(1)}>
        <Text style={styles.description}>{meetup.description}</Text>
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <View style={styles.features}>
          {meetup.features.map((feature) => (
            <View key={feature.title} style={styles.feature}>
              <Ionicons name="sparkles-outline" size={18} color={colors.gold} />
              <View style={styles.featureBody}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureText}>{feature.text}</Text>
              </View>
            </View>
          ))}
        </View>
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <SectionHeader icon="create-outline" title={meetup.cta} subtitle={t('meetups.formHint')} />
      </FadeInView>
      <FormEmbed formKey={meetup.formKey} />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  featureTitle: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.goldLight, textAlign: textStart },
  featureText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
});

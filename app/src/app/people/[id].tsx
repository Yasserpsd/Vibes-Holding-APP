import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { usePerson } from '@/api/people';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { PersonAvatar } from '@/components/PeopleBlock';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

/** M11: one club figure's public page — photo, bio, journey milestones and links. */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson(typeof id === 'string' ? id : undefined);
  const data = person.data?.person;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.person') }} />
      {!data ? (
        <StateView loading={person.isLoading} error={person.error} onRetry={() => void person.refetch()} />
      ) : (
        <>
          <FadeInView style={styles.head} offset={12}>
            <View style={styles.avatarRing}>
              <PersonAvatar person={data} size={104} />
            </View>
            <Text style={styles.name}>{data.name}</Text>
            {data.title || data.company ? <Text style={styles.title}>{[data.title, data.company].filter(Boolean).join(' · ')}</Text> : null}
          </FadeInView>

          <FadeInView delay={120}>
            <Text style={styles.bio}>{data.bio}</Text>
          </FadeInView>

          {data.milestones.length > 0 ? (
            <FadeInView delay={180}>
              <GlassCard style={styles.card}>
                <Text style={styles.sectionTitle}>{t('people.milestonesTitle')}</Text>
                {data.milestones.map((milestone, index) => (
                  <FadeInView key={`${index}-${milestone}`} delay={220 + entranceDelay(index, 60)} style={styles.milestone}>
                    <View style={styles.rail}>
                      <View style={[styles.dot, index === 0 && styles.dotActive]} />
                      {index < data.milestones.length - 1 ? <View style={styles.railLine} /> : null}
                    </View>
                    <Text style={styles.milestoneText}>{milestone}</Text>
                  </FadeInView>
                ))}
              </GlassCard>
            </FadeInView>
          ) : null}

          {data.links.length > 0 ? (
            <FadeInView delay={260}>
              <GlassCard style={styles.card}>
                <Text style={styles.sectionTitle}>{t('people.linksTitle')}</Text>
                {data.links.map((link) => (
                  <PressScale key={link.url} style={styles.link} onPress={() => void openLink(link.url)} accessibilityRole="link">
                    <Ionicons name="link-outline" size={18} color={colors.gold} />
                    <Text style={styles.linkText} numberOfLines={1}>
                      {link.label || link.url}
                    </Text>
                  </PressScale>
                ))}
              </GlassCard>
            </FadeInView>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: spacing.sm },
  avatarRing: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    padding: 3,
    boxShadow: shadows.glowGold,
  },
  name: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  title: { ...typography.body, color: colors.gold, textAlign: 'center' },
  bio: { ...typography.body, color: colors.textSecondary, textAlign: textStart, lineHeight: 26 },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  // The journey reads as one golden thread: a lit rail connects the milestone dots.
  milestone: { flexDirection: 'row', gap: spacing.sm },
  rail: { width: 12, alignItems: 'center' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    marginTop: 7,
  },
  dotActive: { backgroundColor: colors.gold, borderColor: colors.goldLight, boxShadow: shadows.glowGoldFaint },
  railLine: { flex: 1, width: 2, borderRadius: 1, backgroundColor: colors.borderGoldSoft, marginTop: 2, marginBottom: -spacing.sm },
  milestoneText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  linkText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
});

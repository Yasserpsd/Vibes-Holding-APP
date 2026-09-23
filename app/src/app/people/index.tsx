import { Stack, useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { usePeople, type Person } from '@/api/people';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { PersonAvatar } from '@/components/PeopleBlock';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** M11 «شخصية ومسيرة»: the approved club figures, and the member's way to apply. */
export default function PeopleScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const people = usePeople();
  const items = people.data?.people ?? [];

  return (
    <Screen title={t('people.title')} subtitle={people.data?.intro ?? ''}>
      <Stack.Screen options={{ title: t('nav.people') }} />

      <AppButton
        label={t('people.applyCta')}
        icon="sparkles-outline"
        onPress={() => router.push((status === 'signedIn' ? '/people/apply' : '/auth/login') as Href)}
      />

      {!people.data ? (
        <StateView loading={people.isLoading} error={people.error} onRetry={() => void people.refetch()} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{t('people.empty')}</Text>
      ) : (
        items.map((person, index) => (
          <FadeInView key={person.id} delay={entranceDelay(index, 60)}>
            <PersonRow person={person} onPress={() => router.push(`/people/${person.id}` as Href)} />
          </FadeInView>
        ))
      )}
    </Screen>
  );
}

function PersonRow({ person, onPress }: { person: Person; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={person.name}>
      <PersonAvatar person={person} size={56} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {[person.title, person.company].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  rowTitle: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});

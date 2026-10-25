import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { usePeople, type Person } from '@/api/people';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { PersonAvatar } from '@/components/PeopleBlock';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatPeopleCount } from '@/lib/format';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/** M11 «شخصية ومسيرة»: the approved club figures, and the member's way to apply. */
export default function PeopleScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const people = usePeople();
  const items = people.data?.people ?? [];

  return (
    <Screen title={t('people.title')} subtitle={people.data?.intro ?? ''}>
      <Stack.Screen options={{ title: t('nav.people') }} />

      <FadeInView offset={10}>
        <AppButton
          label={t('people.applyCta')}
          icon="sparkles-outline"
          onPress={() => router.push((status === 'signedIn' ? '/people/apply' : '/auth/login') as Href)}
        />
      </FadeInView>

      {/* Icons pass: the roster's size as a small golden pill. */}
      {items.length > 0 ? (
        <FadeInView delay={100} offset={6}>
          <View style={styles.countRow}>
            <View style={styles.countPill}>
              <Ionicons name="sparkles-outline" size={14} color={colors.gold} />
              <Text style={styles.countPillText}>{formatPeopleCount(items.length)}</Text>
            </View>
          </View>
        </FadeInView>
      ) : null}

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
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={person.name}>
      <GlassCard style={styles.row}>
        <View style={styles.avatarRing}>
          <PersonAvatar person={person} size={56} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {person.name}
          </Text>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {[person.title, person.company].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Ionicons name={chevronForward()} size={18} color={colors.goldLight} />
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  // Icons pass: the roster-size pill.
  countRow: { flexDirection: 'row' },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
  },
  countPillText: { ...typography.caption, fontFamily: fonts.medium, color: colors.goldLight },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  avatarRing: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    padding: 2,
    boxShadow: shadows.glowGoldFaint,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  rowTitle: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});

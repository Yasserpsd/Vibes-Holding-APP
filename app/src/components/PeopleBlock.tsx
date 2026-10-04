import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePeople, type Person } from '@/api/people';
import { GlassCard } from '@/components/lux';
import { FadeInView, PressScale, entranceDelay } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M11 «شخصية ومسيرة»: the approved club figures as a strip early on the home.
 * Renders nothing while no profile is approved.
 */
export function PeopleBlock() {
  const router = useRouter();
  const people = usePeople();
  const items = people.data?.people ?? [];
  if (items.length === 0) return null;

  return (
    <FadeInView delay={180}>
      <SectionHeader title={t('people.title')} subtitle={people.data?.intro ?? ''} cta={t('people.all')} onPress={() => router.push('/people' as Href)} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {items.slice(0, 10).map((person, index) => (
          <FadeInView key={person.id} delay={entranceDelay(index, 70)}>
            <PersonCard person={person} onPress={() => router.push(`/people/${person.id}` as Href)} />
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

/** Every avatar — photo or initial — sits inside a golden ring with a faint halo. */
export function PersonAvatar({ person, size }: { person: Person; size: number }) {
  return (
    <View style={[styles.avatarRing, { width: size, height: size, borderRadius: size / 2 }]}>
      {person.photo ? (
        <Image source={{ uri: person.photo }} style={styles.avatarPhoto} resizeMode="cover" />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.38 }]}>{person.name.trim().charAt(0) || '•'}</Text>
      )}
    </View>
  );
}

function PersonCard({ person, onPress }: { person: Person; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={person.name}>
      <GlassCard radius={radii.lg} style={styles.card}>
        <PersonAvatar person={person} size={72} />
        <Text style={styles.name} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {[person.title, person.company].filter(Boolean).join(' · ')}
        </Text>
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingBottom: spacing.xs },
  card: {
    width: 150,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
  },
  avatarRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    boxShadow: shadows.glowGoldFaint,
    overflow: 'hidden',
  },
  avatarPhoto: { width: '100%', height: '100%' },
  initial: { color: colors.gold, fontFamily: fonts.bold },
  name: { ...typography.body, color: colors.textPrimary, textAlign: 'center' },
  title: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

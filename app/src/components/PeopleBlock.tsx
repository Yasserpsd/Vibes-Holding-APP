import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePeople, type Person } from '@/api/people';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { FadeInView, PressScale, entranceDelay } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M11 «شخصية ومسيرة»: the approved club figures as a strip on the home.
 * M73: with the server's `famous` block the section leads the home — its wording comes from the
 * dashboard, an apply button opens the members-only form, and the section shows even while no
 * profile is approved yet (the apply path matters first). Without the block: the old behaviour.
 */
export function PeopleBlock({ block }: { block?: { title: string; subtitle: string; cta: string } }) {
  const router = useRouter();
  const people = usePeople();
  const items = people.data?.people ?? [];
  if (!block && items.length === 0) return null;

  return (
    <FadeInView delay={180}>
      <SectionHeader
        icon="sparkles-outline"
        title={block?.title ?? t('people.title')}
        subtitle={block?.subtitle ?? people.data?.intro ?? ''}
        cta={items.length > 0 ? t('people.all') : null}
        onPress={() => router.push('/people' as Href)}
      />
      {items.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {items.slice(0, 10).map((person, index) => (
            <FadeInView key={person.id} delay={entranceDelay(index, 70)}>
              <PersonCard person={person} onPress={() => router.push(`/people/${person.id}` as Href)} />
            </FadeInView>
          ))}
        </ScrollView>
      ) : null}
      {block ? (
        <AppButton label={block.cta} icon="sparkles-outline" variant="outline" onPress={() => router.push('/people/apply' as Href)} />
      ) : null}
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

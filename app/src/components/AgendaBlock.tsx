import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { useAgenda, type AgendaEvent } from '@/api/agenda';
import { EventDateBadge } from '@/app/agenda/index';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** M41: the next events of «أجندة النادي» as a strip on the home. Renders nothing while the agenda is empty. */
export function AgendaBlock() {
  const router = useRouter();
  const agenda = useAgenda();
  const events = agenda.data?.events ?? [];
  if (events.length === 0) return null;

  return (
    <FadeInView delay={160}>
      <SectionHeader title={t('agenda.title')} subtitle={t('agenda.subtitle')} cta={t('agenda.all')} onPress={() => router.push('/agenda' as Href)} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {events.slice(0, 6).map((event, index) => (
          <FadeInView key={event.id} delay={entranceDelay(index, 70)}>
            <MiniEvent event={event} onPress={() => router.push(`/agenda/${event.id}` as Href)} />
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

function MiniEvent({ event, onPress }: { event: AgendaEvent; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} style={styles.card} accessibilityRole="button" accessibilityLabel={event.title}>
      <EventDateBadge date={event.date} size="sm" />
      <Text style={styles.title} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {event.mine?.paid ? t('agenda.confirmed') : event.feeSar > 0 ? t('agenda.feeTag') : t('agenda.free')}
      </Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingBottom: spacing.xs },
  card: {
    width: 168,
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { ...typography.body, color: colors.textPrimary, textAlign: 'center' },
  meta: { ...typography.caption, color: colors.gold, textAlign: 'center' },
});

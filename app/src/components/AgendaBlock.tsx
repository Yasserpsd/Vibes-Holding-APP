import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAgenda, type AgendaEvent } from '@/api/agenda';
import { EventDateBadge } from '@/app/agenda/index';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 168;

/** M41: the next events of «أجندة النادي» as a strip on the home. Renders nothing while the agenda is empty. */
export function AgendaBlock() {
  const router = useRouter();
  const agenda = useAgenda();
  const events = agenda.data?.events ?? [];
  if (events.length === 0) return null;

  return (
    <FadeInView delay={160}>
      <SectionHeader title={t('agenda.title')} subtitle={t('agenda.subtitle')} cta={t('agenda.all')} onPress={() => router.push('/agenda' as Href)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        snapToInterval={CARD_WIDTH + spacing.sm}
        decelerationRate="fast"
      >
        {events.slice(0, 6).map((event, index) => (
          <FadeInView key={event.id} delay={entranceDelay(index, 70)}>
            <MiniEvent event={event} nearest={index === 0} onPress={() => router.push(`/agenda/${event.id}` as Href)} />
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

/** The nearest event wears the golden card; a paid seat shows as a small lit pill. */
function MiniEvent({ event, nearest, onPress }: { event: AgendaEvent; nearest: boolean; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={event.title}>
      <GlassCard golden={nearest} radius={radii.lg} style={styles.card}>
        <EventDateBadge date={event.date} size="sm" />
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>
        {event.mine?.paid ? (
          <View style={styles.pill}>
            <Text style={styles.pillText} numberOfLines={1}>
              {t('agenda.confirmed')}
            </Text>
          </View>
        ) : (
          <Text style={styles.meta} numberOfLines={1}>
            {event.feeSar > 0 ? t('agenda.feeTag') : t('agenda.free')}
          </Text>
        )}
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingBottom: spacing.xs },
  card: {
    width: CARD_WIDTH,
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: { ...typography.body, color: colors.textPrimary, textAlign: 'center' },
  meta: { ...typography.caption, color: colors.gold, textAlign: 'center' },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  pillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldLight },
});

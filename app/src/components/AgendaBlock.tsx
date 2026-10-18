import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAgenda, type AgendaEvent } from '@/api/agenda';
import { EventDateBadge } from '@/app/agenda/index';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { FlipCountdown } from '@/components/wow';
import { t } from '@/i18n';
import { formatDayCount } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 168;

/** M41 (renamed «أحدث الفعاليات», M77): the next events as a strip on the home. Renders nothing while nothing is upcoming. */
export function AgendaBlock({ ctaLabel }: { ctaLabel?: string } = {}) {
  const router = useRouter();
  const agenda = useAgenda();
  // M77: the finished events stay on the agenda page (faded); the home strip keeps only what is coming.
  const events = (agenda.data?.events ?? []).filter((event) => !event.past);
  if (events.length === 0) return null;

  // M85f: the flip countdown ticks toward the nearest event (Riyadh clock; no time = midnight).
  const nearest = events[0];
  const targetMs = nearest ? Date.parse(`${nearest.date}T${nearest.time || '00:00'}:00+03:00`) : NaN;

  return (
    <FadeInView delay={160}>
      <SectionHeader title={t('agenda.title')} subtitle={t('agenda.subtitle')} cta={ctaLabel ?? t('agenda.all')} onPress={() => router.push('/agenda' as Href)} />
      {nearest && Number.isFinite(targetMs) ? <FlipCountdown targetMs={targetMs} title={nearest.title} /> : null}
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
  // Owner (2026-10-18): the card leads with the workshop's photo, and a multi-day workshop says so.
  const days = event.dates?.length ?? 1;
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={event.title}>
      <GlassCard golden={nearest} radius={radii.lg} style={styles.card}>
        {event.imageUrl ? <Image source={{ uri: event.imageUrl }} style={styles.photo} resizeMode="cover" accessibilityLabel={event.title} /> : null}
        <View style={styles.dateRow}>
          <EventDateBadge date={event.date} size="sm" />
          {days > 1 ? (
            <View style={styles.daysPill}>
              <Text style={styles.daysPillText} numberOfLines={1}>
                {formatDayCount(days)}
              </Text>
            </View>
          ) : null}
        </View>
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
    padding: spacing.sm + 4,
  },
  // The workshop's photo leads the card; the width matches the card's inner width.
  photo: { width: CARD_WIDTH - 2 * (spacing.sm + 4), height: 80, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  daysPill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  daysPillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldLight },
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

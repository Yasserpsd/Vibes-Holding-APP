import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardImageOf, useAgenda, type AgendaEvent } from '@/api/agenda';
import { EventDateBadge } from '@/app/agenda/index';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { FlipCountdown } from '@/components/wow';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatDayCount } from '@/lib/format';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 200;
const CARD_HEIGHT = 216;

/**
 * M41 (renamed «أحدث الفعاليات», M77): the events as a strip on the home — the upcoming ones first,
 * then (M167, owner) the finished ones unlit with «انتهت», so a swipe shows what ran before.
 * Renders nothing while the agenda is empty.
 */
export function AgendaBlock({ ctaLabel }: { ctaLabel?: string } = {}) {
  const router = useRouter();
  const agenda = useAgenda();
  const all = agenda.data?.events ?? [];
  const upcoming = all.filter((event) => !event.past);
  const finished = all.filter((event) => event.past);
  const events = [...upcoming.slice(0, 6), ...finished.slice(0, 4)];
  if (events.length === 0) return null;

  // M96 (owner): the countdown lives ON the nearest event's own card (Riyadh clock; no time = midnight).
  const nearest = upcoming[0];
  const targetMs = nearest ? Date.parse(`${nearest.date}T${nearest.time || '00:00'}:00+03:00`) : NaN;

  return (
    <FadeInView delay={160}>
      <SectionHeader icon="calendar-outline" title={t('agenda.title')} subtitle={t('agenda.subtitle')} cta={ctaLabel ?? t('agenda.all')} onPress={() => router.push('/agenda' as Href)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        snapToInterval={CARD_WIDTH + spacing.sm}
        decelerationRate="fast"
      >
        {events.map((event, index) => (
          <FadeInView key={event.id} delay={entranceDelay(index, 70)}>
            <MiniEvent
              event={event}
              nearest={index === 0 && !event.past}
              countdownMs={index === 0 && !event.past && Number.isFinite(targetMs) ? targetMs : undefined}
              onPress={() => router.push(`/agenda/${event.id}` as Href)}
            />
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

/** M96 (owner): «الصورة هي الملك» — the photo fills the card; date, title and the counter sit ON it over a scrim. */
function MiniEvent({ event, nearest, countdownMs, onPress }: { event: AgendaEvent; nearest: boolean; countdownMs?: number; onPress: () => void }) {
  const days = event.dates?.length ?? 1;
  const past = event.past === true;
  const photo = cardImageOf(event);
  return (
    <PressScale onPress={onPress} glow={!past} glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={event.title}>
      <View style={[styles.card, nearest && styles.cardNearest]}>
        {photo ? (
          <Image source={{ uri: photo }} style={[StyleSheet.absoluteFill, past && styles.photoPast]} resizeMode="cover" accessibilityLabel={event.title} />
        ) : (
          <View style={[styles.fallback, past && styles.photoPast]}>
            <Ionicons name="calendar-outline" size={46} color={colors.goldDark} />
          </View>
        )}
        {/* M167: a finished event is the switched-off lamp of the agenda page — dimmed photo under a shade. */}
        {past ? <View style={styles.pastShade} pointerEvents="none" /> : null}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.topRow}>
          <EventDateBadge date={event.date} size="sm" highlight={nearest} />
          <View style={styles.topPills}>
            {days > 1 ? <GoldPill text={formatDayCount(days)} /> : null}
            {/* With many events the member must see which ones are still ahead — and which ones ran already. */}
            {past ? <GoldPill text={t('agenda.ended')} dim /> : nearest ? null : <GoldPill text={t('agenda.upcoming')} />}
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={styles.title} numberOfLines={2}>
            {event.title}
          </Text>
          <Text style={[styles.meta, past && styles.metaPast]} numberOfLines={1}>
            {past ? t('agenda.ended') : event.mine?.paid ? t('agenda.confirmed') : event.feeSar > 0 ? t('agenda.feeTag') : t('agenda.free')}
          </Text>
          {countdownMs === undefined ? null : <FlipCountdown targetMs={countdownMs} compact />}
        </View>
      </View>
    </PressScale>
  );
}

function GoldPill({ text, dim = false }: { text: string; dim?: boolean }) {
  return (
    <View style={[styles.pill, dim && styles.pillDim]}>
      <Text style={[styles.pillText, dim && styles.pillTextDim]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingBottom: spacing.xs },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardNearest: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.xs, padding: spacing.sm },
  topPills: { alignItems: 'flex-end', gap: spacing.xs },
  bottom: { padding: spacing.sm + 2, gap: spacing.xs },
  title: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.textPrimary, textAlign: textStart },
  meta: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  metaPast: { color: colors.textMuted },
  photoPast: { opacity: 0.35 },
  pastShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  pillDim: { borderColor: colors.border },
  pillTextDim: { color: colors.textMuted },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  pillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldLight },
});

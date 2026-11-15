import { useRouter, type Href } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardImageOf, useAgenda, type AgendaEvent } from '@/api/agenda';
import { CountdownPlate, EventDateBadge } from '@/app/agenda/index';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { isWatchable, WatchRibbon } from '@/components/WatchRibbon';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatDayCount } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 200;
/** The least a card is tall. It is a floor, not a fixed height: a larger system font or a second line grows the card, and the strip's cards all take the tallest one's height. */
const CARD_MIN_HEIGHT = 216;

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

/**
 * M96 (owner): «الصورة هي الملك» — the photo fills the card; date, title and the counter sit ON it over a scrim.
 * A card with NO photo is a themed surface with the gold wash: no placeholder icon under the text, no dark
 * scrim, and themed text colours (the on-photo colours are for a photo's dark ground only).
 */
function MiniEvent({ event, nearest, countdownMs, onPress }: { event: AgendaEvent; nearest: boolean; countdownMs?: number; onPress: () => void }) {
  const days = event.dates?.length ?? 1;
  // M192: a finished workshop with recordings stays lit, with the «متاحة للمشاهدة» ribbon.
  const watchable = isWatchable(event);
  const past = event.past === true && !watchable;
  const photo = cardImageOf(event);
  const plain = !photo;
  // The tag tells the truth for both readers: «برسوم — سعر خاص للأعضاء» when members pay too, «رسوم لغير الأعضاء» when they do not.
  const feeTag = event.feeSar <= 0 ? t('agenda.free') : (event.memberFeeSar ?? 0) > 0 ? t('agenda.feeTagAll') : t('agenda.feeTag');
  return (
    // flexGrow down the chain: the strip stretches every card to the tallest one's height.
    <PressScale onPress={onPress} glow={!past} glowRadius={radii.lg} wrapStyle={styles.grow} style={styles.grow} accessibilityRole="button" accessibilityLabel={event.title}>
      <View style={[styles.card, nearest && styles.cardNearest]}>
        {photo ? (
          <>
            <Image source={{ uri: sized(photo, 260) }} style={[StyleSheet.absoluteFill, past && styles.photoPast]} resizeMode="cover" accessibilityLabel={event.title} />
            {/* M167: a finished event is the switched-off lamp of the agenda page — dimmed photo under a shade. */}
            {past ? <View style={styles.pastShade} pointerEvents="none" /> : null}
            <View style={styles.scrim} pointerEvents="none" />
          </>
        ) : (
          <View style={[styles.fallback, past && styles.photoPast]} pointerEvents="none" />
        )}
        <View style={styles.topRow}>
          <EventDateBadge date={event.date} size="sm" highlight={nearest} onPage={plain} />
          <View style={styles.topPills}>
            {days > 1 ? <GoldPill text={formatDayCount(days)} plain={plain} /> : null}
            {/* With many events the member must see which ones are still ahead — and which ones ran already. */}
            {watchable ? <WatchRibbon small /> : past ? <GoldPill text={t('agenda.ended')} dim plain={plain} /> : nearest ? null : <GoldPill text={t('agenda.upcoming')} plain={plain} />}
          </View>
        </View>
        <View style={styles.bottom}>
          <Text style={[styles.title, plain && styles.titlePlain, plain && past && styles.mutedPlain]} numberOfLines={2}>
            {event.title}
          </Text>
          <Text style={[styles.meta, past && styles.metaPast, plain && styles.goldPlain, plain && past && styles.mutedPlain]} numberOfLines={2}>
            {watchable ? t('agenda.watchMeta') : past ? t('agenda.ended') : event.mine?.paid ? t('agenda.confirmed') : feeTag}
          </Text>
          {countdownMs === undefined || watchable ? null : <CountdownPlate targetMs={countdownMs} />}
        </View>
      </View>
    </PressScale>
  );
}

function GoldPill({ text, dim = false, plain = false }: { text: string; dim?: boolean; plain?: boolean }) {
  return (
    <View style={[styles.pill, dim && styles.pillDim, plain && (dim ? styles.pillDimPlain : styles.pillPlain)]}>
      <Text style={[styles.pillText, dim && styles.pillTextDim, plain && (dim ? styles.mutedPlain : styles.goldPlain)]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  // The strip keeps its own distance from the section's description line above it.
  strip: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  grow: { flexGrow: 1 },
  card: {
    flexGrow: 1,
    width: CARD_WIDTH,
    minHeight: CARD_MIN_HEIGHT,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardNearest: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  // No photo: the themed gold wash alone (the date chip already says «event»; an icon here sat under the text).
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  // The themed colours of a card with no photo (same roles as the on-photo ones).
  titlePlain: { color: colors.textPrimary },
  goldPlain: { color: colors.goldText },
  mutedPlain: { color: colors.textMuted },
  pillPlain: { backgroundColor: colors.goldSoft },
  pillDimPlain: { backgroundColor: colors.surface },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.xs, padding: spacing.sm },
  topPills: { alignItems: 'flex-end', gap: spacing.xs },
  bottom: { padding: spacing.sm + 2, gap: spacing.xs },
  title: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.onPhoto, textAlign: textStart },
  meta: { ...typography.caption, color: colors.onPhotoGold, textAlign: textStart },
  metaPast: { color: colors.onPhotoMuted },
  photoPast: { opacity: 0.35 },
  pastShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  pillDim: { borderColor: colors.border },
  pillTextDim: { color: colors.onPhotoMuted },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  pillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.onPhotoGold },
}));

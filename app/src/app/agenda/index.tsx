import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter, type Href } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { cardImageOf, useAgenda, type AgendaEvent } from '@/api/agenda';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { FlipCountdown } from '@/components/wow';
import { getLang, t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatEventDays } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const LRM = '‎';
const MODE_KEY: Record<AgendaEvent['mode'], StringKey> = { hq: 'agenda.modeHq', online: 'agenda.modeOnline', both: 'agenda.modeBoth' };

/** M41 «أجندة النادي»: the year's upcoming events, one tap away from a confirmed attendance. */
export default function AgendaScreen() {
  const router = useRouter();
  const agenda = useAgenda();
  const events = agenda.data?.events ?? [];
  // M96: the countdown belongs to the nearest upcoming event's own card.
  const nearest = events.find((event) => !event.past);
  const targetMs = nearest ? Date.parse(`${nearest.date}T${nearest.time || '00:00'}:00+03:00`) : NaN;

  return (
    <Screen title={t('agenda.title')} subtitle={t('agenda.subtitle')}>
      <Stack.Screen options={{ title: t('nav.agenda') }} />
      {!agenda.data ? (
        <StateView loading={agenda.isLoading} error={agenda.error} onRetry={() => void agenda.refetch()} />
      ) : events.length === 0 ? (
        <Text style={styles.empty}>{t('agenda.empty')}</Text>
      ) : (
        events.map((event, index) => (
          <FadeInView key={event.id} delay={entranceDelay(index, 70)}>
            <EventCard
              event={event}
              highlight={event === nearest}
              countdownMs={event === nearest && Number.isFinite(targetMs) ? targetMs : undefined}
              onPress={() => router.push(`/agenda/${event.id}` as Href)}
            />
          </FadeInView>
        ))
      )}
    </Screen>
  );
}

export function EventDateBadge({ date, size = 'md', highlight = false }: { date: string; size?: 'sm' | 'md'; highlight?: boolean }) {
  const day = date.slice(8, 10);
  const month = new Date(`${date}T12:00:00Z`).toLocaleDateString(getLang() === 'en' ? 'en' : 'ar', { month: 'short' });
  const small = size === 'sm';
  return (
    <View style={[styles.badge, small && styles.badgeSm, highlight && styles.badgeGlow]}>
      <Text style={[styles.badgeDay, small && styles.badgeDaySm]}>{day}</Text>
      <Text style={styles.badgeMonth}>{month}</Text>
    </View>
  );
}

/**
 * M96 (owner): «الصورة هي الملك» — the photo fills the card and everything sits on it over a scrim.
 * A finished event renders unlit (dimmed photo + «انتهت»), a far upcoming one carries «قادمة»,
 * and the nearest one wears the glow and its own countdown.
 */
function EventCard({ event, highlight, countdownMs, onPress }: { event: AgendaEvent; highlight?: boolean; countdownMs?: number; onPress: () => void }) {
  const mine = event.mine;
  // M77 (owner): a finished event stays on the list — M96 made it «مش منوّرة», a switched-off lamp.
  const past = event.past === true;
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={event.title}>
      <View style={[styles.card, highlight && styles.cardGlow]}>
        {cardImageOf(event) ? (
          <Image source={{ uri: sized(cardImageOf(event), 360) }} style={[StyleSheet.absoluteFill, past && styles.photoPast]} resizeMode="cover" accessibilityLabel={event.title} />
        ) : (
          <View style={[styles.fallback, past && styles.photoPast]}>
            <Ionicons name="calendar-outline" size={52} color={colors.goldDark} />
          </View>
        )}
        {past ? <View style={styles.pastShade} pointerEvents="none" /> : null}
        <View style={styles.scrim} pointerEvents="none" />
        <View style={styles.topRow}>
          <EventDateBadge date={event.date} highlight={highlight} />
          {past ? (
            <View style={[styles.pill, styles.pillDim]}>
              <Text style={[styles.pillText, styles.pillTextDim]}>{t('agenda.ended')}</Text>
            </View>
          ) : highlight ? null : (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{t('agenda.upcoming')}</Text>
            </View>
          )}
        </View>
        <View style={styles.bottom}>
          <Text style={[styles.title, past && styles.titlePast]} numberOfLines={2}>
            {event.title}
          </Text>
          <Text style={styles.meta} numberOfLines={2}>
            {`${formatEventDays(event.dates, event.date)}${event.time ? ` · ${LRM}${event.time}` : ''} · ${t(MODE_KEY[event.mode])}`}
          </Text>
          {past ? null : (
            <Text style={styles.fee} numberOfLines={1}>
              {event.feeSar > 0 ? t('agenda.fee', { fee: String(event.feeSar) }) : t('agenda.free')}
            </Text>
          )}
          {mine ? (
            <View style={styles.minePill}>
              <Ionicons name={mine.paid ? 'checkmark-circle' : 'time-outline'} size={14} color={mine.paid ? colors.success : colors.warning} />
              <Text style={[styles.mineText, { color: mine.paid ? colors.success : colors.warning }]} numberOfLines={1}>
                {mine.paid ? t('agenda.confirmed') : t('agenda.pendingPay')}
              </Text>
            </View>
          ) : null}
          {countdownMs === undefined || past ? null : (
            <View style={styles.countdownWrap}>
              <FlipCountdown targetMs={countdownMs} compact />
            </View>
          )}
        </View>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  card: {
    minHeight: 196,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardGlow: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  // M96: the switched-off lamp — the photo loses its light and a shade settles over it.
  photoPast: { opacity: 0.35 },
  pastShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.md },
  bottom: { padding: spacing.md, gap: 4 },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  titlePast: { color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  fee: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  minePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mineText: { ...typography.caption, flex: 1, textAlign: textStart },
  countdownWrap: { alignSelf: 'flex-start', marginTop: spacing.xs },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  pillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  pillDim: { borderColor: colors.border },
  pillTextDim: { color: colors.textMuted },
  badge: {
    width: 58,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(7, 7, 8, 0.72)',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: 2,
  },
  // The next upcoming event's date carries the neon: a lit gold frame and a faint halo.
  badgeGlow: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  badgeSm: { width: 48, paddingVertical: spacing.xs },
  badgeDay: { color: colors.gold, fontFamily: fonts.bold, fontSize: 22, lineHeight: 26 },
  badgeDaySm: { fontSize: 18, lineHeight: 22 },
  badgeMonth: { ...typography.caption, color: colors.textSecondary },
});

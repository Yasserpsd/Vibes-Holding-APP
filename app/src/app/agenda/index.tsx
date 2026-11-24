import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { cardImageOf, useAgenda, type AgendaEvent } from '@/api/agenda';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SarText } from '@/components/SarText';
import { Screen } from '@/components/Screen';
import { SlotBanner } from '@/components/SlotBanner';
import { StateView } from '@/components/StateView';
import { isWatchable, WatchRibbon } from '@/components/WatchRibbon';
import { FlipCountdown } from '@/components/wow';
import { getLang, t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatEventDays } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const LRM = '‎';
/** The dark ground that on-photo colours need: the same in both themes, used only over a photo or as a plate of its own. */
const DARK_GLASS = 'rgba(7, 7, 8, 0.72)';
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
      {/* M270: the agenda opens on its own picture — shows only when the owner fills the slot. */}
      <SlotBanner slot="agenda.banner" />
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

/**
 * The date chip. On a card it sits ON the photo (dark in both themes), so it keeps its dark glass;
 * `onPage` is for a themed ground — the event page, or a card that has no photo — where it follows the theme.
 */
export function EventDateBadge({ date, size = 'md', highlight = false, onPage = false }: { date: string; size?: 'sm' | 'md'; highlight?: boolean; onPage?: boolean }) {
  const day = date.slice(8, 10);
  // The date is a plain calendar day: read it in UTC so a phone far east of Riyadh never flips the month at a month end.
  const month = new Date(`${date}T12:00:00Z`).toLocaleDateString(getLang() === 'en' ? 'en' : 'ar', { month: 'short', timeZone: 'UTC' });
  const small = size === 'sm';
  return (
    <View style={[styles.badge, onPage && styles.badgeOnPage, small && styles.badgeSm, highlight && styles.badgeGlow]}>
      <Text style={[styles.badgeDay, onPage && styles.badgeDayOnPage, small && styles.badgeDaySm]}>{day}</Text>
      <Text style={[styles.badgeMonth, onPage && styles.badgeMonthOnPage]}>{month}</Text>
    </View>
  );
}

/**
 * The compact countdown on its own dark plate. Its label and digits are on-photo colours, so they always get a
 * dark ground — over a busy photo and on a card with no photo alike. Renders nothing once the moment has passed
 * (the countdown itself does the same), so no empty plate is left behind.
 */
export function CountdownPlate({ targetMs }: { targetMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  if (targetMs <= now) return null;
  return (
    <View style={styles.countdownPlate}>
      <FlipCountdown targetMs={targetMs} compact />
    </View>
  );
}

/**
 * M96 (owner): «الصورة هي الملك» — the photo fills the card and everything sits on it over a scrim.
 * A finished event renders unlit (dimmed photo + «انتهت»), a far upcoming one carries «قادمة»,
 * and the nearest one wears the glow and its own countdown.
 * A card with NO photo is a themed surface with the gold wash: no placeholder icon under the text, no dark
 * scrim, and themed text colours (the on-photo colours are for a photo's dark ground only).
 */
function EventCard({ event, highlight, countdownMs, onPress }: { event: AgendaEvent; highlight?: boolean; countdownMs?: number; onPress: () => void }) {
  const mine = event.mine;
  // M77 (owner): a finished event stays on the list — M96 made it «مش منوّرة», a switched-off lamp.
  // M192: a finished workshop with recordings stays lit, with the «متاحة للمشاهدة» ribbon.
  const watchable = isWatchable(event);
  const past = event.past === true && !watchable;
  const ended = event.past === true;
  const photo = cardImageOf(event);
  const plain = !photo;
  const memberFee = event.memberFeeSar ?? 0;
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={event.title}>
      <View style={[styles.card, highlight && styles.cardGlow]}>
        {photo ? (
          <>
            <Image source={{ uri: sized(photo, 360) }} style={[StyleSheet.absoluteFill, past && styles.photoPast]} resizeMode="cover" accessibilityLabel={event.title} />
            {past ? <View style={styles.pastShade} pointerEvents="none" /> : null}
            <View style={styles.scrim} pointerEvents="none" />
          </>
        ) : (
          <View style={[styles.fallback, past && styles.photoPast]} pointerEvents="none" />
        )}
        <View style={styles.topRow}>
          <EventDateBadge date={event.date} highlight={highlight} onPage={plain} />
          {watchable ? (
            <WatchRibbon />
          ) : past ? (
            <View style={[styles.pill, styles.pillDim, plain && styles.pillDimPlain]}>
              <Text style={[styles.pillText, styles.pillTextDim, plain && styles.textPastPlain]} numberOfLines={1}>
                {t('agenda.ended')}
              </Text>
            </View>
          ) : highlight ? null : (
            <View style={[styles.pill, plain && styles.pillPlain]}>
              <Text style={[styles.pillText, plain && styles.goldPlain]} numberOfLines={1}>
                {t('agenda.upcoming')}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.bottom}>
          <Text style={[styles.title, past && styles.titlePast, plain && styles.titlePlain, plain && past && styles.textPastPlain]} numberOfLines={2}>
            {event.title}
          </Text>
          <Text style={[styles.meta, plain && styles.metaPlain, plain && past && styles.textPastPlain]} numberOfLines={2}>
            {`${formatEventDays(event.dates, event.date)}${event.time ? ` · ${LRM}${event.time}` : ''} · ${t(MODE_KEY[event.mode])}`}
          </Text>
          {ended ? null : (
            // The truth for both readers: what members pay and what everyone else pays (a member fee of 0 = within the membership).
            <SarText style={[styles.fee, plain && styles.goldPlain]} numberOfLines={2}>
              {event.feeSar <= 0
                ? t('agenda.free')
                : memberFee > 0
                  ? t('agenda.feeBoth', { member: String(memberFee), fee: String(event.feeSar) })
                  : t('agenda.fee', { fee: String(event.feeSar) })}
            </SarText>
          )}
          {mine ? (
            <View style={styles.minePill}>
              <Ionicons name={mine.paid ? 'checkmark-circle' : 'time-outline'} size={14} color={mine.paid ? colors.success : colors.warning} />
              <Text style={[styles.mineText, { color: mine.paid ? colors.success : colors.warning }]} numberOfLines={1}>
                {mine.paid ? t('agenda.confirmed') : t('agenda.pendingPay')}
              </Text>
            </View>
          ) : null}
          {countdownMs === undefined || ended ? null : <CountdownPlate targetMs={countdownMs} />}
        </View>
      </View>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
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
  // No photo: the themed gold wash alone (the date chip already says «event»; an icon here sat under the text).
  fallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  // M96: the switched-off lamp — the photo loses its light and a shade settles over it.
  photoPast: { opacity: 0.35 },
  pastShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.md },
  bottom: { padding: spacing.md, gap: 4 },
  title: { ...typography.subtitle, color: colors.onPhoto, textAlign: textStart },
  titlePast: { color: colors.onPhotoSoft },
  meta: { ...typography.caption, color: colors.onPhotoSoft, textAlign: textStart },
  fee: { ...typography.caption, color: colors.onPhotoGold, textAlign: textStart },
  // The themed colours of a card with no photo (same roles as the on-photo ones above).
  titlePlain: { color: colors.textPrimary },
  metaPlain: { color: colors.textSecondary },
  goldPlain: { color: colors.goldText },
  textPastPlain: { color: colors.textMuted },
  pillPlain: { backgroundColor: colors.goldSoft },
  pillDimPlain: { backgroundColor: colors.surface },
  minePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mineText: { ...typography.caption, flex: 1, textAlign: textStart },
  countdownPlate: { alignSelf: 'flex-start', marginTop: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.md, backgroundColor: DARK_GLASS },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  pillText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: colors.onPhotoGold },
  pillDim: { borderColor: colors.border },
  pillTextDim: { color: colors.onPhotoMuted },
  badge: {
    width: 58,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: DARK_GLASS,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: 2,
  },
  // The next upcoming event's date carries the neon: a lit gold frame and a faint halo.
  badgeGlow: { borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  badgeSm: { width: 48, paddingVertical: spacing.xs },
  badgeDay: { color: colors.gold, fontFamily: fonts.bold, fontSize: 22, lineHeight: 26 },
  badgeDaySm: { fontSize: 18, lineHeight: 22 },
  badgeMonth: { ...typography.caption, color: colors.onPhotoSoft },
  // On the page (not over a photo) the chip is a themed surface: same look in the dark, readable in the light.
  badgeOnPage: { backgroundColor: colors.surface },
  badgeDayOnPage: { color: colors.goldText },
  badgeMonthOnPage: { color: colors.textSecondary },
}));

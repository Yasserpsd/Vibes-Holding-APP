import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAgenda, type AgendaEvent } from '@/api/agenda';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { getLang, t, type StringKey } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const LRM = '‎';
const MODE_KEY: Record<AgendaEvent['mode'], StringKey> = { hq: 'agenda.modeHq', online: 'agenda.modeOnline', both: 'agenda.modeBoth' };

/** M41 «أجندة النادي»: the year's upcoming events, one tap away from a confirmed attendance. */
export default function AgendaScreen() {
  const router = useRouter();
  const agenda = useAgenda();
  const events = agenda.data?.events ?? [];

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
            <EventCard event={event} onPress={() => router.push(`/agenda/${event.id}` as Href)} />
          </FadeInView>
        ))
      )}
    </Screen>
  );
}

export function EventDateBadge({ date, size = 'md' }: { date: string; size?: 'sm' | 'md' }) {
  const day = date.slice(8, 10);
  const month = new Date(`${date}T12:00:00Z`).toLocaleDateString(getLang() === 'en' ? 'en' : 'ar', { month: 'short' });
  const small = size === 'sm';
  return (
    <View style={[styles.badge, small && styles.badgeSm]}>
      <Text style={[styles.badgeDay, small && styles.badgeDaySm]}>{day}</Text>
      <Text style={styles.badgeMonth}>{month}</Text>
    </View>
  );
}

function EventCard({ event, onPress }: { event: AgendaEvent; onPress: () => void }) {
  const mine = event.mine;
  return (
    <PressScale onPress={onPress} style={styles.card} accessibilityRole="button" accessibilityLabel={event.title}>
      <EventDateBadge date={event.date} />
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {`${formatArabicDate(event.date)}${event.time ? ` · ${LRM}${event.time}` : ''} · ${t(MODE_KEY[event.mode])}`}
        </Text>
        <Text style={styles.fee} numberOfLines={1}>
          {event.feeSar > 0 ? t('agenda.fee', { fee: String(event.feeSar) }) : t('agenda.free')}
        </Text>
        {mine ? (
          <View style={styles.minePill}>
            <Ionicons name={mine.paid ? 'checkmark-circle' : 'time-outline'} size={14} color={mine.paid ? colors.success : colors.warning} />
            <Text style={[styles.mineText, { color: mine.paid ? colors.success : colors.warning }]} numberOfLines={1}>
              {mine.paid ? t('agenda.confirmed') : t('agenda.pendingPay')}
            </Text>
          </View>
        ) : null}
      </View>
      <Ionicons name={chevronForward()} size={18} color={colors.textMuted} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardBody: { flex: 1, gap: 4 },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  fee: { ...typography.caption, color: colors.gold, textAlign: textStart },
  minePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mineText: { ...typography.caption, flex: 1, textAlign: textStart },
  badge: {
    width: 58,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: 2,
  },
  badgeSm: { width: 48, paddingVertical: spacing.xs },
  badgeDay: { color: colors.gold, fontFamily: fonts.bold, fontSize: 22, lineHeight: 26 },
  badgeDaySm: { fontSize: 18, lineHeight: 22 },
  badgeMonth: { ...typography.caption, color: colors.textSecondary },
});

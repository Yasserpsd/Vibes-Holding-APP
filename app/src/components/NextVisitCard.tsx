import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useHq, useMyVisits, type Visit } from '@/api/hq';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { FadeInView } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { addToCalendar, calendarAvailable } from '@/lib/calendar';
import { formatArabicDate, weekdayOf } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** The calendar event of one booking: its purpose as the title, the HQ address as the place. */
export function visitCalendarEvent(visit: Visit, address: string | undefined) {
  return { title: t('hq.calendarTitle', { purpose: visit.purpose }), start: visit.slotStart, end: visit.slotEnd, location: address, notes: visit.note || undefined };
}

/**
 * M262 (owner, 2026-11-22): «موعدك القادم» on the home — the member's nearest HQ booking that has not
 * ended (confirmed or still waiting for the club), with its entry pass one tap away and, on a binary
 * that carries the calendar module, «أضف إلى التقويم». Nothing shows for a guest or with no booking ahead.
 */
export function NextVisitCard() {
  const router = useRouter();
  const { status } = useAuth();
  const visits = useMyVisits(status === 'signedIn');
  const hq = useHq();
  // The clock is read once per mount (render stays pure); a booking that ends while the home is open leaves on the next open.
  const [now] = useState(() => Date.now());
  const next = (visits.data?.visits ?? [])
    .filter((visit) => (visit.status === 'confirmed' || visit.status === 'pending') && Date.parse(visit.slotEnd) > now)
    .sort((a, b) => Date.parse(a.slotStart) - Date.parse(b.slotStart))[0];
  if (!next) return null;
  const confirmed = next.status === 'confirmed';
  const statusColor = confirmed ? colors.success : colors.warning;
  return (
    <FadeInView delay={150}>
      <GlassCard golden radius={radii.xl} style={styles.card}>
        <View style={styles.head}>
          <Ionicons name="calendar" size={20} color={colors.gold} />
          <Text style={styles.title}>{t('hq.nextTitle')}</Text>
          <View style={[styles.badge, { borderColor: statusColor }]}>
            <Text style={[styles.badgeText, { color: statusColor }]} numberOfLines={1}>
              {t(`hq.status.${next.status}`)}
            </Text>
          </View>
        </View>
        <Text style={styles.date}>{`${weekdayOf(next.date)} ${formatArabicDate(next.date)}`}</Text>
        <Text style={styles.meta}>{t('hq.visitMeta', { from: next.time, to: next.endTime, purpose: next.purpose })}</Text>
        <View style={styles.actions}>
          {next.hasPass ? (
            <AppButton label={t('hq.nextPass')} icon="qr-code-outline" onPress={() => router.push({ pathname: '/hq/pass/[id]', params: { id: next.id } })} style={styles.action} />
          ) : (
            <AppButton label={t('hq.nextDetails')} variant="outline" icon="business-outline" onPress={() => router.push('/hq')} style={styles.action} />
          )}
          {confirmed && calendarAvailable() ? (
            <AppButton label={t('hq.addToCalendar')} variant="outline" icon="calendar-outline" onPress={() => void addToCalendar(visitCalendarEvent(next, hq.data?.content.address))} style={styles.action} />
          ) : null}
        </View>
      </GlassCard>
    </FadeInView>
  );
}

const styles = themedStyles(() => ({
  card: { padding: spacing.md, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.goldLightText, textAlign: textStart },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, backgroundColor: colors.surfaceElevated },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 },
  date: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  // One full-width button per line (side by side, two labels were cut on the HQ card in the emulator pass).
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  action: { alignSelf: 'stretch' },
}));

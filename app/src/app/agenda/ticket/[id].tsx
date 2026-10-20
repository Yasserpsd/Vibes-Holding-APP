import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAgendaTicket, type AgendaTicket } from '@/api/agenda';
import { AppButton } from '@/components/AppButton';
import { FadeInView, PopIn, Sheen } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate, formatEventDays, weekdayOf } from '@/lib/format';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

const STATE: Record<AgendaTicket['state'], { text: StringKey; color: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' }> = {
  upcoming: { text: 'ticket.upcoming', color: colors.warning, icon: 'time-outline' },
  active: { text: 'ticket.active', color: colors.success, icon: 'checkmark-circle' },
  expired: { text: 'ticket.expired', color: colors.danger, icon: 'close-circle' },
};

/** M107: the confirmed attendance as a ticket — the event, the holder, and the QR scanned at the door. */
export default function AgendaTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error, refetch } = useAgendaTicket(typeof id === 'string' ? id : undefined, true);
  // The gold head is measured once laid out, so the metal sheen knows how far to travel.
  const [headSize, setHeadSize] = useState<{ width: number; height: number } | null>(null);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { ticket } = data;
  const state = STATE[ticket.state];
  const weekday = weekdayOf(ticket.event.date);

  return (
    <Screen>
      <FadeInView offset={18}>
        <View style={[styles.ticket, ticket.state === 'active' && styles.ticketActive]}>
          <View style={styles.head} onLayout={(event) => setHeadSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
            <View style={styles.logoBadge}>
              <Image source={require('../../../../assets/images/club-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.club}>{t('common.clubName')}</Text>
              <Text style={styles.kind}>{t('ticket.kind')}</Text>
            </View>
            {headSize ? <Sheen width={headSize.width} height={headSize.height} /> : null}
          </View>

          <View style={styles.body}>
            <Text style={styles.label}>{t('ticket.event')}</Text>
            <Text style={styles.name}>{ticket.event.title}</Text>
            <View style={styles.grid}>
              <Cell label={t('ticket.day')} value={ticket.event.dates.length > 1 ? formatEventDays(ticket.event.dates, ticket.event.date) : `${weekday} ${formatArabicDate(ticket.event.date)}`} />
              {ticket.event.time ? <Cell label={t('ticket.time')} value={ticket.event.endTime ? t('hqPass.timeRange', { from: ticket.event.time, to: ticket.event.endTime }) : ticket.event.time} /> : null}
            </View>
            <View style={styles.grid}>
              <Cell label={t('ticket.holder')} value={ticket.name} />
              <Cell label={t('ticket.attendance')} value={ticket.attendance === 'hq' ? t('agenda.attHq') : t('agenda.attOnline')} />
            </View>
            {ticket.event.place && ticket.attendance === 'hq' ? <Text style={styles.note}>{`${t('agenda.place')}: ${ticket.event.place}`}</Text> : null}
          </View>

          <View style={styles.tear}>
            <View style={[styles.notch, styles.notchStart]} />
            <View style={styles.dashes} />
            <View style={[styles.notch, styles.notchEnd]} />
          </View>

          <View style={styles.stub}>
            <View style={styles.qrBox}>
              <Image source={{ uri: ticket.qr }} style={styles.qr} resizeMode="contain" accessibilityLabel={t('ticket.qr')} />
            </View>
            <Text style={styles.code}>{ticket.code.split(':').pop()}</Text>
            <PopIn delay={200}>
              <View style={[styles.state, { borderColor: state.color }]}>
                <Ionicons name={state.icon} size={20} color={state.color} />
                <Text style={[styles.stateText, { color: state.color }]}>{t(state.text)}</Text>
              </View>
            </PopIn>
          </View>
        </View>
      </FadeInView>

      <Text style={styles.hint}>{t('ticket.hint')}</Text>
      <AppButton label={t('common.refresh')} variant="outline" icon="refresh-outline" onPress={() => void refetch()} />
    </Screen>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const NOTCH = 22;

const styles = StyleSheet.create({
  ticket: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surface,
    experimental_backgroundImage: gradients.surface,
    boxShadow: shadows.lift,
    overflow: 'hidden',
  },
  // A ticket on its day breathes success: the frame picks up a soft halo.
  ticketActive: { boxShadow: shadows.glowGoldFaint },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
  },
  logoBadge: { width: 56, height: 56, borderRadius: radii.pill, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 40, height: 40 },
  headText: { flex: 1, gap: 2 },
  club: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.goldInk, textAlign: textStart },
  kind: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldInk, textAlign: textStart, opacity: 0.8 },
  body: { gap: spacing.sm, padding: spacing.md },
  label: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  name: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: colors.textPrimary, textAlign: textStart },
  grid: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1, gap: 2 },
  value: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, color: colors.goldLight, textAlign: textStart },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  tear: { height: NOTCH, flexDirection: 'row', alignItems: 'center' },
  dashes: { flex: 1, marginHorizontal: NOTCH / 2, borderTopWidth: 1, borderColor: colors.goldDark, borderStyle: 'dashed' },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: colors.black, borderWidth: 1, borderColor: colors.borderGold },
  notchStart: { start: -NOTCH / 2 },
  notchEnd: { end: -NOTCH / 2 },
  stub: { alignItems: 'center', gap: spacing.sm, padding: spacing.md, paddingTop: spacing.sm },
  // The QR stays on pristine white — the scanner's needs beat the theme here.
  qrBox: { padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.white },
  qr: { width: 200, height: 200 },
  code: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center', writingDirection: 'ltr' },
  state: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill, borderWidth: 1, backgroundColor: colors.surfaceElevated },
  stateText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22 },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

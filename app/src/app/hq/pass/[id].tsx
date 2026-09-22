import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { usePass, type PassState } from '@/api/hq';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate, formatArabicDateTime, weekdayOf } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATE: Record<PassState, { text: StringKey; color: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' }> = {
  upcoming: { text: 'hqPass.upcoming', color: colors.warning, icon: 'time-outline' },
  active: { text: 'hqPass.active', color: colors.success, icon: 'checkmark-circle' },
  expired: { text: 'hqPass.expired', color: colors.danger, icon: 'close-circle' },
};

/** The entry pass of a confirmed visit, laid out as a ticket: who, which day and time, when it was booked, and the QR. */
export default function PassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error, refetch } = usePass(id);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { pass } = data;
  const state = STATE[pass.state];
  const weekday = weekdayOf(pass.visit.date);

  return (
    <Screen>
      <View style={styles.ticket}>
        <View style={styles.head}>
          <View style={styles.logoBadge}>
            <Image source={require('../../../../assets/images/club-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.club}>{t('common.clubName')}</Text>
            <Text style={styles.kind}>{t('hqPass.kind')}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.label}>{t('hqPass.name')}</Text>
          <Text style={styles.name}>{pass.name}</Text>
          <View style={styles.grid}>
            <Cell label={t('hqPass.day')} value={`${weekday} ${formatArabicDate(pass.visit.date)}`} />
            <Cell label={t('hqPass.time')} value={t('hqPass.timeRange', { from: pass.visit.time, to: pass.visit.endTime })} />
          </View>
          <View style={styles.grid}>
            <Cell label={t('hqPass.purpose')} value={pass.visit.purpose} />
            <Cell label={t('hqPass.bookedAt')} value={formatArabicDateTime(pass.visit.createdAt)} />
          </View>
          {pass.visit.adminNote ? <Text style={styles.note}>{t('hq.adminNote', { note: pass.visit.adminNote })}</Text> : null}
        </View>

        <View style={styles.tear}>
          <View style={[styles.notch, styles.notchStart]} />
          <View style={styles.dashes} />
          <View style={[styles.notch, styles.notchEnd]} />
        </View>

        <View style={styles.stub}>
          <View style={styles.qrBox}>
            <Image source={{ uri: pass.qr }} style={styles.qr} resizeMode="contain" accessibilityLabel={t('hqPass.qr')} />
          </View>
          <Text style={styles.code}>{pass.code.split(':').pop()}</Text>
          <View style={[styles.state, { borderColor: state.color }]}>
            <Ionicons name={state.icon} size={20} color={state.color} />
            <Text style={[styles.stateText, { color: state.color }]}>{t(state.text)}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.hint}>{t('hqPass.hint')}</Text>
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
  ticket: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.gold },
  // The logo is drawn for dark backgrounds: a black badge keeps it readable on the gold header.
  logoBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 40, height: 40 },
  headText: { flex: 1, gap: 2 },
  club: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.black, textAlign: textStart },
  kind: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.black, textAlign: textStart, opacity: 0.8 },
  body: { gap: spacing.sm, padding: spacing.md },
  label: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  name: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.textPrimary, textAlign: textStart },
  grid: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1, gap: 2 },
  value: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, color: colors.goldLight, textAlign: textStart },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  tear: { height: NOTCH, flexDirection: 'row', alignItems: 'center' },
  dashes: { flex: 1, marginHorizontal: NOTCH / 2, borderTopWidth: 1, borderColor: colors.goldDark, borderStyle: 'dashed' },
  notch: { position: 'absolute', width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: colors.black, borderWidth: 1, borderColor: colors.goldDark },
  notchStart: { start: -NOTCH / 2 },
  notchEnd: { end: -NOTCH / 2 },
  stub: { alignItems: 'center', gap: spacing.sm, padding: spacing.md, paddingTop: spacing.sm },
  qrBox: { padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.white },
  qr: { width: 200, height: 200 },
  code: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center', writingDirection: 'ltr' },
  state: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill, borderWidth: 1 },
  stateText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22 },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { usePass, type PassState } from '@/api/hq';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { WEEKDAYS, formatArabicDate, formatArabicDateTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATE: Record<PassState, { text: string; color: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' }> = {
  upcoming: { text: 'يُفعّل الباركود قبل الموعد بربع ساعة', color: colors.warning, icon: 'time-outline' },
  active: { text: 'صالح الآن للدخول', color: colors.success, icon: 'checkmark-circle' },
  expired: { text: 'انتهى وقت هذا الموعد', color: colors.danger, icon: 'close-circle' },
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
  const weekday = WEEKDAYS[new Date(`${pass.visit.date}T00:00:00Z`).getUTCDay()] ?? '';

  return (
    <Screen>
      <View style={styles.ticket}>
        <View style={styles.head}>
          <View style={styles.logoBadge}>
            <Image source={require('../../../../assets/images/club-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="نادي المستثمرين" />
          </View>
          <View style={styles.headText}>
            <Text style={styles.club}>نادي المستثمرين</Text>
            <Text style={styles.kind}>بطاقة دخول المقر · الرياض</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.label}>الاسم</Text>
          <Text style={styles.name}>{pass.name}</Text>
          <View style={styles.grid}>
            <Cell label="يوم الزيارة" value={`${weekday} ${formatArabicDate(pass.visit.date)}`} />
            <Cell label="الوقت" value={`${pass.visit.time} إلى ${pass.visit.endTime}`} />
          </View>
          <View style={styles.grid}>
            <Cell label="الغرض" value={pass.visit.purpose} />
            <Cell label="تاريخ الحجز" value={formatArabicDateTime(pass.visit.createdAt)} />
          </View>
          {pass.visit.adminNote ? <Text style={styles.note}>{`ملاحظة الإدارة: ${pass.visit.adminNote}`}</Text> : null}
        </View>

        <View style={styles.tear}>
          <View style={[styles.notch, styles.notchStart]} />
          <View style={styles.dashes} />
          <View style={[styles.notch, styles.notchEnd]} />
        </View>

        <View style={styles.stub}>
          <View style={styles.qrBox}>
            <Image source={{ uri: pass.qr }} style={styles.qr} resizeMode="contain" accessibilityLabel="باركود الدخول" />
          </View>
          <Text style={styles.code}>{pass.code.split(':').pop()}</Text>
          <View style={[styles.state, { borderColor: state.color }]}>
            <Ionicons name={state.icon} size={20} color={state.color} />
            <Text style={[styles.stateText, { color: state.color }]}>{state.text}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.hint}>أبرز هذه البطاقة عند الاستقبال مع بطاقة عضويتك. الباركود صالح لهذا الموعد فقط.</Text>
      <AppButton label="تحديث" variant="outline" icon="refresh-outline" onPress={() => void refetch()} />
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
  club: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.black, textAlign: 'right' },
  kind: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.black, textAlign: 'right', opacity: 0.8 },
  body: { gap: spacing.sm, padding: spacing.md },
  label: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
  name: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.textPrimary, textAlign: 'right' },
  grid: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1, gap: 2 },
  value: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, color: colors.goldLight, textAlign: 'right' },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
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

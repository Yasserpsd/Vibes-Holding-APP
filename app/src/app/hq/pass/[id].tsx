import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { usePass, type PassState } from '@/api/hq';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { WEEKDAYS, formatArabicDate } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATE: Record<PassState, { text: string; color: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' }> = {
  upcoming: { text: 'يُفعّل الباركود قبل الموعد بربع ساعة', color: colors.warning, icon: 'time-outline' },
  active: { text: 'صالح الآن للدخول', color: colors.success, icon: 'checkmark-circle' },
  expired: { text: 'انتهى وقت هذا الموعد', color: colors.danger, icon: 'close-circle' },
};

/** The QR pass of a confirmed visit: shown at the reception, valid for that slot only. */
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
      <View style={styles.qrBox}>
        <Image source={{ uri: pass.qr }} style={styles.qr} resizeMode="contain" accessibilityLabel="باركود الدخول" />
      </View>
      <View style={[styles.state, { borderColor: state.color }]}>
        <Ionicons name={state.icon} size={22} color={state.color} />
        <Text style={[styles.stateText, { color: state.color }]}>{state.text}</Text>
      </View>
      <View style={styles.details}>
        <Text style={styles.title}>{`${weekday} ${formatArabicDate(pass.visit.date)}`}</Text>
        <Text style={styles.meta}>{`من ${pass.visit.time} إلى ${pass.visit.endTime} · ${pass.visit.purpose}`}</Text>
        {pass.visit.adminNote ? <Text style={styles.meta}>{`ملاحظة الإدارة: ${pass.visit.adminNote}`}</Text> : null}
        <Text style={styles.code}>{pass.code.split(':').pop()}</Text>
      </View>
      <Text style={styles.hint}>أبرز هذا الباركود عند الاستقبال مع بطاقة عضويتك. الباركود صالح لهذا الموعد فقط.</Text>
      <AppButton label="تحديث" variant="outline" icon="refresh-outline" onPress={() => void refetch()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  qrBox: { alignSelf: 'center', padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.white },
  qr: { width: 240, height: 240 },
  state: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1 },
  stateText: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22 },
  details: { gap: 4, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: 'right' },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  code: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs, writingDirection: 'ltr' },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

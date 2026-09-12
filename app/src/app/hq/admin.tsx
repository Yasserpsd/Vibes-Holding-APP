import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { hqApi, useAdminVisits, type AdminVisit, type VerifyResult, type VisitStatus } from '@/api/hq';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { WEEKDAYS, formatArabicDate } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const FILTERS: { key: VisitStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'بانتظار التأكيد' },
  { key: 'confirmed', label: 'مؤكدة' },
  { key: 'all', label: 'الكل' },
];

/** Club admins confirm or reject visit requests and check scanned passes (the dashboard's role until M7). */
export default function HqAdminScreen() {
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const isAdmin = Boolean(me?.isAdmin);
  const [filter, setFilter] = useState<VisitStatus | 'all'>('pending');
  const { data, isLoading, error, refetch } = useAdminVisits(filter === 'all' ? undefined : filter, isAdmin);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  if (!isAdmin) {
    return (
      <Screen title="طلبات الزيارة">
        <Notice tone="warning" text="هذه الصفحة لإدارة النادي فقط." />
      </Screen>
    );
  }

  const decide = async (visit: AdminVisit, status: 'confirmed' | 'rejected') => {
    setBusyId(visit.id);
    setActionError(null);
    try {
      await hqApi.decide(visit.id, status, '');
      await queryClient.invalidateQueries({ queryKey: ['hq'] });
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const verify = async () => {
    setActionError(null);
    try {
      setVerifyResult(await hqApi.verify(code.trim()));
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  };

  return (
    <Screen title="طلبات زيارة المقر" subtitle="أكّد الطلبات ليصدر باركود الدخول للعضو، أو ارفضها.">
      <View style={styles.chips}>
        {FILTERS.map((entry) => (
          <Chip key={entry.key} label={entry.label} selected={entry.key === filter} onPress={() => setFilter(entry.key)} />
        ))}
      </View>
      {actionError ? <Notice tone="warning" text={actionError} /> : null}
      {data ? (
        data.visits.length ? (
          data.visits.map((visit) => <AdminRow key={visit.id} visit={visit} busy={busyId === visit.id} onDecide={(status) => void decide(visit, status)} />)
        ) : (
          <Text style={styles.empty}>لا توجد طلبات في هذه القائمة.</Text>
        )
      ) : (
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      )}

      <SectionHeader title="التحقق من باركود" subtitle="اكتب الرمز المطبوع تحت الباركود أو محتوى المسح." />
      <FormField label="الرمز" value={code} onChangeText={setCode} latin autoCapitalize="none" placeholder="VCHQ:…" />
      <AppButton label="تحقق" icon="qr-code-outline" onPress={() => void verify()} />
      {verifyResult ? (
        <Notice tone={verifyResult.valid ? 'success' : 'warning'} text={verifyResult.visit ? `${verifyResult.text} · ${verifyResult.visit.name} · ${WEEKDAYS[new Date(`${verifyResult.visit.date}T00:00:00Z`).getUTCDay()] ?? ''} ${formatArabicDate(verifyResult.visit.date)} · ${verifyResult.visit.time}` : verifyResult.text} />
      ) : null}
    </Screen>
  );
}

function AdminRow({ visit, busy, onDecide }: { visit: AdminVisit; busy: boolean; onDecide: (status: 'confirmed' | 'rejected') => void }) {
  const weekday = WEEKDAYS[new Date(`${visit.date}T00:00:00Z`).getUTCDay()] ?? '';
  return (
    <View style={styles.visit}>
      <Text style={styles.name}>{visit.name}</Text>
      <Text style={[styles.meta, styles.latin]}>{`${visit.phone} · ${visit.email}`}</Text>
      <Text style={styles.meta}>{`${weekday} ${formatArabicDate(visit.date)} · من ${visit.time} إلى ${visit.endTime}`}</Text>
      <Text style={styles.meta}>{`الغرض: ${visit.purpose}${visit.note ? ` · ${visit.note}` : ''}`}</Text>
      <Text style={styles.status}>{visit.status === 'pending' ? 'بانتظار التأكيد' : visit.status === 'confirmed' ? 'مؤكد' : visit.status === 'rejected' ? 'مرفوض' : 'ملغي'}</Text>
      {visit.status === 'pending' ? (
        <View style={styles.actions}>
          <AppButton label={busy ? '…' : 'تأكيد'} icon="checkmark" onPress={() => (busy ? null : onDecide('confirmed'))} style={styles.action} />
          <AppButton label="رفض" variant="outline" icon="close" onPress={() => (busy ? null : onDecide('rejected'))} style={styles.action} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'right' },
  visit: { gap: 4, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  name: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: 'right' },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  latin: { writingDirection: 'ltr' },
  status: { ...typography.caption, color: colors.goldLight, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});

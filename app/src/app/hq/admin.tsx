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
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate, weekdayOf } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const FILTERS: { key: VisitStatus | 'all'; label: StringKey }[] = [
  { key: 'pending', label: 'hqAdmin.filter.pending' },
  { key: 'confirmed', label: 'hqAdmin.filter.confirmed' },
  { key: 'all', label: 'hqAdmin.filter.all' },
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
      <Screen title={t('hqAdmin.title')}>
        <Notice tone="warning" text={t('hqAdmin.adminOnly')} />
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
    <Screen title={t('hqAdmin.fullTitle')} subtitle={t('hqAdmin.subtitle')}>
      <View style={styles.chips}>
        {FILTERS.map((entry) => (
          <Chip key={entry.key} label={t(entry.label)} selected={entry.key === filter} onPress={() => setFilter(entry.key)} />
        ))}
      </View>
      {actionError ? <Notice tone="warning" text={actionError} /> : null}
      {data ? (
        data.visits.length ? (
          data.visits.map((visit) => <AdminRow key={visit.id} visit={visit} busy={busyId === visit.id} onDecide={(status) => void decide(visit, status)} />)
        ) : (
          <Text style={styles.empty}>{t('hqAdmin.empty')}</Text>
        )
      ) : (
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      )}

      <SectionHeader title={t('hqAdmin.verifyTitle')} subtitle={t('hqAdmin.verifySubtitle')} />
      <FormField label={t('hqAdmin.code')} value={code} onChangeText={setCode} latin autoCapitalize="none" placeholder="VCHQ:…" />
      <AppButton label={t('hqAdmin.verify')} icon="qr-code-outline" onPress={() => void verify()} />
      {verifyResult ? (
        <Notice tone={verifyResult.valid ? 'success' : 'warning'} text={verifyResult.visit ? `${verifyResult.text} · ${verifyResult.visit.name} · ${weekdayOf(verifyResult.visit.date)} ${formatArabicDate(verifyResult.visit.date)} · ${verifyResult.visit.time}` : verifyResult.text} />
      ) : null}
    </Screen>
  );
}

function AdminRow({ visit, busy, onDecide }: { visit: AdminVisit; busy: boolean; onDecide: (status: 'confirmed' | 'rejected') => void }) {
  const weekday = weekdayOf(visit.date);
  return (
    <View style={styles.visit}>
      <Text style={styles.name}>{visit.name}</Text>
      <Text style={[styles.meta, styles.latin]}>{`${visit.phone} · ${visit.email}`}</Text>
      <Text style={styles.meta}>{t('hqAdmin.visitMeta', { day: `${weekday} ${formatArabicDate(visit.date)}`, from: visit.time, to: visit.endTime })}</Text>
      <Text style={styles.meta}>{`${t('hqAdmin.purpose', { purpose: visit.purpose })}${visit.note ? ` · ${visit.note}` : ''}`}</Text>
      <Text style={styles.status}>{t(`hq.status.${visit.status}`)}</Text>
      {visit.status === 'pending' ? (
        <View style={styles.actions}>
          <AppButton label={busy ? '…' : t('hqAdmin.confirm')} icon="checkmark" onPress={() => (busy ? null : onDecide('confirmed'))} style={styles.action} />
          <AppButton label={t('hqAdmin.decline')} variant="outline" icon="close" onPress={() => (busy ? null : onDecide('rejected'))} style={styles.action} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  visit: { gap: 4, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  name: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  latin: { writingDirection: 'ltr' },
  status: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});

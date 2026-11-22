import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, RefreshControl, Text, View } from 'react-native';

import { authApi, type DeviceSession } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldHairline } from '@/components/lux';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M264 (owner, 2026-11-22: «خلي في اوبشن اسمه الجلسات المسجلة يظهر IP ومكان كل شخص فاتح الحساب»): every device
 * signed in to the account — what it is, where it is (the country of its address, looked up on the server), its IP
 * and when it was last active. This device carries a badge; any other one can be signed out, or all of them at once.
 */
export default function SecuritySessionsScreen() {
  const { me } = useAuth();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions, enabled: Boolean(me), staleTime: 0, gcTime: 0 });
  const [refreshing, setRefreshing] = useState(false);
  // The id of the device being signed out, or 'others' for the whole list.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!me) {
    return (
      <Screen title={t('security.sessionsTitle')}>
        <Notice tone="warning" text={t('profile.signInFirst')} />
      </Screen>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await sessions.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const run = async (key: string, action: () => Promise<unknown>, doneText: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(doneText);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      // Whatever happened, the list is read again: a device that was already gone must leave the screen too.
      await sessions.refetch();
      setBusy(null);
    }
  };

  const confirmOne = (device: DeviceSession) => {
    Alert.alert(t('security.sessionsSignOutTitle'), t('security.sessionsSignOutText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('security.sessionsConfirm'), style: 'destructive', onPress: () => void run(device.id, () => authApi.endSession(device.id), t('security.sessionsSignedOut')) },
    ]);
  };

  const confirmOthers = () => {
    Alert.alert(t('security.sessionsSignOutOthersTitle'), t('security.sessionsSignOutOthersText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('security.sessionsConfirm'), style: 'destructive', onPress: () => void run('others', authApi.endOtherSessions, t('security.sessionsOthersSignedOut')) },
    ]);
  };

  const list = sessions.data?.sessions ?? [];
  const others = list.filter((device) => !device.current);

  return (
    <Screen
      title={t('security.sessionsTitle')}
      subtitle={t('security.sessionsSubtitle')}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}
    >
      {sessions.isPending || (sessions.isError && !sessions.data) ? (
        <StateView loading={sessions.isPending} error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (
        <>
          {error ? <Notice tone="warning" text={error} support /> : null}
          {done ? <Notice tone="success" text={done} /> : null}

          {list.map((device, index) => (
            <FadeInView key={device.id} delay={entranceDelay(index)}>
              <GlassCard radius={radii.lg} style={styles.card}>
                <View style={styles.titleRow}>
                  <View style={styles.titleIcon}>
                    <Ionicons name={deviceIcon(device)} size={16} color={colors.gold} />
                  </View>
                  <View style={styles.titleText}>
                    <Text style={styles.deviceName}>{deviceName(device)}</Text>
                    {device.appVersion ? <Text style={styles.hint}>{t('security.sessionsAppVersion', { version: device.appVersion })}</Text> : null}
                  </View>
                  {device.current ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{t('security.sessionsThisDevice')}</Text>
                    </View>
                  ) : null}
                </View>
                <GoldHairline />
                <Row label={t('security.sessionsPlace')} value={device.place ?? t('security.sessionsUnknown')} />
                <Row label={t('security.sessionsIp')} value={device.ip ?? t('security.sessionsUnknown')} latin={Boolean(device.ip)} />
                <Row label={t('security.sessionsLastActive')} value={device.current ? t('security.sessionsActiveNow') : formatRelativeTime(device.lastSeenAt)} />
                <Row label={t('security.sessionsSignedIn')} value={formatRelativeTime(device.signedInAt)} />
                {device.current ? null : (
                  <AppButton label={t('security.sessionsSignOut')} variant="outline" icon="log-out-outline" loading={busy === device.id} disabled={busy !== null && busy !== device.id} onPress={() => confirmOne(device)} />
                )}
              </GlassCard>
            </FadeInView>
          ))}

          {others.length > 0 ? (
            <AppButton label={t('security.sessionsSignOutOthers')} icon="log-out-outline" loading={busy === 'others'} disabled={busy !== null && busy !== 'others'} onPress={confirmOthers} />
          ) : (
            <Text style={styles.note}>{t('security.sessionsOnlyThis')}</Text>
          )}
          <Text style={styles.note}>{t('security.sessionsHint')}</Text>
        </>
      )}
    </Screen>
  );
}

function deviceIcon(device: DeviceSession): IoniconName {
  if (device.dashboard || device.platform === 'web') return 'desktop-outline';
  if (device.platform === 'ios') return 'phone-portrait-outline';
  if (device.platform === 'android') return 'logo-android';
  return 'help-circle-outline';
}

function deviceName(device: DeviceSession): string {
  if (device.dashboard) return t('security.sessionsDashboard');
  if (device.platform === 'ios') return t('security.sessionsIphone');
  if (device.platform === 'android') return t('security.sessionsAndroid');
  if (device.platform === 'web') return t('security.sessionsBrowser');
  return t('security.sessionsUnknownDevice');
}

/** One fact of a device: its name at the start of the line, its value at the end (an address reads left to right). */
function Row({ label, value, latin = false }: { label: string; value: string; latin?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, latin ? styles.rowLatin : null]} selectable={latin}>
        {value}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { gap: spacing.sm, padding: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleIcon: { width: 30, height: 30, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  titleText: { flex: 1, gap: 2 },
  deviceName: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  badge: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.goldSoft, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { ...typography.caption, color: colors.goldText },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  rowValue: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
  rowLatin: { fontFamily: fonts.semiBold, writingDirection: 'ltr' },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
}));

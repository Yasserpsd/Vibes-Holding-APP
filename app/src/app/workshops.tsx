import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useGuide, useMyWorkshops, useRegisterWorkshop, type GuideWorkshop } from '@/api/guide';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const MODE_KEY: Record<GuideWorkshop['mode'], StringKey> = {
  hq: 'guide.modeHq',
  online: 'guide.modeOnline',
  both: 'guide.modeBoth',
};

/**
 * M10: the workshops of «دليل المحايد» — the schedule from the server block, and an interest
 * registration for any signed-in account (no membership needed: the neutrals are its audience).
 */
export default function WorkshopsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const guide = useGuide();
  const mine = useMyWorkshops(signedIn);
  const data = guide.data?.workshops;
  const registered = new Set((mine.data?.registrations ?? []).map((entry) => entry.workshopId));
  const items = [...(data?.items ?? [])].sort((a, b) => a.order - b.order);

  return (
    <Screen title={data?.title} subtitle={data?.intro}>
      <Stack.Screen options={{ title: t('nav.workshops') }} />
      {!data ? (
        <StateView loading={guide.isLoading} error={guide.error} onRetry={() => void guide.refetch()} />
      ) : (
        <>
          {!signedIn ? (
            <>
              <Notice tone="warning" text={t('guide.guest')} />
              <AppButton label={t('guide.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
            </>
          ) : null}
          {items.map((workshop, index) => (
            <FadeInView key={workshop.id} delay={entranceDelay(index, 80)}>
              <WorkshopCard workshop={workshop} texts={data} signedIn={signedIn} registered={registered.has(workshop.id)} />
            </FadeInView>
          ))}
          <Notice tone="info" text={data.note} />
        </>
      )}
    </Screen>
  );
}

function WorkshopCard({
  workshop,
  texts,
  signedIn,
  registered,
}: {
  workshop: GuideWorkshop;
  texts: { registerCta: string; registeredText: string; closedText: string };
  signedIn: boolean;
  registered: boolean;
}) {
  const register = useRegisterWorkshop();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');

  const send = () => {
    if (register.isPending) return;
    register.mutate({ workshopId: workshop.id, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: () => setAsking(false) });
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{workshop.title}</Text>
        <View style={styles.modePill}>
          <Ionicons name={workshop.mode === 'online' ? 'globe-outline' : workshop.mode === 'hq' ? 'business-outline' : 'sync-outline'} size={14} color={colors.gold} />
          <Text style={styles.modeText} numberOfLines={1}>
            {t(MODE_KEY[workshop.mode])}
          </Text>
        </View>
      </View>
      <Text style={styles.blurb}>{workshop.blurb}</Text>
      <View style={styles.scheduleRow}>
        <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
        <Text style={styles.schedule}>{workshop.schedule}</Text>
      </View>

      {registered ? (
        <Notice tone="success" text={texts.registeredText} />
      ) : !workshop.open ? (
        <Text style={styles.closed}>{texts.closedText}</Text>
      ) : !signedIn ? null : asking ? (
        <>
          <FormField label={t('guide.noteField')} value={note} onChangeText={setNote} maxLength={300} multiline />
          {register.error ? <Notice tone="warning" text={register.error.message} /> : null}
          <AppButton label={register.isPending ? '…' : t('guide.send')} icon="paper-plane-outline" onPress={send} />
        </>
      ) : (
        <AppButton label={texts.registerCta} variant="outline" icon="hand-right-outline" onPress={() => setAsking(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.textPrimary, flex: 1, textAlign: textStart },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  modeText: { ...typography.caption, color: colors.textSecondary },
  blurb: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  schedule: { ...typography.caption, color: colors.textMuted, textAlign: textStart, flex: 1 },
  closed: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});

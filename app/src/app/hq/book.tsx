import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { hqApi, useHq, useHqSlots } from '@/api/hq';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { LockedNotice } from '@/components/LockedNotice';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { isProfileGate, ProfileGateNotice } from '@/components/ProfileGate';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate, weekdayName } from '@/lib/format';
import { colors, spacing, typography } from '@/theme/tokens';

/** Book an HQ visit: day, time slot, purpose and a note. The club confirms; the pass follows. */
export default function BookVisitScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { data, isLoading, error, refetch } = useHq();
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const selectedDate = date ?? data?.days[0]?.date ?? null;
  const slots = useHqSlots(selectedDate);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  if (data.access !== 'member') {
    return (
      <Screen title={t('hqBook.title')}>
        <LockedNotice text={data.lockedText ?? data.content.memberOnlyText} guest={status !== 'signedIn'} />
      </Screen>
    );
  }

  const submit = async () => {
    if (!selectedDate || !time || !purpose) {
      setSubmitError(t('hqBook.incomplete'));
      return;
    }
    setBusy(true);
    setSubmitError(null);
    setGated(false);
    try {
      await hqApi.book({ date: selectedDate, time, purpose, note });
      await queryClient.invalidateQueries({ queryKey: ['hq'] });
      router.back();
    } catch (cause) {
      setSubmitError(errorMessage(cause));
      setGated(isProfileGate(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('hqBook.title')} subtitle={t('hqBook.subtitle')}>
      <FadeInView delay={entranceDelay(1)}>
        <Text style={styles.label}>{t('hqBook.day')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {data.days.map((day) => (
            <Chip
              key={day.date}
              label={`${weekdayName(day.weekday)} ${formatArabicDate(day.date)}`}
              selected={day.date === selectedDate}
              onPress={() => {
                setDate(day.date);
                setTime(null);
              }}
            />
          ))}
        </ScrollView>
      </FadeInView>

      <FadeInView delay={entranceDelay(2)}>
        <Text style={styles.label}>{t('hqBook.time')}</Text>
        {slots.data ? (
          <View style={styles.chips}>
            {slots.data.slots.map((slot) => (
              <Chip
                key={slot.time}
                label={slot.available ? t('hqBook.slot', { from: slot.time, to: slot.endTime }) : t('hqBook.slotFull', { time: slot.time })}
                selected={slot.time === time}
                onPress={() => (slot.available ? setTime(slot.time) : null)}
              />
            ))}
          </View>
        ) : (
          <StateView loading={slots.isLoading} error={slots.error} onRetry={() => void slots.refetch()} />
        )}
      </FadeInView>

      <FadeInView delay={entranceDelay(3)}>
        <Text style={styles.label}>{t('hqBook.purpose')}</Text>
        <View style={styles.chips}>
          {data.content.purposes.map((option) => (
            <Chip key={option} label={option} selected={option === purpose} onPress={() => setPurpose(option)} />
          ))}
        </View>
      </FadeInView>

      <FadeInView delay={entranceDelay(4)}>
        <FormField label={t('hqBook.note')} value={note} onChangeText={setNote} multiline placeholder={t('hqBook.notePlaceholder')} />
      </FadeInView>

      {submitError ? (
        <FadeInView offset={8}>
          {/* M109i: the complete-profile refusal comes with its own door to the editor. */}
          {gated ? <ProfileGateNotice text={submitError} /> : <Notice tone="warning" text={submitError} />}
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(5)}>
        <AppButton label={busy ? t('hqBook.sending') : t('hqBook.submit')} icon="calendar-outline" loading={busy} onPress={() => (busy ? null : void submit())} />
        <Text style={[styles.hint, styles.hintSpace]}>{data.content.rules[0] ?? ''}</Text>
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.subtitle, color: colors.gold, textAlign: textStart, marginBottom: spacing.sm },
  strip: { gap: spacing.xs, paddingVertical: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  hintSpace: { marginTop: spacing.md },
});

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { hqApi, useHq, useHqSlots, useHqWallet, type HqSpace } from '@/api/hq';
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
import { VoiceFill } from '@/components/VoiceFill';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate, formatHours, formatNumber, weekdayName } from '@/lib/format';
import { colors, fonts, spacing, typography } from '@/theme/tokens';

/** M109a: the booking kinds — a plain visit, or an hours-wallet space (مكتب خاص / قاعة اجتماعات). */
const KINDS: { key: 'visit' | HqSpace; label: StringKey }[] = [
  { key: 'visit', label: 'hqBook.kindVisit' },
  { key: 'office', label: 'hqBook.kindOffice' },
  { key: 'meeting', label: 'hqBook.kindMeeting' },
];

/**
 * Book an HQ visit or an hours-wallet space: day, time slot, duration (spaces), purpose (visits)
 * and a note. NOTHING confirms itself — the club decides, the pass follows, and only a confirmed
 * booking deducts from the member's annual hours wallet.
 */
export default function BookVisitScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const { data, isLoading, error, refetch } = useHq();
  const [kind, setKind] = useState<'visit' | HqSpace>('visit');
  const [hours, setHours] = useState(1);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const selectedDate = date ?? data?.days[0]?.date ?? null;
  const space: HqSpace | null = kind === 'visit' ? null : kind;
  const slots = useHqSlots(selectedDate, space, hours);
  // M109a: the live annual hours counter beside the space picker.
  const wallet = useHqWallet(status === 'signedIn' && data?.access === 'member');
  const walletTotal = wallet.data?.wallet.total ?? data?.content.walletHours ?? 24;
  const remaining = wallet.data?.wallet.remaining ?? walletTotal;
  const durations = Array.from({ length: Math.max(0, Math.min(remaining, 12)) }, (_, index) => index + 1);

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
    if (!selectedDate || !time || (!space && !purpose)) {
      setSubmitError(t(space ? 'hqBook.incompleteSpace' : 'hqBook.incomplete'));
      return;
    }
    setBusy(true);
    setSubmitError(null);
    setGated(false);
    try {
      // The server names the booking after its space; the picked purpose is for plain visits.
      await hqApi.book({ date: selectedDate, time, purpose: space ? '' : (purpose ?? ''), note, ...(space ? { space, hours } : {}) });
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
      {/* M142: kind, duration, purpose and note by voice; the day and the slot stay a tap. */}
      <VoiceFill
        fields={[
          { key: 'kind', label: t('hqBook.kind'), type: 'select', options: KINDS.map((item) => t(item.label)), required: true },
          { key: 'hours', label: t('hqBook.duration'), type: 'number' },
          { key: 'purpose', label: t('hqBook.purpose'), type: 'select', options: data.content.purposes },
          { key: 'note', label: t('hqBook.note'), type: 'textarea' },
        ]}
        values={{ kind: t(KINDS.find((item) => item.key === kind)?.label ?? 'hqBook.kindVisit'), hours: String(hours), purpose: purpose ?? '', note }}
        onFill={(values) => {
          const pickedKind = KINDS.find((item) => t(item.label) === values.kind)?.key;
          if (pickedKind && pickedKind !== kind) {
            setKind(pickedKind);
            setTime(null);
          }
          const pickedHours = Number(values.hours);
          if (Number.isInteger(pickedHours) && durations.includes(pickedHours) && pickedHours !== hours) {
            setHours(pickedHours);
            setTime(null);
          }
          if (values.purpose && data.content.purposes.includes(values.purpose)) setPurpose(values.purpose);
          setNote(values.note ?? note);
        }}
      />
      {/* M109a: what is being booked — a visit, or one of the hours-wallet spaces. */}
      <FadeInView delay={entranceDelay(0)}>
        <Text style={styles.label}>{t('hqBook.kind')}</Text>
        <View style={styles.chips}>
          {KINDS.map((option) => (
            <Chip
              key={option.key}
              label={t(option.label)}
              selected={kind === option.key}
              onPress={() => {
                setKind(option.key);
                setTime(null);
                setHours(1);
              }}
            />
          ))}
        </View>
        {space ? (
          <View style={styles.walletBox}>
            <Text style={styles.walletLine}>{t('hq.walletLine', { left: formatNumber(remaining), total: formatNumber(walletTotal) })}</Text>
            <Text style={styles.walletHint}>{t('hqBook.walletHint')}</Text>
            {remaining === 0 ? <Notice tone="warning" text={t('hqBook.walletEmpty')} /> : null}
          </View>
        ) : null}
      </FadeInView>

      {space && durations.length ? (
        <FadeInView delay={entranceDelay(1)}>
          <Text style={styles.label}>{t('hqBook.duration')}</Text>
          <View style={styles.chips}>
            {durations.map((option) => (
              <Chip
                key={option}
                label={formatHours(option)}
                selected={hours === option}
                onPress={() => {
                  setHours(option);
                  setTime(null);
                }}
              />
            ))}
          </View>
        </FadeInView>
      ) : null}

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

      {!space ? (
        <FadeInView delay={entranceDelay(3)}>
          <Text style={styles.label}>{t('hqBook.purpose')}</Text>
          <View style={styles.chips}>
            {data.content.purposes.map((option) => (
              <Chip key={option} label={option} selected={option === purpose} onPress={() => setPurpose(option)} />
            ))}
          </View>
        </FadeInView>
      ) : null}

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
  // M109a: the live hours counter under the space picker.
  walletBox: { gap: spacing.xs, marginTop: spacing.sm },
  walletLine: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.goldLight, textAlign: textStart },
  walletHint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  hintSpace: { marginTop: spacing.md },
});

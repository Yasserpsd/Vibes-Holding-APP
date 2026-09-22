import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { cardApi, usePrintRequest } from '@/api/card';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const PERSONA_KEY: Record<string, StringKey> = { neutral: 'persona.neutral', entrepreneur: 'persona.entrepreneur', investor: 'persona.investor' };

/** The category as printed on the card: the persona's first word, without its explainer half. */
function categoryOf(persona: string): string {
  const key = PERSONA_KEY[persona];
  return key ? (t(key).split('—')[0] ?? '').trim() : '';
}

/**
 * M30: «كارت العضوية» — a real-looking membership card in gold on black: club name, the member's
 * name, category and job title, the membership number, and the daily countdown of the days left.
 * Under it: the member's own request for a printed copy delivered to his door at no charge.
 */
export default function CardScreen() {
  const { me, status } = useAuth();
  const router = useRouter();

  if (status !== 'signedIn' || !me) {
    return (
      <Screen title={t('nav.card')}>
        <Stack.Screen options={{ title: t('nav.card') }} />
        <Notice tone="warning" text={t('card.guest')} />
        <AppButton label={t('card.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  const active = me.membership.status === 'active';
  const category = categoryOf(me.persona);

  return (
    <Screen title={t('nav.card')} subtitle={t('card.subtitle')}>
      <Stack.Screen options={{ title: t('nav.card') }} />

      <View style={styles.card}>
        <View style={styles.cardInner}>
          <View style={styles.head}>
            <View style={styles.logoBadge}>
              <Image source={require('../../assets/images/club-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.club} numberOfLines={1}>{t('common.clubName')}</Text>
              <Text style={styles.clubEn} numberOfLines={1}>{t('card.clubEn')}</Text>
            </View>
          </View>

          {me.cardNumber ? (
            <View style={styles.numberBlock}>
              <Text style={styles.numberLabel}>{t('card.numberLabel')}</Text>
              <Text style={styles.number}>{me.cardNumber}</Text>
            </View>
          ) : null}

          <View style={styles.holder}>
            <View style={styles.holderMain}>
              <Text style={styles.holderLabel}>{t('card.member')}</Text>
              <Text style={styles.holderName} numberOfLines={1}>{me.name}</Text>
              {me.jobTitle ? <Text style={styles.holderJob} numberOfLines={1}>{me.jobTitle}</Text> : null}
            </View>
            {category ? (
              <View style={styles.categoryPill}>
                <Text style={styles.categoryText}>{category}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.footer}>
            {active && me.membership.daysLeft !== null ? (
              <View style={styles.daysChip}>
                <Ionicons name="hourglass-outline" size={14} color={colors.gold} />
                <Text style={styles.daysText}>{t('card.daysLeft', { days: me.membership.daysLeft })}</Text>
              </View>
            ) : (
              <Text style={styles.inactive}>{me.membership.status === 'expired' ? t('card.expired') : t('card.notActive')}</Text>
            )}
          </View>
        </View>
      </View>

      {active ? <Text style={styles.hint}>{t('card.daysCountdown')}</Text> : <AppButton label={t('card.activate')} icon="ribbon-outline" onPress={() => router.push('/membership')} />}

      <PrintBlock active={active} />
    </Screen>
  );
}

/** The printed copy: the member himself asks, the club delivers to his address at no charge. */
function PrintBlock({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = usePrintRequest(active);
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const pending = data?.request?.status === 'pending';

  const submit = async () => {
    setError(null);
    if (city.trim().length < 2) {
      setError(t('card.needCity'));
      return;
    }
    if (address.trim().length < 5) {
      setError(t('card.needAddress'));
      return;
    }
    setBusy(true);
    try {
      await cardApi.requestPrint({ city: city.trim(), address: address.trim(), phone: phone.trim() || undefined, note: note.trim() || undefined });
      await queryClient.invalidateQueries({ queryKey: ['card'] });
      setSent(true);
      setOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.print}>
      <Text style={styles.printTitle}>{t('card.printTitle')}</Text>
      <Text style={styles.printText}>{t('card.printText')}</Text>
      {!active ? (
        <Text style={styles.hint}>{t('card.printMembersOnly')}</Text>
      ) : sent ? (
        <Notice tone="success" text={t('card.sent')} />
      ) : pending ? (
        <Notice tone="success" text={t('card.printPending')} />
      ) : open ? (
        <View style={styles.form}>
          <FormField label={t('card.city')} value={city} onChangeText={setCity} maxLength={80} />
          <FormField label={t('card.address')} hint={t('card.addressHint')} value={address} onChangeText={setAddress} multiline maxLength={300} />
          <FormField label={t('card.phoneField')} value={phone} onChangeText={setPhone} latin keyboardType="phone-pad" maxLength={30} />
          <FormField label={t('card.noteField')} value={note} onChangeText={setNote} maxLength={300} />
          {error ? <Notice tone="warning" text={error} /> : null}
          <AppButton label={busy ? t('card.sending') : t('card.submit')} icon="paper-plane-outline" onPress={() => (busy ? null : void submit())} />
        </View>
      ) : (
        <AppButton label={t('card.printButton')} icon="print-outline" onPress={() => (isLoading ? null : setOpen(true))} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The card: gold on black, framed twice like a real premium card.
  card: { borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.gold, backgroundColor: colors.black, padding: 5 },
  cardInner: { borderRadius: radii.lg - 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.goldDark, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoBadge: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 34, height: 34 },
  headText: { flex: 1, gap: 2 },
  club: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.gold, textAlign: textStart },
  clubEn: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 14, color: colors.goldLight, letterSpacing: 3, textAlign: textStart, writingDirection: 'ltr' },
  numberBlock: { gap: 2 },
  numberLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: textStart, writingDirection: 'ltr', letterSpacing: 1 },
  number: { fontFamily: fonts.semiBold, fontSize: 24, lineHeight: 32, color: colors.textPrimary, textAlign: textStart, writingDirection: 'ltr', letterSpacing: 2 },
  holder: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  holderMain: { flex: 1, gap: 2 },
  holderLabel: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  holderName: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.textPrimary, textAlign: textStart },
  holderJob: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  categoryPill: { paddingVertical: 4, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.gold },
  categoryText: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18, color: colors.black },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.goldDark, paddingTop: spacing.sm },
  daysChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  daysText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.goldLight, textAlign: textStart },
  inactive: { ...typography.caption, color: colors.warning, textAlign: textStart },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  print: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  printTitle: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  printText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  form: { gap: spacing.sm },
});

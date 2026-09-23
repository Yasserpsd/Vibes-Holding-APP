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
import { FadeInView, Sheen, useCountUp } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const PERSONA_KEY: Record<string, StringKey> = { neutral: 'persona.neutral', entrepreneur: 'persona.entrepreneur', investor: 'persona.investor' };

/** The category as printed on the card: the persona's first word, without its explainer half. */
function categoryOf(persona: string): string {
  const key = PERSONA_KEY[persona];
  return key ? (t(key).split('—')[0] ?? '').trim() : '';
}

// Left-to-right mark: keeps a Latin or numeric value readable inside the Arabic line (Android RTL).
const LRM = '‎';

/**
 * M30: «كارت العضوية» — a gold business card on black: club name, the member's name with an
 * engraved-gold effect, his title, company and city, the membership number, the expiry date and
 * the daily countdown. Under it: the member's own request for a printed copy, at no charge.
 * Pure views and shadows (no gradient package: a new native module would break OTA updates).
 */
export default function CardScreen() {
  const { me, status } = useAuth();
  const router = useRouter();
  // M38: the countdown counts itself up, and a light band sweeps the gold now and then.
  const daysShown = useCountUp(me?.membership.daysLeft ?? 0);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);

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
  const endDate = me.membership.endDate ? formatArabicDate(me.membership.endDate) : null;
  const roleLine = [me.jobTitle, me.company].filter(Boolean).join(' · ');
  const contacts = [me.city, me.phone && `${LRM}${me.phone}`, me.email && `${LRM}${me.email}`].filter(Boolean) as string[];

  return (
    <Screen title={t('nav.card')} subtitle={t('card.subtitle')}>
      <Stack.Screen options={{ title: t('nav.card') }} />

      <FadeInView offset={18}>
      <View style={styles.card}>
        <View style={styles.cardInner} onLayout={(event) => setCardSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
          {/* The metal of the card: soft gold rings and a diagonal sheen, behind everything. */}
          <View pointerEvents="none" style={[styles.ring, styles.ringLarge]} />
          <View pointerEvents="none" style={[styles.ring, styles.ringSmall]} />
          <View pointerEvents="none" style={styles.sheen} />
          <View pointerEvents="none" style={[styles.corner, styles.cornerTopStart]} />
          <View pointerEvents="none" style={[styles.corner, styles.cornerBottomEnd]} />

          <View style={styles.head}>
            <View style={styles.logoBadge}>
              <Image source={require('../../assets/images/club-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
            </View>
            <View style={styles.headText}>
              <Text style={styles.club} numberOfLines={1}>{t('common.clubName')}</Text>
              <Text style={styles.clubEn} numberOfLines={1}>{t('card.clubEn')}</Text>
            </View>
            {category ? (
              <View style={styles.categoryPill}>
                <Text style={styles.categoryText}>{category}</Text>
              </View>
            ) : null}
          </View>

          <GoldRule />

          <View style={styles.holder}>
            <Text style={styles.holderName} numberOfLines={1} adjustsFontSizeToFit>
              {me.name}
            </Text>
            {roleLine ? <Text style={styles.holderRole} numberOfLines={1}>{roleLine}</Text> : null}
          </View>

          {me.cardNumber ? (
            <View style={styles.numberBlock}>
              <Text style={styles.numberLabel}>{t('card.numberLabel')}</Text>
              <Text style={styles.number}>{me.cardNumber}</Text>
            </View>
          ) : null}

          <View style={styles.footer}>
            {active && endDate ? (
              <View style={styles.cell}>
                <Text style={styles.cellLabel}>{t('card.validThru')}</Text>
                <Text style={styles.cellValue}>{endDate}</Text>
              </View>
            ) : null}
            {active && me.membership.daysLeft !== null ? (
              <View style={styles.cell}>
                <Text style={styles.cellLabel}>{t('card.daysLabel')}</Text>
                <View style={styles.daysRow}>
                  <Ionicons name="hourglass-outline" size={13} color={colors.gold} />
                  <Text style={styles.cellValue}>{t('card.daysValue', { days: daysShown })}</Text>
                </View>
              </View>
            ) : null}
            {!active ? <Text style={styles.inactive}>{me.membership.status === 'expired' ? t('card.expired') : t('card.notActive')}</Text> : null}
          </View>

          {contacts.length ? (
            <View style={styles.contacts}>
              {contacts.map((entry) => (
                <Text key={entry} style={styles.contact} numberOfLines={1}>
                  {entry}
                </Text>
              ))}
            </View>
          ) : null}

          {cardSize ? <Sheen width={cardSize.width} height={cardSize.height} /> : null}
        </View>
      </View>
      </FadeInView>

      {active ? <Text style={styles.hint}>{t('card.daysCountdown')}</Text> : <AppButton label={t('card.activate')} icon="ribbon-outline" onPress={() => router.push('/membership')} />}

      <PrintBlock active={active} />
    </Screen>
  );
}

/** A thin metallic divider: dark gold melting into bright gold and back. */
function GoldRule() {
  return (
    <View style={styles.rule}>
      <View style={[styles.ruleStep, { backgroundColor: colors.goldDark, flex: 2 }]} />
      <View style={[styles.ruleStep, { backgroundColor: colors.gold, flex: 3 }]} />
      <View style={[styles.ruleStep, { backgroundColor: colors.goldLight, flex: 2 }]} />
      <View style={[styles.ruleStep, { backgroundColor: colors.gold, flex: 3 }]} />
      <View style={[styles.ruleStep, { backgroundColor: colors.goldDark, flex: 2 }]} />
    </View>
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

const CARD_BLACK = '#0B0A08';

const styles = StyleSheet.create({
  // The card: a gold slab on black — double gold frame, deep warm black, a gold glow around it.
  card: {
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: colors.black,
    padding: 5,
    shadowColor: colors.gold,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  cardInner: {
    borderRadius: radii.lg - 5,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: CARD_BLACK,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.md + 2,
    gap: spacing.md,
    overflow: 'hidden',
  },
  // Engraved gold circles, barely there, like guilloché on a bank card.
  ring: { position: 'absolute', borderColor: colors.gold, opacity: 0.09 },
  ringLarge: { width: 230, height: 230, borderRadius: 115, borderWidth: 22, top: -95, start: -85 },
  ringSmall: { width: 130, height: 130, borderRadius: 65, borderWidth: 12, bottom: -55, end: -45 },
  // A diagonal sheen band across the metal.
  sheen: { position: 'absolute', width: 520, height: 74, backgroundColor: colors.goldLight, opacity: 0.05, top: 26, start: -120, transform: [{ rotate: '-16deg' }] },
  // Thin corner accents.
  corner: { position: 'absolute', width: 26, height: 26, borderColor: colors.gold, opacity: 0.75 },
  cornerTopStart: { top: 10, start: 10, borderTopWidth: 1.5, borderStartWidth: 1.5, borderTopStartRadius: 8 },
  cornerBottomEnd: { bottom: 10, end: 10, borderBottomWidth: 1.5, borderEndWidth: 1.5, borderBottomEndRadius: 8 },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  logoBadge: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 32, height: 32 },
  headText: { flex: 1, gap: 1 },
  club: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.gold, textAlign: textStart },
  clubEn: { fontFamily: fonts.medium, fontSize: 9, lineHeight: 13, color: colors.goldLight, letterSpacing: 3.5, textAlign: textStart, writingDirection: 'ltr', opacity: 0.9 },
  categoryPill: { paddingVertical: 3, paddingHorizontal: spacing.sm + 2, borderRadius: radii.pill, backgroundColor: colors.gold },
  categoryText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 17, color: colors.black },

  rule: { flexDirection: 'row', alignItems: 'center', height: 2, borderRadius: 1, overflow: 'hidden' },
  ruleStep: { height: 2 },

  holder: { gap: 2, paddingVertical: 2 },
  // The name in raised gold: bright gold letters lifted off the black by a soft dark drop.
  holderName: {
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 38,
    color: colors.goldLight,
    letterSpacing: 0.4,
    textAlign: textStart,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 4,
  },
  holderRole: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.textSecondary, textAlign: textStart },

  numberBlock: { gap: 1 },
  numberLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 15, color: colors.textMuted, textAlign: textStart, writingDirection: 'ltr', letterSpacing: 1.5 },
  number: {
    fontFamily: fonts.semiBold,
    fontSize: 22,
    lineHeight: 30,
    color: colors.gold,
    textAlign: textStart,
    writingDirection: 'ltr',
    letterSpacing: 3,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },

  footer: { flexDirection: 'row', gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.goldDark, paddingTop: spacing.sm + 2 },
  cell: { flex: 1, gap: 2 },
  cellLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: textStart },
  cellValue: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 21, color: colors.goldLight, textAlign: textStart },
  daysRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inactive: { ...typography.caption, color: colors.warning, textAlign: textStart },

  contacts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2 },
  contact: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, color: colors.textSecondary, textAlign: textStart, flexShrink: 1 },

  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  print: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  printTitle: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  printText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  form: { gap: spacing.sm },
});

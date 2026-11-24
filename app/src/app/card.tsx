import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { displayProfile, useAuthConfig } from '@/api/auth';
import { cardApi, usePrintRequest, walletApi, type CardDeliveryMethod } from '@/api/card';
import { ApiError } from '@/api/client';
import { usePartners } from '@/api/partners';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { GlassCard, NeonPulse } from '@/components/lux';
import { entranceDelay, FadeInView, Sheen, useCountUp } from '@/components/motion';
import { cardGlow, cardKindOf, cardLook, PARTNERS_LOGO, type CardKind } from '@/components/membershipLook';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { VoiceFill } from '@/components/VoiceFill';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type PrintField = 'city' | 'address' | 'phone' | 'note';
const PRINT_ORDER: PrintField[] = ['city', 'address', 'phone', 'note'];

const PERSONA_KEY: Record<string, StringKey> = { neutral: 'persona.neutral', entrepreneur: 'persona.entrepreneur', investor: 'persona.investor' };

/** The category as printed on the card: the persona's first word, without its explainer half. */
function categoryOf(persona: string): string {
  const key = PERSONA_KEY[persona];
  return key ? (t(key).split('—')[0] ?? '').trim() : '';
}

// The line under the card, per kind (an unactivated card shows the activation button instead).
const HINT: Record<CardKind, StringKey> = { annual: 'card.daysCountdown', partner: 'card.partnerHint', honorary: 'card.honoraryHint', inactive: 'card.daysCountdown' };

// Left-to-right mark: keeps a Latin or numeric value readable inside the Arabic line (Android RTL).
const LRM = '‎';

/**
 * M30: «كارت العضوية» — a business card in the colour of the membership (M271, components/membershipLook.ts): club
 * name, the member's name with an engraved effect, his title, company and city, the membership number, the expiry date and
 * the daily countdown. Under it: the member's own request for a printed copy, at no charge.
 * Pure views and shadows (no gradient package: a new native module would break OTA updates).
 */
export default function CardScreen() {
  const { me, status } = useAuth();
  const router = useRouter();
  // M38: the countdown counts itself up, and a light band sweeps the gold now and then.
  const daysShown = useCountUp(me?.membership.daysLeft ?? 0);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  // M68: the member's partners promo code, printed on the card beside the membership number.
  const partners = usePartners();
  const promoCode = partners.data?.promo?.code ?? null;
  // M267: the wallet this phone has (iPhone: Apple, Android: Google), offered only where the server holds the credentials.
  const { data: authConfig } = useAuthConfig();
  const walletFor = Platform.OS === 'ios' ? (authConfig?.walletApple ? 'apple' : null) : Platform.OS === 'android' ? (authConfig?.walletGoogle ? 'google' : null) : null;

  // The account is still being read from the device: no «sign in» prompt for a signed-in member.
  if (status === 'loading') {
    return (
      <Screen title={t('nav.card')}>
        <Stack.Screen options={{ title: t('nav.card') }} />
        <StateView loading />
      </Screen>
    );
  }
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
  // M205: «عضوية شرفية» — no expiry date and no countdown on the card, its own line instead.
  const honorary = active && me.membership.kind === 'honorary';
  const category = categoryOf(me.persona);
  const endDate = me.membership.endDate ? formatArabicDate(me.membership.endDate) : null;
  // M109e: the English card shows the member's own data in English too (name transliterated).
  const holder = displayProfile(me);
  const roleLine = [holder.jobTitle, holder.company].filter(Boolean).join(' · ');
  const contacts = [holder.city, me.phone && `${LRM}${me.phone}`, me.email && `${LRM}${me.email}`].filter(Boolean) as string[];
  // M103 + M271: one layout, a colour per membership; faded silver without an active one.
  const kind = cardKindOf(me.membership);
  const look = cardLook(kind);
  const partner = kind === 'partner';
  const gold = kind === 'annual';
  const glow = cardGlow(kind);
  const ink = { textShadowColor: look.textShadow };
  // On the pearl card the lettering is pressed, not lifted: a soft white edge instead of a dark drop.
  const press = kind === 'honorary' ? { textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 } : null;

  return (
    <Screen title={t('nav.card')} subtitle={t('card.subtitle')}>
      <Stack.Screen options={{ title: t('nav.card') }} />

      {/* Keyed by the kind: the cards differ in structure, and a view must never change shape in place (Android). */}
      <FadeInView key={kind} offset={18}>
      <View style={[styles.card, { backgroundColor: look.shell, borderColor: look.frame, boxShadow: glow }, !active && styles.cardFaded]}>
        {/* V2: the card frame breathes a neon halo, in the card's own colour, only while the membership is active. */}
        {active ? <NeonPulse radius={radii.lg} intensity="strong" color={gold ? undefined : look.frame} halo={gold ? undefined : glow} /> : null}
        <View style={[styles.cardInner, { borderColor: look.edge, backgroundColor: look.face, experimental_backgroundImage: look.image }]} onLayout={(event) => setCardSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
          {/* The material of the card: soft rings and a diagonal sheen, behind everything. */}
          <View pointerEvents="none" style={[styles.ring, styles.ringLarge, { borderColor: look.body, opacity: look.ringOpacity }]} />
          <View pointerEvents="none" style={[styles.ring, styles.ringSmall, { borderColor: look.body, opacity: look.ringOpacity }]} />
          <View pointerEvents="none" style={[styles.sheen, { backgroundColor: look.sheen }]} />
          <View pointerEvents="none" style={[styles.corner, styles.cornerTopStart, { borderColor: partner ? look.accent : look.frame }]} />
          <View pointerEvents="none" style={[styles.corner, styles.cornerBottomEnd, { borderColor: partner ? look.accent : look.frame }]} />

          <View style={styles.head}>
            <View style={[styles.logoBadge, { borderColor: look.frame, backgroundColor: look.disc }]}>
              <Image source={require('../../assets/images/club-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
            </View>
            {partner ? (
              // M271 (owner): the Success Partners logo beside the club emblem, on white so its own colours stay.
              <View style={styles.headText}>
                <View style={styles.partnerPlate}>
                  <Image source={PARTNERS_LOGO} style={styles.partnerLogo} resizeMode="contain" accessibilityLabel={t('card.partnerLogo')} />
                </View>
              </View>
            ) : (
              /* The club's name once: since it became Latin «Investors Club» in both languages (2026-10-21), the
                 spaced-capitals line under it repeated the same two words. */
              <View style={styles.headText}>
                <Text style={[styles.club, { color: look.body }]} numberOfLines={1}>{t('common.clubName')}</Text>
              </View>
            )}
            {/* M103: the member's standing, loud and unmistakable — VIP in the card's metal, or the quiet silver tag. */}
            {active ? (
              <View style={[styles.vipBadge, { backgroundColor: look.pill, experimental_backgroundImage: look.pillImage, boxShadow: partner ? '0 0 16px rgba(247, 143, 52, 0.45)' : shadows.glowGold }]}>
                <Ionicons name="diamond" size={11} color={look.pillInk} />
                <Text style={[styles.vipText, { color: look.pillInk }]} numberOfLines={1}>VIP</Text>
              </View>
            ) : (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText} numberOfLines={1}>{t('card.notActiveBadge')}</Text>
              </View>
            )}
          </View>

          {partner ? (
            <View style={styles.typeRow}>
              <Text style={[styles.typeClub, { color: look.strong }]} numberOfLines={1}>{t('common.clubName')}</Text>
              <View style={[styles.typeDot, { backgroundColor: look.accent }]} />
              <Text style={[styles.typeName, { color: look.accent }]} numberOfLines={1}>{t('membership.partner')}</Text>
            </View>
          ) : null}

          <MetalRule tones={look.rule} />

          <View style={styles.holder}>
            <Text style={[styles.holderName, { color: look.strong }, ink, press]} numberOfLines={2}>
              {holder.name}
            </Text>
            <View style={styles.holderMetaRow}>
              {category ? (
                <View style={[styles.categoryPill, { backgroundColor: look.pill }]}>
                  <Text style={[styles.categoryText, { color: look.pillInk }]} numberOfLines={1}>{category}</Text>
                </View>
              ) : null}
              {roleLine ? <Text style={[styles.holderRole, { color: look.soft }]} numberOfLines={1}>{roleLine}</Text> : null}
            </View>
          </View>

          {me.cardNumber || (active && promoCode) ? (
            <View style={styles.numberRow}>
              {me.cardNumber ? (
                <View style={[styles.numberBlock, styles.numberCell]}>
                  <Text style={[styles.numberLabel, { color: look.label }]}>{t('card.numberLabel')}</Text>
                  <Text style={[styles.number, { color: look.body }, ink, press]}>{me.cardNumber}</Text>
                </View>
              ) : null}
              {active && promoCode ? (
                <View style={styles.numberBlock}>
                  <Text style={[styles.numberLabel, { color: look.label }]}>{t('card.promoLabel')}</Text>
                  <Text style={[styles.number, { color: look.body }, ink, press]} selectable>{promoCode}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.footer, { borderTopColor: look.edge }]}>
            {honorary ? (
              <View style={styles.cell}>
                <Text style={[styles.cellLabel, { color: look.label }]}>{t('card.typeLabel')}</Text>
                <Text style={[styles.cellValue, { color: look.strong }]}>{t('membership.honorary')}</Text>
              </View>
            ) : null}
            {active && endDate && !honorary ? (
              <View style={styles.cell}>
                <Text style={[styles.cellLabel, { color: look.label }]}>{t('card.validThru')}</Text>
                <Text style={[styles.cellValue, { color: look.strong }]}>{endDate}</Text>
              </View>
            ) : null}
            {active && me.membership.daysLeft !== null && !honorary ? (
              <View style={styles.cell}>
                <Text style={[styles.cellLabel, { color: look.label }]}>{t('card.daysLabel')}</Text>
                <View style={styles.daysRow}>
                  <Ionicons name="hourglass-outline" size={13} color={look.accent} />
                  <Text style={[styles.cellValue, { color: look.strong }]}>{t('card.daysValue', { days: daysShown })}</Text>
                </View>
              </View>
            ) : null}
            {!active ? <Text style={[styles.inactive, { color: look.strong }]}>{me.membership.status === 'expired' ? t('card.expired') : t('card.notActive')}</Text> : null}
          </View>

          {contacts.length ? (
            <View style={styles.contacts}>
              {contacts.map((entry) => (
                <Text key={entry} style={[styles.contact, { color: look.soft }]} numberOfLines={1}>
                  {entry}
                </Text>
              ))}
            </View>
          ) : null}

          {cardSize ? <Sheen width={cardSize.width} height={cardSize.height} color={look.sweep} /> : null}
        </View>
      </View>
      </FadeInView>

      <FadeInView delay={entranceDelay(1)}>
        {active ? <Text style={styles.hint}>{t(HINT[kind])}</Text> : <AppButton label={t('card.activate')} icon="ribbon-outline" onPress={() => router.push('/membership')} />}
      </FadeInView>

      {active && walletFor ? (
        <FadeInView delay={entranceDelay(2)}>
          <WalletButton wallet={walletFor} />
        </FadeInView>
      ) : null}

      {active && promoCode ? (
        <FadeInView delay={entranceDelay(2)}>
          <AppButton label={t('card.partnersLink')} variant="outline" icon="pricetags-outline" onPress={() => router.push('/partners' as Href)} />
        </FadeInView>
      ) : null}

      <FadeInView delay={entranceDelay(3)}>
        <PrintBlock active={active} />
      </FadeInView>
    </Screen>
  );
}

/**
 * M267: «أضف إلى المحفظة» — asks the server for the member's pass address and hands it to the system (Safari adds an
 * Apple Wallet pass, Chrome opens Google's «Save to Google Wallet» page). Plain Linking: no native module.
 */
function WalletButton({ wallet }: { wallet: 'apple' | 'google' }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const open = async () => {
    if (busy) return;
    setFailure(null);
    setBusy(true);
    try {
      const { url } = await (wallet === 'apple' ? walletApi.appleLink() : walletApi.googleLink());
      await Linking.openURL(url);
    } catch (cause) {
      // A refusal of the server speaks for itself (403 before the membership is active); a phone that cannot open the address gets the plain sentence.
      setFailure(cause instanceof ApiError ? failureOf(cause) : { message: t('card.walletFailed'), code: 'unexpected' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.wallet}>
      <FormFailure failure={failure} onRetry={() => void open()} />
      <AppButton label={t('card.addToWallet')} icon="wallet-outline" variant="outline" loading={busy} onPress={() => void open()} />
    </View>
  );
}

/** A thin metallic divider: the dark tone melting into the bright one and back, in the card's colour. */
function MetalRule({ tones }: { tones: readonly string[] }) {
  return (
    <View style={styles.rule}>
      {tones.map((tone, index) => (
        <View key={index} style={[styles.ruleStep, { backgroundColor: tone, flex: index % 2 ? 3 : 2 }]} />
      ))}
    </View>
  );
}

/**
 * The printed copy (M162, owner): the member picks it up at the HQ without fees — the default — or asks
 * for delivery to his address, which carries shipping fees by region that the management quotes first.
 */
function PrintBlock({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = usePrintRequest(active);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<CardDeliveryMethod>('pickup');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // M255: a problem with the city or the address sits under that field; anything else sits by the button with its way out.
  const [failure, setFailure] = useState<Failure | null>(null);
  const marks = useFormErrors<PrintField>();
  const [sent, setSent] = useState(false);

  const [confirming, setConfirming] = useState(false);

  // M163 (owner): the screen remembers the member's request — in flight, delivered (with his own receipt mark) or
  // declined — instead of offering the button again as if nothing had happened.
  const request = data?.request ?? null;
  const inFlight = request?.status === 'pending' || request?.status === 'in_progress';
  const delivered = request?.status === 'done';
  const declined = request?.status === 'rejected';

  const submit = async () => {
    setFailure(null);
    const found: Partial<Record<PrintField, string>> = {};
    if (method === 'delivery' && city.trim().length < 2) found.city = t('card.needCity');
    if (method === 'delivery' && address.trim().length < 5) found.address = t('card.needAddress');
    if (marks.fail(found, PRINT_ORDER)) return;
    setBusy(true);
    try {
      await cardApi.requestPrint({ method, city: method === 'delivery' ? city.trim() : undefined, address: method === 'delivery' ? address.trim() : undefined, phone: phone.trim() || undefined, note: note.trim() || undefined });
      await queryClient.invalidateQueries({ queryKey: ['card'] });
      setSent(true);
      setOpen(false);
    } catch (cause) {
      if (!marks.fromServer(cause, PRINT_ORDER).length) setFailure(failureOf(cause));
    } finally {
      setBusy(false);
    }
  };

  /** The member holds the card now (picked up at the HQ or delivered): the request closes from his side. */
  const confirmReceived = async () => {
    if (!request) return;
    setFailure(null);
    setConfirming(true);
    try {
      await cardApi.confirmReceived(request.id);
      await queryClient.invalidateQueries({ queryKey: ['card'] });
    } catch (cause) {
      setFailure(failureOf(cause));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <GlassCard style={styles.print}>
      <Text style={styles.printTitle}>{t('card.printTitle')}</Text>
      <Text style={styles.printText}>{t('card.printText')}</Text>
      {/* M162 (owner): say it loud — pickup at the HQ costs nothing; home delivery carries shipping fees by region. */}
      <View style={styles.printFreeRow}>
        <Ionicons name="business-outline" size={16} color={colors.goldText} />
        <Text style={styles.printFree}>{t('card.printFree')}</Text>
      </View>
      {!active ? (
        <Text style={styles.hint}>{t('card.printMembersOnly')}</Text>
      ) : sent ? (
        <FadeInView offset={8}>
          <Notice tone="success" text={t(method === 'pickup' ? 'card.sentPickup' : 'card.sentDelivery')} />
        </FadeInView>
      ) : request && inFlight ? (
        <View style={styles.statusBox}>
          <View style={styles.statusHead}>
            <Ionicons name={request.status === 'in_progress' ? 'print-outline' : 'time-outline'} size={18} color={colors.gold} />
            <Text style={styles.statusTitle}>{t(request.status === 'in_progress' ? 'card.status.inProgress' : 'card.status.pending')}</Text>
          </View>
          <Text style={styles.statusLine}>
            {t('card.status.requestedOn', { date: formatArabicDate(request.createdAt) })} · {t(request.method === 'pickup' ? 'card.status.pickup' : 'card.status.delivery')}
          </Text>
          <Text style={styles.statusLine}>{t(request.method === 'pickup' ? 'card.pendingPickup' : 'card.printPending')}</Text>
          <Text style={styles.hint}>{t('card.receivedHint')}</Text>
          <FormFailure failure={failure} onRetry={() => void confirmReceived()} />
          <AppButton label={confirming ? t('card.sending') : t('card.receivedButton')} icon="checkmark-circle-outline" variant="outline" loading={confirming} onPress={() => (confirming ? null : void confirmReceived())} />
        </View>
      ) : open ? (
        <FadeInView offset={12} style={styles.form}>
          {delivered || declined ? <Text style={styles.methodNote}>{t('card.replacementNote')}</Text> : null}
          <View style={styles.methodRow} accessibilityRole="tablist">
            <Chip label={t('card.method.pickup')} selected={method === 'pickup'} onPress={() => setMethod('pickup')} />
            <Chip label={t('card.method.delivery')} selected={method === 'delivery'} onPress={() => setMethod('delivery')} />
          </View>
          <Text style={styles.methodNote}>{t(method === 'pickup' ? 'card.pickupInfo' : 'card.deliveryFee')}</Text>
          {method === 'delivery' ? (
            <>
              <VoiceFill
                fields={[
                  { key: 'city', label: t('card.city'), type: 'text', required: true },
                  { key: 'address', label: t('card.address'), type: 'textarea', required: true, hint: t('card.addressHint') },
                  { key: 'phone', label: t('card.phoneField'), type: 'phone' },
                  { key: 'note', label: t('card.noteField'), type: 'text' },
                ]}
                values={{ city, address, phone, note }}
                onFill={(values) => {
                  setCity(values.city ?? city);
                  setAddress(values.address ?? address);
                  setPhone(values.phone ?? phone);
                  setNote(values.note ?? note);
                }}
              />
              <FormField
                label={t('card.city')}
                value={city}
                onChangeText={(value) => {
                  setCity(value);
                  marks.clear('city');
                }}
                maxLength={80}
                error={marks.errors.city}
              />
              <FormField
                label={t('card.address')}
                hint={t('card.addressHint')}
                value={address}
                onChangeText={(value) => {
                  setAddress(value);
                  marks.clear('address');
                }}
                multiline
                maxLength={300}
                error={marks.errors.address}
              />
            </>
          ) : null}
          <FormField
            label={t('card.phoneField')}
            value={phone}
            onChangeText={(value) => {
              setPhone(value);
              marks.clear('phone');
            }}
            latin
            keyboardType="phone-pad"
            maxLength={30}
            error={marks.errors.phone}
          />
          <FormField
            label={t('card.noteField')}
            value={note}
            onChangeText={(value) => {
              setNote(value);
              marks.clear('note');
            }}
            maxLength={300}
            error={marks.errors.note}
          />
          <FormFailure failure={failure} onRetry={() => void submit()} />
          <AppButton label={busy ? t('card.sending') : t('card.submit')} icon="paper-plane-outline" loading={busy} onPress={() => (busy ? null : void submit())} />
        </FadeInView>
      ) : request && delivered ? (
        <View style={styles.statusBox}>
          <View style={styles.statusHead}>
            <Ionicons name="checkmark-done-outline" size={18} color={colors.gold} />
            <Text style={styles.statusTitle}>{t('card.status.done')}</Text>
          </View>
          <Text style={styles.statusLine}>
            {t('card.status.deliveredOn', { date: formatArabicDate(request.doneAt ?? request.createdAt) })}
            {request.memberConfirmedAt ? ` ${t('card.status.confirmedByYou')}` : ''}
          </Text>
          <Text style={styles.lostTitle}>{t('card.lostTitle')}</Text>
          <Text style={styles.hint}>{t('card.lostText')}</Text>
          <AppButton label={t('card.replacementButton')} icon="copy-outline" variant="outline" onPress={() => setOpen(true)} />
        </View>
      ) : request && declined ? (
        <View style={styles.statusBox}>
          <View style={styles.statusHead}>
            <Ionicons name="close-circle-outline" size={18} color={colors.gold} />
            <Text style={styles.statusTitle}>{t('card.status.rejected')}</Text>
          </View>
          <Text style={styles.statusLine}>{t('card.status.rejectedText')}</Text>
          <AppButton label={t('card.printButton')} icon="print-outline" variant="outline" onPress={() => setOpen(true)} />
        </View>
      ) : (
        <AppButton label={t('card.printButton')} icon="print-outline" onPress={() => (isLoading ? null : setOpen(true))} />
      )}
    </GlassCard>
  );
}

const styles = themedStyles(() => ({
  // The card: a double frame and a halo; its colours come from components/membershipLook.ts (fixed in both themes).
  card: {
    borderRadius: radii.lg,
    borderWidth: 2,
    padding: 5,
  },
  cardInner: {
    borderRadius: radii.lg - 5,
    borderWidth: 1,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.md + 2,
    gap: spacing.md,
    overflow: 'hidden',
  },
  // Engraved circles, barely there, like guilloché on a bank card.
  ring: { position: 'absolute' },
  ringLarge: { width: 230, height: 230, borderRadius: 115, borderWidth: 22, top: -95, start: -85 },
  ringSmall: { width: 130, height: 130, borderRadius: 65, borderWidth: 12, bottom: -55, end: -45 },
  // A diagonal sheen band across the face.
  sheen: { position: 'absolute', width: 520, height: 74, opacity: 0.05, top: 26, start: -120, transform: [{ rotate: '-16deg' }] },
  // Thin corner accents.
  corner: { position: 'absolute', width: 26, height: 26, opacity: 0.75 },
  cornerTopStart: { top: 10, start: 10, borderTopWidth: 1.5, borderStartWidth: 1.5, borderTopStartRadius: 8 },
  cornerBottomEnd: { bottom: 10, end: 10, borderBottomWidth: 1.5, borderEndWidth: 1.5, borderBottomEndRadius: 8 },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  logoBadge: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 32, height: 32 },
  headText: { flex: 1 },
  club: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, textAlign: textStart },
  // M271: the white plate of the Success Partners logo (900×250); it shrinks with a narrow phone.
  partnerPlate: { alignSelf: 'flex-start', width: '100%', maxWidth: 176, height: 46, borderRadius: radii.md, backgroundColor: '#FFFFFF', paddingHorizontal: spacing.sm, paddingVertical: 6, boxShadow: '0 4px 14px rgba(3, 12, 46, 0.35)' },
  partnerLogo: { width: '100%', height: '100%' },
  typeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  typeClub: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22 },
  typeDot: { width: 5, height: 5, borderRadius: 3 },
  typeName: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22, flexShrink: 1 },
  categoryPill: { paddingVertical: 3, paddingHorizontal: spacing.sm + 2, borderRadius: radii.pill },
  categoryText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 17 },
  // M103: the silvered, faded shell of the unactivated card.
  cardFaded: { opacity: 0.88 },
  // M103: the VIP mark — impossible to miss.
  vipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
  },
  vipText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 2, writingDirection: 'ltr' },
  inactiveBadge: {
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#787D88',
    backgroundColor: 'rgba(182, 186, 196, 0.16)',
  },
  inactiveBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, lineHeight: 16, color: '#E9EAEF' },
  holderMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },

  rule: { flexDirection: 'row', alignItems: 'center', height: 2, borderRadius: 1, overflow: 'hidden' },
  ruleStep: { height: 2 },

  holder: { gap: 2, paddingVertical: 2 },
  // The name in raised letters, lifted off the face by a soft drop.
  holderName: {
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 38,
    letterSpacing: 0.4,
    textAlign: textStart,
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 4,
  },
  holderRole: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, textAlign: textStart },

  numberRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  numberCell: { flex: 1 },
  // flexShrink: a long promo code must not squeeze the membership number out of the row on a narrow phone.
  numberBlock: { gap: 1, flexShrink: 1 },
  numberLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 15, textAlign: textStart, writingDirection: 'ltr', letterSpacing: 1.5 },
  number: {
    fontFamily: fonts.semiBold,
    fontSize: 22,
    lineHeight: 30,
    textAlign: textStart,
    writingDirection: 'ltr',
    letterSpacing: 3,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },

  footer: { flexDirection: 'row', gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm + 2 },
  cell: { flex: 1, gap: 2 },
  cellLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textAlign: textStart },
  cellValue: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 21, textAlign: textStart },
  daysRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // M103: the unactivated line reads clearly on the silver card.
  inactive: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22, textAlign: textStart },

  contacts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2 },
  contact: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, textAlign: textStart, flexShrink: 1 },

  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  wallet: { gap: spacing.sm },
  print: { gap: spacing.sm, padding: spacing.md },
  printTitle: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  printText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  printFreeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  printFree: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.goldText, textAlign: textStart, flex: 1 },
  form: { gap: spacing.sm },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  methodNote: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  // M163: the member's request as it stands — in flight, delivered, declined — with his own receipt button.
  statusBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderGold, backgroundColor: colors.surfaceElevated },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusTitle: { ...typography.body, fontFamily: fonts.semiBold, color: colors.goldLightText, textAlign: textStart },
  statusLine: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  lostTitle: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart, marginTop: spacing.xs },
}));

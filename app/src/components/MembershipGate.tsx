import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import { useStoreConfig } from '@/api/membership';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldGradient } from '@/components/lux';
import { Floating, PopIn, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { SarText } from '@/components/SarText';
import { StoreLegalLinks, storePriceLabel } from '@/components/StorePurchaseCard';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import {
  cachedMembershipOffer,
  hasStorePurchases,
  identifyPurchases,
  loadMembershipOffer,
  purchaseMembership,
  restoreMembership,
  storeKeyFor,
  storeName,
  type StoreOffer,
} from '@/lib/purchases';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M120 (owner's TestFlight feedback, 2026-10-23): the subscribe path. One popup, opened the moment
 * a non-member taps anything members-only — short title, one line, the store price and a direct
 * subscribe button (CLAUDE.md rule 3: the store sheet, activation only from the server).
 * M122b (owner, same week: «ولما أروح أفعّل العضوية أتحول على الدفع مباشر»): the subscribe button
 * goes straight to the store's payment sheet, fetching the offer on the spot when it is not cached yet.
 * M170 (owner, 2026-10-31, final word after the M122b launch nudge and the M164 weekly slot: «مش عايزها
 * تظهر خالص إلا لو العضو ضغط على خدمة مقفولة»): the popup NEVER opens by itself — no launch nudge,
 * no weekly timer. Every appearance is the member's own tap on something members-only.
 */

let openGate: (() => void) | null = null;

/** Opens the members-only popup from anywhere (locked tiles, lock notices, gates). */
export function showMembershipGate(): void {
  openGate?.();
}

// The first, quick round of asking the server after the store's answer (see StorePurchaseCard): when it ends
// without «active», AuthProvider's watcher goes on asking — the popup does not have to stay open for it.
const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 3000;
/** «جارٍ التفعيل» never traps the member: after this long the popup offers a Close button. */
const CLOSE_AFTER_MS = 10_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// `storePending`: a purchase is waiting — the store is still processing the payment (Android pending purchase), or
// the server has not activated yet; a calm wait, not a failure. `restoring` is its «استعادة المشتريات» at work.
type Phase = 'idle' | 'busy' | 'activating' | 'done' | 'pending' | 'storePending' | 'restoring';

/** The offer a component fetched, with the account it was fetched for: another account never reads it. */
type LoadedOffer = { contactId: number; offer: StoreOffer };

/** The members-only popup + the one-time post-registration nudge. Rendered once in the root layout. */
export function MembershipGateHost() {
  const router = useRouter();
  const { status, me, syncMembership, watchMembership, stopMembershipWatch, membershipPending, membershipPendingLong } = useAuth();
  const [visible, setVisible] = useState(false);
  const { data: config } = useStoreConfig(Boolean(me) && visible);
  const [loaded, setLoaded] = useState<LoadedOffer | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  // `run` names the server check in hand, `closeFor` the one whose ten seconds have passed.
  const [run, setRun] = useState(0);
  const [closeFor, setCloseFor] = useState<number | null>(null);

  // The popup lives for the whole launch. Nothing of one account's purchase — a check still running, a waiting
  // notice, an error — may be shown to the next account on this phone: its state starts again when the account
  // changes (adjusted while rendering, so the new account never sees a frame of the old state).
  const accountId = me?.id ?? null;
  const [stateOwner, setStateOwner] = useState(accountId);
  if (stateOwner !== accountId) {
    setStateOwner(accountId);
    setPhase('idle');
    setError(null);
    setCloseFor(null);
  }
  // The same for a check loop that is still running at that moment: it reads the account of NOW through this ref.
  const accountRef = useRef(accountId);
  useEffect(() => {
    accountRef.current = accountId;
  }, [accountId]);

  const signedIn = status === 'signedIn' && me !== null;
  const active = me?.membership.status === 'active';
  // This account's offer: the one fetched here, else the one the home card (or an earlier opening) fetched for it.
  const offer = me ? (loaded && loaded.contactId === me.id ? loaded.offer : config ? cachedMembershipOffer(config, me.id) : null) : null;

  /*
   * What the popup shows. Waiting is never sticky: the moment the account is active — this popup's own check, the
   * watcher, a push, a return to the app — the success notice shows. And while a purchase of this account still
   * waits for the server (this launch or an earlier one) the popup says so instead of offering Subscribe again —
   * for 30 minutes; after that the Subscribe button returns beside the notice (a purchase that never completed at
   * the store must not lock the member out of buying).
   */
  const view: Phase =
    active && (phase === 'activating' || phase === 'pending' || phase === 'storePending' || phase === 'restoring')
      ? 'done'
      : membershipPending && !membershipPendingLong && phase === 'idle'
        ? 'storePending'
        : phase;
  const offerClose = view === 'activating' && closeFor === run;

  useEffect(() => {
    openGate = () => {
      // A purchase in hand (the store sheet, the server check, a restore) is not thrown away by opening the popup again.
      setPhase((current) => (current === 'busy' || current === 'activating' || current === 'restoring' ? current : 'idle'));
      setError(null);
      setVisible(true);
    };
    return () => {
      openGate = null;
    };
  }, []);

  // The store price, fetched once the popup is open (and kept for this account for the whole launch). Keyed by the
  // account's id, not the account object: that object is replaced at every server check and must not refetch it.
  const contactId = signedIn ? me.id : null;
  useEffect(() => {
    if (!visible || contactId === null || !config || offer || !hasStorePurchases() || !storeKeyFor(config)) return;
    let alive = true;
    void loadMembershipOffer(config, contactId).then((found) => {
      if (alive && found) setLoaded({ contactId, offer: found });
    });
    return () => {
      alive = false;
    };
  }, [visible, contactId, config, offer]);

  const dismiss = () => {
    // The store sheet and a restore cannot be left half-way. «جارٍ التفعيل» can, once its Close is offered: the
    // server check and the watcher go on behind the closed popup.
    if (view === 'busy' || view === 'restoring' || (view === 'activating' && !offerClose)) return;
    setVisible(false);
  };
  const go = (path: '/membership' | '/auth/login') => {
    setVisible(false);
    router.push(path);
  };

  // The store said yes; only the server's answer activates (same contract as StorePurchaseCard).
  const settle = useCallback(async () => {
    const owner = accountRef.current;
    const id = Date.now();
    setRun(id);
    setPhase('activating');
    setTimeout(() => setCloseFor(id), CLOSE_AFTER_MS);
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      // null = server busy, offline or no answer within the cap: try again below.
      const account = await syncMembership();
      // The account changed while this round was still asking (a sign-out, another sign-in on this phone): the
      // purchase is not the new account's, and the popup has already started again for it.
      if (accountRef.current !== owner) return;
      if (account?.membership.status === 'active') {
        setPhase('done');
        return;
      }
      // An attempt that already took its time is not followed by another pause.
      if (Date.now() - started < SETTLE_DELAY_MS) await wait(SETTLE_DELAY_MS);
      if (accountRef.current !== owner) return;
    }
    setPhase('pending');
  }, [syncMembership]);

  // M122b (owner): the button goes STRAIGHT to the store's payment sheet. An offer not cached yet
  // is fetched on the spot; only a store this device truly cannot reach falls back to /membership.
  const buy = async () => {
    if (!config || !me || !hasStorePurchases() || !storeKeyFor(config)) {
      go('/membership');
      return;
    }
    setError(null);
    setPhase('busy');
    const memberId = me.id;
    let current = offer;
    if (!current) {
      current = await loadMembershipOffer(config, memberId);
      if (current) setLoaded({ contactId: memberId, offer: current });
    }
    // The store account is identified as THIS member right before every purchase. A kept offer used to skip it:
    // after a sign-out and sign-in in one launch the purchase reached the server under an anonymous store identity
    // and could never be matched to the member.
    if (!current || !(await identifyPurchases(config, memberId))) {
      setPhase('idle');
      go('/membership');
      return;
    }
    const result = await purchaseMembership(config, current);
    if (result.status === 'cancelled') return setPhase('idle');
    if (result.status === 'pending') {
      // The store is still processing the payment: a calm wait — no error, no second Subscribe while it shows —
      // and the app keeps asking the server until the payment completes and the membership is active.
      watchMembership();
      return setPhase('storePending');
    }
    if (result.status === 'failed') {
      setError(result.message);
      return setPhase('idle');
    }
    // The store took the payment: from here the app keeps asking the server until it says active, with the popup
    // open or closed, and across a restart (the watch is saved before the first check).
    watchMembership();
    await settle();
  };

  // «استعادة المشتريات» stays within reach while the waiting notice shows.
  const restore = async () => {
    if (!config || !me || view !== 'storePending') return;
    setError(null);
    setPhase('restoring');
    // After a restart the store account may not be identified yet in this launch.
    await identifyPurchases(config, me.id);
    const result = await restoreMembership(config);
    if ('error' in result) {
      setError(result.error);
      return setPhase('storePending');
    }
    if (!result.entitled) {
      // The store itself has nothing for this account (a deferred payment that expired or was cancelled): the
      // watch ends here, and the popup goes back to offering Subscribe instead of waiting for three days.
      stopMembershipWatch();
      setError(t('store.noPrevious', { store: storeName() }));
      return setPhase('idle');
    }
    watchMembership();
    await settle();
  };

  if (!visible) return null;
  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible={visible} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            {/* On a short screen the popup scrolls inside itself instead of running off the edges. */}
            <ScrollView contentContainerStyle={styles.cardBody} bounces={false} showsVerticalScrollIndicator={false}>
            <View style={styles.lockRing}>
              <Ionicons name="lock-closed" size={24} color={colors.goldInk} />
            </View>
            <Text style={styles.title}>{t('gate.popupTitle')}</Text>
            <Text style={styles.text}>{signedIn ? t('gate.popupText') : t('gate.popupGuest')}</Text>
            {view === 'done' ? (
              <>
                <Notice tone="success" text={t('store.done')} />
                <AppButton label={t('common.close')} icon="checkmark-outline" onPress={() => setVisible(false)} />
              </>
            ) : view === 'pending' ? (
              <>
                <Notice tone="warning" text={t('store.pending')} />
                <AppButton label={t('common.close')} variant="outline" onPress={() => setVisible(false)} />
              </>
            ) : view === 'storePending' || view === 'restoring' ? (
              <>
                <Notice text={t('store.pending')} />
                {error ? (<><Text style={styles.error}>{error}</Text><SupportLink problem={error} /></>) : null}
                <AppButton label={t('store.restore')} variant="outline" icon="refresh-outline" loading={view === 'restoring'} onPress={() => void restore()} />
                {/* More than 30 minutes of waiting (this popup stayed open, or a store-pending payment): Subscribe is back. */}
                {membershipPendingLong && view === 'storePending' ? <AppButton label={t('gate.activateNow')} icon="card-outline" onPress={() => void buy()} /> : null}
                <AppButton label={t('common.close')} variant="ghost" onPress={dismiss} />
              </>
            ) : (
              <>
                {/* A purchase that has waited more than 30 minutes: the waiting notice stays, and the price and the
                    Subscribe button are offered again under it. */}
                {membershipPending && view === 'idle' ? <Notice text={t('store.pending')} /> : null}
                {signedIn && offer ? (
                  <View style={styles.priceRow}>
                    <SarText style={styles.price}>{storePriceLabel(offer.product.priceString)}</SarText>
                    <Text style={styles.period}>{t('store.period', { store: storeName() })}</Text>
                  </View>
                ) : null}
                {/* The renewal terms and the Terms / Privacy links sit beside the button that opens the store sheet. */}
                {signedIn ? (
                  <>
                    <Text style={styles.legal}>{t('store.legal', { store: storeName() })}</Text>
                    {config ? <StoreLegalLinks config={config} onOpen={() => setVisible(false)} centered /> : null}
                  </>
                ) : null}
                {error ? (<><Text style={styles.error}>{error}</Text><SupportLink problem={error} /></>) : null}
                {signedIn ? (
                  <AppButton
                    label={view === 'activating' ? t('store.activating') : t('gate.activateNow')}
                    icon="card-outline"
                    loading={view === 'busy' || view === 'activating'}
                    onPress={() => void buy()}
                  />
                ) : (
                  <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => go('/auth/login')} />
                )}
                {/* «جارٍ التفعيل» never traps the member: after ten seconds the popup can be closed, and the
                    app goes on asking the server behind it. */}
                {offerClose ? <AppButton label={t('common.close')} variant="ghost" onPress={() => setVisible(false)} /> : null}
                <AppButton label={t('gate.benefits')} variant="outline" icon="ribbon-outline" onPress={() => go('/membership')} />
                <PressScale onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('gate.later')}>
                  <Text style={styles.later}>{t('gate.later')}</Text>
                </PressScale>
              </>
            )}
            </ScrollView>
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

/**
 * The home card for a signed-in non-member — the owner's line, the store price when the store
 * answers, and one golden door into the popup.
 */
export function MembershipHomeCard() {
  const { status, me } = useAuth();
  const signedIn = status === 'signedIn' && me !== null;
  const nonMember = signedIn && me.membership.status !== 'active';
  const { data: config } = useStoreConfig(nonMember);
  const [loaded, setLoaded] = useState<LoadedOffer | null>(null);
  // This account's offer only (see MembershipGateHost): the price of an account that signed out is never shown.
  const offer = nonMember ? (loaded && loaded.contactId === me.id ? loaded.offer : config ? cachedMembershipOffer(config, me.id) : null) : null;

  const contactId = nonMember ? me.id : null;
  useEffect(() => {
    if (contactId === null || !config || offer || !hasStorePurchases() || !storeKeyFor(config)) return;
    let alive = true;
    void loadMembershipOffer(config, contactId).then((found) => {
      if (alive && found) setLoaded({ contactId, offer: found });
    });
    return () => {
      alive = false;
    };
  }, [contactId, config, offer]);

  if (!nonMember) return null;
  return (
    <PressScale onPress={showMembershipGate} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={t('gate.activateNow')}>
      <GlassCard golden radius={radii.xl} style={styles.homeCard}>
        <Floating amplitude={2} duration={2600}>
          <GoldGradient style={styles.homeIcon}>
            <Ionicons name="ribbon" size={24} color={colors.goldInk} />
          </GoldGradient>
        </Floating>
        <View style={styles.homeTexts}>
          <Text style={styles.homeTitle}>{t('gate.homeTitle')}</Text>
          <Text style={styles.homeSubtitle}>{t('gate.homeText')}</Text>
          {offer ? (
            <Text style={styles.homePrice}>
              <SarText style={styles.homePrice}>{storePriceLabel(offer.product.priceString)}</SarText>
              <Text style={styles.homePeriod}>{` ${t('store.period', { store: storeName() })}`}</Text>
            </Text>
          ) : null}
        </View>
        <GoldGradient style={styles.homeCta}>
          <Text style={styles.homeCtaText} numberOfLines={1}>
            {t('store.subscribe')}
          </Text>
        </GoldGradient>
      </GlassCard>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch', maxHeight: '100%' },
  card: { flexShrink: 1 },
  cardBody: { gap: spacing.sm, padding: spacing.md, alignItems: 'stretch' },
  legal: { ...typography.caption, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: 'center' },
  lockRing: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGold,
  },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm },
  price: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: colors.gold },
  period: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  later: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs },
  // The home card.
  homeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.sm },
  homeIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGold,
  },
  homeTexts: { flex: 1, gap: 2 },
  homeTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.textPrimary, textAlign: textStart },
  homeSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  homePrice: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 21, color: colors.goldText, textAlign: textStart, marginTop: 2 },
  homePeriod: { ...typography.caption, fontFamily: fonts.regular, color: colors.textSecondary },
  homeCta: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    boxShadow: shadows.glowGoldFaint,
    maxWidth: 110,
  },
  homeCtaText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, color: colors.goldInk },
}));

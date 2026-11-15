import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useStoreConfig, type StoreConfig } from '@/api/membership';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { FadeInView, PopIn, PressScale, Sheen } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { SarText } from '@/components/SarText';
import { SupportLink } from '@/components/SupportLink';
import { getLang, t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import {
  fetchManagementUrl,
  fetchMembershipOffer,
  hasStorePurchases,
  identifyPurchases,
  purchaseMembership,
  restoreMembership,
  riyalPrice,
  storeKeyFor,
  storeName,
  type StoreOffer,
} from '@/lib/purchases';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

// `storePending`: the store itself is still processing the payment (Android pending purchase) — a calm wait, not a failure.
type Phase = 'loading' | 'ready' | 'unavailable' | 'busy' | 'activating' | 'done' | 'pending' | 'storePending';

// The first, quick round of asking the server right after the store's answer. Each check is `syncMembership()` of
// AuthProvider (about 8 s at most for the caller, a later answer still applied); when the round ends without
// «active» the watcher there goes on asking — on a timer, on every return to the app, after a restart.
const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 3000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// U+200E, U+200F and U+061C, built from their code points so no invisible character sits in this file.
const BIDI_MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f, 0x061c)}]`, 'g');

/**
 * The store's price string as the member reads it: Android sometimes wraps the symbol in invisible
 * right-to-left / left-to-right marks, which stopped riyalPrice() from recognising «SAR 1,900.00».
 */
export function storePriceLabel(priceString: string): string {
  return riyalPrice(priceString.replace(BIDI_MARKS, ''));
}

/**
 * Annual membership purchase through the store (CLAUDE.md rule 3). The price comes from the store,
 * the activation from the server: the store's own result never activates anything here.
 */
export function StorePurchaseCard({ title }: { title: string }) {
  const { me, syncMembership, watchMembership, stopMembershipWatch, membershipPending, membershipPendingLong } = useAuth();
  const { data: config, isLoading, error: configError, refetch: refetchConfig } = useStoreConfig(Boolean(me));
  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  const [offer, setOffer] = useState<StoreOffer | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // V2: the card measures itself so the gold sheen can sweep its full width.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const contactId = me?.id ?? null;
  const active = me?.membership.status === 'active';
  const supported = hasStorePurchases();
  const apiKey = config ? storeKeyFor(config) : null;

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    if (!config || contactId === null || !apiKey || !supported) return;
    // A purchase in hand (the store sheet, the server check) is never restarted by this effect. A waiting notice
    // is left alone too — until the purchase has waited more than 30 minutes: then the offer is fetched below so
    // the Subscribe button can come back beside the notice.
    const held = phaseRef.current;
    if (held === 'busy' || held === 'activating' || held === 'done') return;
    if ((held === 'pending' || held === 'storePending') && !membershipPendingLong) return;
    let cancelled = false;
    go('loading');
    (async () => {
      const identified = await identifyPurchases(config, contactId);
      if (cancelled) return;
      if (!identified) {
        go('unavailable');
        return;
      }
      if (active) {
        const url = await fetchManagementUrl();
        if (!cancelled) {
          setManageUrl(url);
          go('ready');
        }
        return;
      }
      if (membershipPending && !membershipPendingLong) {
        // A purchase of this account is still waiting for the server (this launch or an earlier one): the calm
        // notice and «استعادة المشتريات», not a second Subscribe button. After 30 minutes of waiting the offer is
        // fetched instead, and the button returns beside the notice (see the render below).
        go('storePending');
        return;
      }
      try {
        const found = await fetchMembershipOffer(config);
        if (cancelled) return;
        setOffer(found);
        go(found ? 'ready' : 'unavailable');
      } catch {
        if (!cancelled) go('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, contactId, apiKey, supported, active, membershipPending, membershipPendingLong, go]);

  // The store said yes; only the server's answer counts (webhook, or its REST check in /api/membership/sync).
  const settle = useCallback(async () => {
    const owner = contactId;
    go('activating');
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      // null = server busy, offline or no answer within the cap: try again below.
      const account = await syncMembership();
      // Another account signed in on this phone while this round was still asking: the purchase is not its own.
      if (account && account.id !== owner) return;
      if (account?.membership.status === 'active') {
        go('done');
        return;
      }
      // An attempt that already took its time is not followed by another pause.
      if (Date.now() - started < SETTLE_DELAY_MS) await wait(SETTLE_DELAY_MS);
    }
    go('pending');
  }, [contactId, go, syncMembership]);

  const buy = async () => {
    // A second tap while the store sheet is opening must not start a second purchase.
    if (!config || !offer || phaseRef.current !== 'ready') return;
    setError(null);
    go('busy');
    const result = await purchaseMembership(config, offer);
    if (result.status === 'cancelled') return go('ready');
    if (result.status === 'pending') {
      // The store is still processing the payment: a calm wait — no error, no second Subscribe while it shows —
      // and the app keeps asking the server until the payment completes and the membership is active.
      watchMembership();
      return go('storePending');
    }
    if (result.status === 'failed') {
      setError(result.message);
      return go('ready');
    }
    // The store took the payment. From here the app keeps asking the server until it says active, even if this
    // screen is left or the app is closed in the middle (the watch is saved before the first check).
    watchMembership();
    await settle();
  };

  const restore = async () => {
    const from = phaseRef.current;
    if (!config || (from !== 'ready' && from !== 'unavailable' && from !== 'storePending')) return;
    setError(null);
    go('busy');
    const result = await restoreMembership(config);
    if ('error' in result) {
      setError(result.error);
      return go(from);
    }
    if (!result.entitled) {
      // The store itself has nothing for this account. A purchase that never completed (a deferred payment that
      // expired or was cancelled) must not keep the waiting notice — and the Subscribe button — locked for days:
      // the watch ends here and the card goes back to its offer.
      stopMembershipWatch();
      setError(t('store.noPrevious', { store: storeName() }));
      if (from !== 'storePending') return go(from);
      if (offer) return go('ready');
      // The waiting notice was showing without a price (the purchase was made in an earlier launch): fetch the
      // offer now. The phase stays `busy` meanwhile, so the effect above does not start a second fetch.
      try {
        const found = await fetchMembershipOffer(config);
        setOffer(found);
        return go(found ? 'ready' : 'unavailable');
      } catch {
        return go('unavailable');
      }
    }
    watchMembership();
    await settle();
  };

  // «Waiting» is never sticky: the moment the account is active — this card's own check, the watcher, a push, a
  // return to the app — the waiting states give way to the success notice, on this same screen.
  const shown: Phase = active && (phase === 'pending' || phase === 'storePending' || phase === 'activating') ? 'done' : phase;

  if (!me || isLoading) return null;
  if (shown === 'done') {
    // The paid moment: the success notice (checkmark) springs in under a golden halo.
    return (
      <PopIn style={styles.doneGlow}>
        <Notice tone="success" text={t('store.done')} />
      </PopIn>
    );
  }
  if (shown === 'pending') {
    return (
      <FadeInView offset={8}>
        <Notice tone="warning" text={t('store.pending')} />
      </FadeInView>
    );
  }
  if (!config) {
    // The store settings did not arrive (offline, server busy): say so, with a retry — «يتوفر قريبًا» would be untrue.
    return active ? null : (
      <View style={styles.configError}>
        <Notice tone="warning" text={errorMessage(configError)} />
        <AppButton label={t('common.retry')} variant="outline" icon="refresh" onPress={() => void refetchConfig()} />
      </View>
    );
  }
  if (!apiKey) return active ? null : <Notice text={t('store.comingSoon', { store: storeName() })} />;
  if (!supported) return active ? null : <Notice tone="warning" text={t('store.unsupported')} />;
  if (active) {
    return manageUrl ? <AppButton label={t('store.manage', { store: storeName() })} variant="outline" icon="settings-outline" onPress={() => void openLink(manageUrl)} /> : null;
  }

  return (
    <View onLayout={(event) => setSize(event.nativeEvent.layout)}>
      <GlassCard golden style={styles.card}>
        {size.width > 0 ? <Sheen width={size.width} height={size.height} /> : null}
        <View style={styles.header}>
          <Ionicons name="storefront-outline" size={22} color={colors.gold} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <FadeInView key={shown} offset={6} duration={260} style={styles.phase}>
          {shown === 'loading' ? <Progress text={t('store.loadingPrice')} /> : null}
          {shown === 'busy' ? <Progress text={t('store.opening', { store: storeName() })} /> : null}
          {shown === 'activating' ? <Progress text={t('store.activating')} /> : null}
          {shown === 'unavailable' ? <Text style={styles.muted}>{t('store.unavailable')}</Text> : null}
          {/* The waiting notice; after 30 minutes of waiting the price and Subscribe return under it (phase `ready`). */}
          {shown === 'storePending' || (membershipPending && (shown === 'ready' || shown === 'unavailable')) ? <Notice text={t('store.pending')} /> : null}
          {shown === 'ready' && offer ? (
            <>
              <PopIn style={styles.priceRow}>
                <SarText style={styles.price}>{storePriceLabel(offer.product.priceString)}</SarText>
                <Text style={styles.period}>{t('store.period', { store: storeName() })}</Text>
              </PopIn>
              <AppButton label={t('store.subscribe')} icon="card-outline" onPress={() => void buy()} />
            </>
          ) : null}
          {shown === 'ready' || shown === 'unavailable' || shown === 'storePending' ? (
            <PressScale onPress={() => void restore()} style={styles.restore} wrapStyle={styles.restoreWrap} hitSlop={8}>
              <Ionicons name="refresh-outline" size={16} color={colors.goldLightText} />
              <Text style={styles.restoreText}>{t('store.restore')}</Text>
            </PressScale>
          ) : null}
        </FadeInView>
        {error ? (<><Text style={styles.error}>{error}</Text><SupportLink problem={error} /></>) : null}
        <Text style={styles.legal}>
          {t('store.legal', { store: storeName() })}
        </Text>
        {config.environment === 'test' ? <Text style={styles.legal}>{t('store.testEnv')}</Text> : null}
        <StoreLegalLinks config={config} />
      </GlassCard>
    </View>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <View style={styles.progress}>
      <ActivityIndicator color={colors.gold} />
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

/** M239 (owner, 2026-11-14): the server's own /legal/ pages open in the app's language; an external override URL is left as is. */
export function legalUrl(url: string): string {
  if (!url.includes('/legal/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}lang=${getLang()}`;
}

/** Terms of use and privacy policy beside the price, as the stores ask; `onOpen` lets a popup close itself first. */
export function StoreLegalLinks({ config, onOpen, centered = false }: { config: Pick<StoreConfig, 'termsUrl' | 'privacyUrl'>; onOpen?: () => void; centered?: boolean }) {
  if (!config.termsUrl && !config.privacyUrl) return null;
  return (
    <View style={[styles.links, centered && styles.linksCentered]}>
      {config.termsUrl ? <LinkText label={t('store.terms')} url={config.termsUrl} onOpen={onOpen} /> : null}
      {config.privacyUrl ? <LinkText label={t('store.privacy')} url={config.privacyUrl} onOpen={onOpen} /> : null}
    </View>
  );
}

function LinkText({ label, url, onOpen }: { label: string; url: string; onOpen?: () => void }) {
  const router = useRouter();
  // M116d (owner): club pages open INSIDE the app — the hosting domain never shows.
  const open = () => {
    onOpen?.();
    router.push({ pathname: '/webpage', params: { url: legalUrl(url), title: label } } as Href);
  };
  return (
    <PressScale onPress={open} accessibilityRole="link" style={styles.linkTap}>
      <Text style={styles.link}>{label}</Text>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  card: { gap: spacing.sm, padding: spacing.md },
  doneGlow: { borderRadius: radii.md, boxShadow: shadows.glowGold },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.textPrimary, flex: 1, textAlign: textStart },
  phase: { gap: spacing.sm },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, justifyContent: 'flex-start' },
  price: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, color: colors.gold },
  period: { ...typography.caption, color: colors.textSecondary },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { ...typography.body, color: colors.textSecondary, textAlign: textStart, flex: 1 },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  configError: { gap: spacing.sm },
  restoreWrap: { alignSelf: 'flex-start' },
  // 44 pt tap target: Apple requires «Restore purchases» to be easy to reach.
  restore: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  restoreText: { ...typography.caption, color: colors.goldLightText },
  legal: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  links: { flexDirection: 'row', gap: spacing.md },
  linksCentered: { justifyContent: 'center' },
  linkTap: { minHeight: 44, justifyContent: 'center' },
  link: { ...typography.caption, color: colors.goldLightText, textDecorationLine: 'underline' },
}));

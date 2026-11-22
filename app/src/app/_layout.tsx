// First on purpose: the global error handler is in place before any other module of the app runs (lib/crashGuard.ts).
import { markFirstCommit } from '@/lib/crashGuard';

import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { requireOptionalNativeModule } from 'expo';
import { LocaleProvider, Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';

import { AppState, View } from 'react-native';

import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { GuestGate, GuestGateProvider } from '@/auth/GuestGate';
import { GlobalTabBar } from '@/components/GlobalTabBar';
import { GuestNudge } from '@/components/GuestNudge';
import { AppLockGate } from '@/components/AppLockGate';
import { AdminPopup } from '@/components/AdminPopup';
import { CrashScreen } from '@/components/CrashScreen';
import { GentlePopups } from '@/components/GentlePopups';
import { IntroVideoPopup } from '@/components/IntroVideo';
import { LaunchCover } from '@/components/LaunchCover';
import { WhatsappVerifyHost } from '@/components/WhatsappVerify';
import { WhatsappGateHost } from '@/components/WhatsappGateHost';
import { RateUsPrompt } from '@/components/RateUsPrompt';
import { RetiredBuildGate } from '@/components/RetiredBuildGate';
import { MembershipGateHost } from '@/components/MembershipGate';
import { SplashFlash } from '@/components/SplashFlash';
import { MembershipCelebration } from '@/components/wow';
import { AskAdvisorProvider } from '@/components/advisor/AskAdvisor';
import { AdsAttribution } from '@/components/AdsAttribution';
import { PushRegistrar } from '@/components/PushRegistrar';
import { ScreenTracker } from '@/components/ScreenTracker';
import { SyncPoller } from '@/components/SyncPoller';
import { UpdateGate } from '@/components/UpdateGate';
import { initI18n, t } from '@/i18n';
import { isRTL, syncDirection } from '@/i18n/direction';
import { syncStrings } from '@/i18n/remote';
import { installNotificationHandler } from '@/lib/notifications';
import { persistQueryCache, restoreQueryCache } from '@/lib/queryCache';
import { memberMayBeTyping, reloadApp } from '@/lib/reloadApp';
import { loadTheme } from '@/theme/theme';
import { colors, fonts, getThemeName, typography } from '@/theme/tokens';

installNotificationHandler();
// A rejection here (no activity yet) must never surface as an unhandled promise at launch.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Launch watchdog: the splash screen is held until the fonts, the saved language/theme and the cached content are
 * back. Each of them is guarded against errors, but a secure-store or file read that never answers (a stalled Android
 * Keystore, a locked iPhone keychain) would keep the splash up for ever. After this long the app opens anyway, with
 * whatever is ready.
 */
const LAUNCH_WATCHDOG_MS = 12_000;
/** A phone that keeps the app alive for days: back in the foreground with a check older than this, look for an update again. */
const UPDATE_RECHECK_MS = 3 * 60 * 60_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // One more try for a lost connection, a 5xx, a deadline (408) or a rate limit (429). Any other 4xx is final:
      // asking again for a 401 / 403 / 404 / 426 only doubles the call and delays the error state by a second.
      retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429),
    },
  },
});

// TanStack's refetch-on-focus listens to a browser window, which a phone does not have: the app's own foreground
// state drives it, so what is stale on screen refreshes when the member comes back to the app.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => subscription.remove();
});

// M196: a function, not a constant — it reads the active palette at render, after loadTheme().
const detailHeader = () => ({
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.gold,
  headerTitleStyle: { fontFamily: fonts.semiBold, fontSize: typography.subtitle.fontSize, color: colors.textPrimary },
  headerTitleAlign: 'center' as const,
  headerBackButtonDisplayMode: 'minimal' as const,
  headerShadowVisible: false,
  // V2: detail pages rise in with a fade — softer than the default hard slide.
  animation: 'fade_from_bottom' as const,
});

/**
 * 2026-11-16 (members: «شاشة سودا بدون سبب»): expo-router wraps the root layout in this boundary. A screen or a root
 * cover that throws while drawing now shows the recovery screen (components/CrashScreen.tsx) instead of the dead
 * black window on Android or the app closing on iPhone. In the first seconds of a cold start on a downloaded update
 * the error is thrown on instead, so expo-updates can still roll a broken update back (lib/crashGuard.ts).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CrashScreen error={error} retry={retry} />;
}

/** One broken screen keeps the rest of the app alive: its own boundary offers «رجوع» beside the restart. */
function ScreenCrash({ error, retry }: ErrorBoundaryProps) {
  return <CrashScreen error={error} retry={retry} scope="screen" />;
}

export const unstable_settings = { screenErrorBoundary: ScreenCrash };

export default function RootLayout() {
  // The first commit (the launch cover is mounted): expo-updates can no longer roll a broken update back, so from
  // here on the boundaries and the global handler catch every error instead of passing it on (lib/crashGuard.ts).
  useEffect(() => {
    markFirstCommit();
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  // The language, the saved wording edits and the layout direction are settled behind the splash screen:
  // no screen draws in the wrong language or direction first.
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => {
    // M196: the saved theme is applied in the same breath, so the first screen draws in it.
    void Promise.allSettled([initI18n().then(syncDirection), loadTheme()])
      .catch(() => undefined)
      .finally(() => {
        setI18nReady(true);
        void syncStrings();
      });
  }, []);

  // M152: the last visit's content comes back from disk behind the splash, so the home draws at once
  // and refreshes behind; from then on every change is mirrored to the file (see lib/queryCache.ts).
  // It waits for i18n: the file is kept only when it was saved in the language the app opens in.
  const [cacheReady, setCacheReady] = useState(false);
  useEffect(() => {
    if (!i18nReady) return;
    let unsubscribe: (() => void) | null = null;
    void restoreQueryCache(queryClient).finally(() => {
      unsubscribe = persistQueryCache(queryClient);
      setCacheReady(true);
    });
    return () => unsubscribe?.();
  }, [i18nReady]);

  // M182d (owner, 2026-11-02, «عملت كل شيء ومفيش فايدة»): a published update applies itself on the
  // FIRST open — check, fetch, reload — instead of the close-twice dance expo-updates asks for by
  // default. Early in the launch only (the effect runs once), gated on the native module (M92
  // pattern) so development builds and a binary without updates never crash. Every error is
  // swallowed: the default next-launch path still stands behind it.
  // 2026-11-16 (members: «شاشة سودا بدون سبب»; decided by the coordinator): the reload happens ONLY while the launch
  // cover / splash is still showing — the member then sees one longer opening screen. Once the first screen is
  // visible the update stays pending: the «restart» banner (UpdateGate) offers it and the next cold start runs it.
  // Second lock: never while the member may be typing (lib/reloadApp.ts). This replaces the 30-second rule.
  const firstScreenShown = useRef(false);
  useEffect(() => {
    if (!requireOptionalNativeModule('ExpoUpdates')) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const updates = require('expo-updates') as typeof import('expo-updates');
    let lastCheckAt = 0;
    let busy = true;
    void updates
      .checkForUpdateAsync()
      .then((check) => {
        lastCheckAt = Date.now();
        return check.isAvailable ? updates.fetchUpdateAsync() : null;
      })
      .then((fetched) => (fetched?.isNew && !firstScreenShown.current && !memberMayBeTyping() ? reloadApp() : undefined))
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
    // Back in the foreground with a check older than three hours: look again and download behind the screen. NEVER a
    // reload here — the «restart» banner (UpdateGate) offers it and the next launch applies it. A failed look (no
    // network) does not count as a check, so the next return to the foreground tries again.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || busy || Date.now() - lastCheckAt < UPDATE_RECHECK_MS) return;
      busy = true;
      void updates
        .checkForUpdateAsync()
        .then((check) => {
          lastCheckAt = Date.now();
          return check.isAvailable ? updates.fetchUpdateAsync() : null;
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    });
    return () => subscription.remove();
  }, []);

  const [watchdog, setWatchdog] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWatchdog(true), LAUNCH_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = watchdog || ((fontsLoaded || fontError !== null) && i18nReady && cacheReady);
  useEffect(() => {
    if (!ready) return;
    firstScreenShown.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) {
    // 2026-11-16: never an empty root. At a cold start this sits under the native splash; after a reload (language,
    // theme, an update) the native splash does not come back, and this is the opening screen the member sees.
    return <LaunchCover />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GuestGateProvider>
          <PushRegistrar />
          <AdsAttribution />
          <SyncPoller />
          <ScreenTracker />
          <StatusBar style={getThemeName() === 'light' ? 'dark' : 'light'} />
          <AskAdvisorProvider>
            {/* The native headers (back arrow side) read the direction from here, not from I18nManager's start-up constant (see direction.ts). */}
            <LocaleProvider direction={isRTL() ? 'rtl' : 'ltr'}>
              {/* The Stack and the fixed bottom bar share the column: detail screens sit ABOVE the bar, never behind it.
                  The page colour fills it: behind the bar's rounded top corners the window's black showed as two
                  wedges on every pushed screen of the light theme. The direction is stated here too, read at render
                  from the language, for the launches where the native flag has not caught up with it yet. */}
              <View style={{ flex: 1, backgroundColor: colors.black, direction: isRTL() ? 'rtl' : 'ltr' }}>
                <View style={{ flex: 1 }}>
                  <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.black },
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
                <Stack.Screen name="project/[id]" options={{ ...detailHeader(), title: t('nav.project') }} />
                <Stack.Screen name="golden" options={{ ...detailHeader(), title: t('nav.golden') }} />
                <Stack.Screen name="golden/[code]" options={{ ...detailHeader(), title: t('nav.goldenOffer') }} />
                <Stack.Screen name="membership" options={{ ...detailHeader(), title: t('nav.membership') }} />
                <Stack.Screen name="profile-edit" options={{ ...detailHeader(), title: t('nav.profileEdit') }} />
                <Stack.Screen name="news/[id]" options={{ ...detailHeader(), title: t('nav.newsItem') }} />
                <Stack.Screen name="news/decisions" options={{ ...detailHeader(), title: t('nav.decisions') }} />
                <Stack.Screen name="news/interests" options={{ ...detailHeader(), title: t('nav.interests') }} />
                <Stack.Screen name="markets" options={{ ...detailHeader(), title: t('nav.markets') }} />
                <Stack.Screen name="portal/entrepreneurs" options={{ ...detailHeader(), title: t('nav.entrepreneurs') }} />
                <Stack.Screen name="services/index" options={{ ...detailHeader(), title: t('nav.services') }} />
                <Stack.Screen name="service/[key]" options={{ ...detailHeader(), title: t('nav.service') }} />
                <Stack.Screen name="form/[key]" options={{ ...detailHeader(), title: t('nav.form') }} />
                <Stack.Screen name="videos/index" options={{ ...detailHeader(), title: t('nav.videos') }} />
                <Stack.Screen name="watch" options={{ ...detailHeader(), title: t('nav.watch') }} />
                <Stack.Screen name="posts/index" options={{ ...detailHeader(), title: t('nav.posts') }} />
                <Stack.Screen name="posts/[id]" options={{ ...detailHeader(), title: t('nav.post') }} />
                <Stack.Screen name="posts/compose" options={{ ...detailHeader(), title: t('compose.screenTitle') }} />
                <Stack.Screen name="card" options={{ ...detailHeader(), title: t('nav.card') }} />
                <Stack.Screen name="invite" options={{ ...detailHeader(), title: t('nav.invite') }} />
                <Stack.Screen name="agenda/index" options={{ ...detailHeader(), title: t('nav.agenda') }} />
                <Stack.Screen name="agenda/[id]" options={{ ...detailHeader(), title: t('nav.agendaEvent') }} />
                <Stack.Screen name="people/index" options={{ ...detailHeader(), title: t('nav.people') }} />
                <Stack.Screen name="people/[id]" options={{ ...detailHeader(), title: t('nav.person') }} />
                <Stack.Screen name="people/apply" options={{ ...detailHeader(), title: t('nav.peopleApply') }} />
                <Stack.Screen name="guide" options={{ ...detailHeader(), title: t('nav.guide') }} />
                <Stack.Screen name="workshops" options={{ ...detailHeader(), title: t('nav.workshops') }} />
                <Stack.Screen name="meetups" options={{ ...detailHeader(), title: t('nav.meetups') }} />
                <Stack.Screen name="meetup/[key]" options={{ ...detailHeader(), title: t('nav.meetup') }} />
                <Stack.Screen name="about" options={{ ...detailHeader(), title: t('nav.about') }} />
                {/* «راسل الإدارة» opened with no header, no title and no back arrow: the same detail header as the rest. */}
                <Stack.Screen name="contact" options={{ ...detailHeader(), title: t('contact.title') }} />
                <Stack.Screen name="hq/index" options={{ ...detailHeader(), title: t('nav.hq') }} />
                <Stack.Screen name="hq/book" options={{ ...detailHeader(), title: t('nav.hqBook') }} />
                <Stack.Screen name="hq/pass/[id]" options={{ ...detailHeader(), title: t('nav.hqPass') }} />
                <Stack.Screen name="hq/admin" options={{ ...detailHeader(), title: t('nav.hqAdmin') }} />
                {/* M128 (owner: «صفحة الدفع مرمية فوق») — the embedded checkout gets the same gold
                    header and back arrow as every detail screen, on a white sheet. */}
                <Stack.Screen name="checkout/[id]" options={{ ...detailHeader(), title: t('checkout.title'), contentStyle: { backgroundColor: '#FFFFFF' } }} />
                <Stack.Screen name="payment/[id]" options={{ ...detailHeader(), title: t('nav.payment') }} />
                <Stack.Screen name="payments/index" options={{ ...detailHeader(), title: t('nav.payments') }} />
                <Stack.Screen name="security" options={{ ...detailHeader(), title: t('security.title') }} />
                <Stack.Screen name="security-extra" options={{ ...detailHeader(), title: t('security.extraTitle') }} />
                <Stack.Screen name="security-sessions" options={{ ...detailHeader(), title: t('security.sessionsTitle') }} />
                <Stack.Screen name="delete-account" options={{ ...detailHeader(), title: t('deleteAccount.title') }} />
                {/* M116d: club pages inside the app (terms, privacy…) — the screen sets its own title. */}
                <Stack.Screen name="webpage" options={{ ...detailHeader(), title: '' }} />
                <Stack.Screen name="deck" options={{ ...detailHeader(), title: '' }} />
                <Stack.Screen name="auth/login" options={{ ...detailHeader(), title: t('nav.login') }} />
                <Stack.Screen name="auth/register" options={{ ...detailHeader(), title: t('nav.register') }} />
                <Stack.Screen name="auth/verify" options={{ ...detailHeader(), title: t('nav.verify') }} />
                <Stack.Screen name="auth/phone" options={{ ...detailHeader(), title: t('phoneCode.title') }} />
                <Stack.Screen name="phone-confirm" options={{ ...detailHeader(), title: t('phoneCode.title') }} />
                <Stack.Screen name="auth/reset" options={{ ...detailHeader(), title: t('nav.reset') }} />
                  </Stack>
                </View>
                {/* Owner (2026-10-17): the bottom bar is FIXED on every page — this renders it wherever the (tabs) bar is not. */}
                <GlobalTabBar />
              </View>
            </LocaleProvider>
          </AskAdvisorProvider>
          {/* The app opens for members: a visitor is sent to the gate, and again when his guest week is over. */}
          <GuestGate />
          {/* M74: the soft register invitation after the guest has browsed a while. */}
          <GuestNudge />
          {/* M120: the members-only popup — opens on any locked tap, and once ever after the intro video. */}
          <MembershipGateHost />
          {/* M85f: gold confetti the moment the membership turns active, wherever it is noticed. */}
          <MembershipCelebration />
          {/* M141: «قيّمنا على المتجر» — a small sheet for signed-in members, at most once a week. */}
          <RateUsPrompt />
          {/* M204 (owner): missing details and the unconfirmed number are weekly popups with «لاحقًا», never a wall. */}
          <GentlePopups />
          {/* M232 (owner): a popup published from the dashboard («أدوات التواصل») — once per device, never over another popup. */}
          <AdminPopup />
          {/* M209 (owner): the intro film plays once right after a registration (and once for an account that never saw it) — first in line. */}
          <IntroVideoPopup />
          {/* M209 (owner): every member with an unproven WhatsApp number gets one gentle popup ~5 s after landing, after the film and the details form. */}
          <WhatsappVerifyHost />
          {/* M204 (owner): a new dealing of an account with an unproven number asks for the WhatsApp code first. */}
          <WhatsappGateHost />
          {/* M240: the root covers carry NO zIndex (a zIndex child switches Android to custom draw order, which
              crashed 1.3.2 in getChildDrawingOrder when a cover left). They stack by this order, lowest first. */}
          {/* M195: the forced-update cover and the «restart to apply the OTA» banner. */}
          <UpdateGate />
          {/* M118d: the biometric app lock — covers everything while it waits for the face. */}
          <AppLockGate />
          {/* M118 (owner): his golden-sparkles artwork flashes for a split second as the app opens. */}
          <SplashFlash />
          {/* M137: the preview build is retired — a TEST binary shows only the «download the store app» cover. */}
          <RetiredBuildGate />
        </GuestGateProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

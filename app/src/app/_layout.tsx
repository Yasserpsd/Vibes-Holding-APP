import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { View } from 'react-native';

import { AuthProvider } from '@/auth/AuthProvider';
import { GuestGate, GuestGateProvider } from '@/auth/GuestGate';
import { GlobalTabBar } from '@/components/GlobalTabBar';
import { GuestNudge } from '@/components/GuestNudge';
import { AppLockGate } from '@/components/AppLockGate';
import { ProfileCompletionGate } from '@/components/ProfileCompletionGate';
import { RateUsPrompt } from '@/components/RateUsPrompt';
import { RetiredBuildGate } from '@/components/RetiredBuildGate';
import { MembershipGateHost } from '@/components/MembershipGate';
import { SplashFlash } from '@/components/SplashFlash';
import { MembershipCelebration } from '@/components/wow';
import { AskAdvisorProvider } from '@/components/advisor/AskAdvisor';
import { PushRegistrar } from '@/components/PushRegistrar';
import { ScreenTracker } from '@/components/ScreenTracker';
import { SyncPoller } from '@/components/SyncPoller';
import { initI18n, t } from '@/i18n';
import { isRTL, syncDirection } from '@/i18n/direction';
import { syncStrings } from '@/i18n/remote';
import { installNotificationHandler } from '@/lib/notifications';
import { persistQueryCache, restoreQueryCache } from '@/lib/queryCache';
import { colors, fonts, typography } from '@/theme/tokens';

installNotificationHandler();
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

const detailHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.gold,
  headerTitleStyle: { fontFamily: fonts.semiBold, fontSize: typography.subtitle.fontSize, color: colors.textPrimary },
  headerTitleAlign: 'center' as const,
  headerBackButtonDisplayMode: 'minimal' as const,
  headerShadowVisible: false,
  // V2: detail pages rise in with a fade — softer than the default hard slide.
  animation: 'fade_from_bottom' as const,
};

export default function RootLayout() {
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
    void initI18n()
      .then(syncDirection)
      .catch(() => undefined)
      .finally(() => {
        setI18nReady(true);
        void syncStrings();
      });
  }, []);

  // M152: the last visit's content comes back from disk behind the splash, so the home draws at once
  // and refreshes behind; from then on every change is mirrored to the file (see lib/queryCache.ts).
  const [cacheReady, setCacheReady] = useState(false);
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    void restoreQueryCache(queryClient).finally(() => {
      unsubscribe = persistQueryCache(queryClient);
      setCacheReady(true);
    });
    return () => unsubscribe?.();
  }, []);

  const ready = (fontsLoaded || fontError !== null) && i18nReady && cacheReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GuestGateProvider>
          <PushRegistrar />
          <SyncPoller />
          <ScreenTracker />
          <StatusBar style="light" />
          <AskAdvisorProvider>
            {/* The native headers (back arrow side) read the direction from here, not from I18nManager's start-up constant (see direction.ts). */}
            <LocaleProvider direction={isRTL() ? 'rtl' : 'ltr'}>
              {/* The Stack and the fixed bottom bar share the column: detail screens sit ABOVE the bar, never behind it. */}
              <View style={{ flex: 1 }}>
                <View style={{ flex: 1 }}>
                  <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.black },
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
                <Stack.Screen name="project/[id]" options={{ ...detailHeader, title: t('nav.project') }} />
                <Stack.Screen name="golden" options={{ ...detailHeader, title: t('nav.golden') }} />
                <Stack.Screen name="golden/[code]" options={{ ...detailHeader, title: t('nav.goldenOffer') }} />
                <Stack.Screen name="membership" options={{ ...detailHeader, title: t('nav.membership') }} />
                <Stack.Screen name="profile-edit" options={{ ...detailHeader, title: t('nav.profileEdit') }} />
                <Stack.Screen name="news/[id]" options={{ ...detailHeader, title: t('nav.newsItem') }} />
                <Stack.Screen name="news/decisions" options={{ ...detailHeader, title: t('nav.decisions') }} />
                <Stack.Screen name="news/interests" options={{ ...detailHeader, title: t('nav.interests') }} />
                <Stack.Screen name="portal/entrepreneurs" options={{ ...detailHeader, title: t('nav.entrepreneurs') }} />
                <Stack.Screen name="services/index" options={{ ...detailHeader, title: t('nav.services') }} />
                <Stack.Screen name="service/[key]" options={{ ...detailHeader, title: t('nav.service') }} />
                <Stack.Screen name="form/[key]" options={{ ...detailHeader, title: t('nav.form') }} />
                <Stack.Screen name="videos/index" options={{ ...detailHeader, title: t('nav.videos') }} />
                <Stack.Screen name="watch" options={{ ...detailHeader, title: t('nav.watch') }} />
                <Stack.Screen name="posts/index" options={{ ...detailHeader, title: t('nav.posts') }} />
                <Stack.Screen name="posts/[id]" options={{ ...detailHeader, title: t('nav.post') }} />
                <Stack.Screen name="posts/compose" options={{ ...detailHeader, title: t('compose.screenTitle') }} />
                <Stack.Screen name="card" options={{ ...detailHeader, title: t('nav.card') }} />
                <Stack.Screen name="invite" options={{ ...detailHeader, title: t('nav.invite') }} />
                <Stack.Screen name="agenda/index" options={{ ...detailHeader, title: t('nav.agenda') }} />
                <Stack.Screen name="agenda/[id]" options={{ ...detailHeader, title: t('nav.agendaEvent') }} />
                <Stack.Screen name="people/index" options={{ ...detailHeader, title: t('nav.people') }} />
                <Stack.Screen name="people/[id]" options={{ ...detailHeader, title: t('nav.person') }} />
                <Stack.Screen name="people/apply" options={{ ...detailHeader, title: t('nav.peopleApply') }} />
                <Stack.Screen name="guide" options={{ ...detailHeader, title: t('nav.guide') }} />
                <Stack.Screen name="workshops" options={{ ...detailHeader, title: t('nav.workshops') }} />
                <Stack.Screen name="meetups" options={{ ...detailHeader, title: t('nav.meetups') }} />
                <Stack.Screen name="meetup/[key]" options={{ ...detailHeader, title: t('nav.meetup') }} />
                <Stack.Screen name="about" options={{ ...detailHeader, title: t('nav.about') }} />
                <Stack.Screen name="hq/index" options={{ ...detailHeader, title: t('nav.hq') }} />
                <Stack.Screen name="hq/book" options={{ ...detailHeader, title: t('nav.hqBook') }} />
                <Stack.Screen name="hq/pass/[id]" options={{ ...detailHeader, title: t('nav.hqPass') }} />
                <Stack.Screen name="hq/admin" options={{ ...detailHeader, title: t('nav.hqAdmin') }} />
                {/* M128 (owner: «صفحة الدفع مرمية فوق») — the embedded checkout gets the same gold
                    header and back arrow as every detail screen, on a white sheet. */}
                <Stack.Screen name="checkout/[id]" options={{ ...detailHeader, title: t('checkout.title'), contentStyle: { backgroundColor: '#FFFFFF' } }} />
                <Stack.Screen name="payment/[id]" options={{ ...detailHeader, title: t('nav.payment') }} />
                <Stack.Screen name="payments/index" options={{ ...detailHeader, title: t('nav.payments') }} />
                <Stack.Screen name="security" options={{ ...detailHeader, title: t('security.title') }} />
                <Stack.Screen name="security-extra" options={{ ...detailHeader, title: t('security.extraTitle') }} />
                <Stack.Screen name="delete-account" options={{ ...detailHeader, title: t('deleteAccount.title') }} />
                {/* M116d: club pages inside the app (terms, privacy…) — the screen sets its own title. */}
                <Stack.Screen name="webpage" options={{ ...detailHeader, title: '' }} />
                <Stack.Screen name="auth/login" options={{ ...detailHeader, title: t('nav.login') }} />
                <Stack.Screen name="auth/register" options={{ ...detailHeader, title: t('nav.register') }} />
                <Stack.Screen name="auth/verify" options={{ ...detailHeader, title: t('nav.verify') }} />
                <Stack.Screen name="auth/reset" options={{ ...detailHeader, title: t('nav.reset') }} />
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
          {/* M118 (owner): his golden-sparkles artwork flashes for a split second as the app opens. */}
          <SplashFlash />
          {/* M147 (owner): a Google/Apple-born account completes its profile before anything else opens. */}
          <ProfileCompletionGate />
          {/* M118d: the biometric app lock — covers everything while it waits for the face. */}
          <AppLockGate />
          {/* M137: the preview build is retired — a TEST binary shows only the «download the store app» cover. */}
          <RetiredBuildGate />
        </GuestGateProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

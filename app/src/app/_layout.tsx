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

import { AuthProvider } from '@/auth/AuthProvider';
import { GuestGate, GuestGateProvider } from '@/auth/GuestGate';
import { AskAdvisorButton, AskAdvisorProvider } from '@/components/advisor/AskAdvisor';
import { PushRegistrar } from '@/components/PushRegistrar';
import { ScreenTracker } from '@/components/ScreenTracker';
import { SyncPoller } from '@/components/SyncPoller';
import { initI18n, t } from '@/i18n';
import { isRTL, syncDirection } from '@/i18n/direction';
import { syncStrings } from '@/i18n/remote';
import { installNotificationHandler } from '@/lib/notifications';
import { colors, fonts } from '@/theme/tokens';

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
  headerTitleStyle: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.textPrimary },
  headerTitleAlign: 'center' as const,
  headerBackButtonDisplayMode: 'minimal' as const,
  headerShadowVisible: false,
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

  const ready = (fontsLoaded || fontError !== null) && i18nReady;
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
                <Stack.Screen name="membership" options={{ ...detailHeader, title: t('nav.membership') }} />
                <Stack.Screen name="profile-edit" options={{ ...detailHeader, title: t('nav.profileEdit') }} />
                <Stack.Screen name="news/[id]" options={{ ...detailHeader, title: t('nav.newsItem') }} />
                <Stack.Screen name="news/decisions" options={{ ...detailHeader, title: t('nav.decisions') }} />
                <Stack.Screen name="news/interests" options={{ ...detailHeader, title: t('nav.interests') }} />
                <Stack.Screen name="portal/entrepreneurs" options={{ ...detailHeader, title: t('nav.entrepreneurs') }} />
                <Stack.Screen name="services/index" options={{ ...detailHeader, title: t('nav.services') }} />
                <Stack.Screen name="service/[key]" options={{ ...detailHeader, title: t('nav.service') }} />
                <Stack.Screen name="videos/index" options={{ ...detailHeader, title: t('nav.videos') }} />
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
                <Stack.Screen name="about" options={{ ...detailHeader, title: t('nav.about') }} />
                <Stack.Screen name="hq/index" options={{ ...detailHeader, title: t('nav.hq') }} />
                <Stack.Screen name="hq/book" options={{ ...detailHeader, title: t('nav.hqBook') }} />
                <Stack.Screen name="hq/pass/[id]" options={{ ...detailHeader, title: t('nav.hqPass') }} />
                <Stack.Screen name="hq/admin" options={{ ...detailHeader, title: t('nav.hqAdmin') }} />
                <Stack.Screen name="payment/[id]" options={{ ...detailHeader, title: t('nav.payment') }} />
                <Stack.Screen name="payments/index" options={{ ...detailHeader, title: t('nav.payments') }} />
                <Stack.Screen name="auth/login" options={{ ...detailHeader, title: t('nav.login') }} />
                <Stack.Screen name="auth/register" options={{ ...detailHeader, title: t('nav.register') }} />
                <Stack.Screen name="auth/verify" options={{ ...detailHeader, title: t('nav.verify') }} />
                <Stack.Screen name="auth/reset" options={{ ...detailHeader, title: t('nav.reset') }} />
              </Stack>
            </LocaleProvider>
            {/* One floating «اسأل المستشار» for every screen that registered its context (useAdvisorScreen). */}
            <AskAdvisorButton />
          </AskAdvisorProvider>
          {/* The app opens for members: a visitor is sent to the gate, and again when his guest minute is over. */}
          <GuestGate />
        </GuestGateProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

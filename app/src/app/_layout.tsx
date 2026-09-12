import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { AuthProvider } from '@/auth/AuthProvider';
import { ensureRTL } from '@/i18n/rtl';
import { colors, fonts } from '@/theme/tokens';

ensureRTL();
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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.black },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="project/[id]" options={{ ...detailHeader, title: 'المشروع' }} />
          <Stack.Screen name="golden" options={{ ...detailHeader, title: 'المشاريع الذهبية' }} />
          <Stack.Screen name="membership" options={{ ...detailHeader, title: 'العضوية' }} />
          <Stack.Screen name="profile-edit" options={{ ...detailHeader, title: 'الملف الشخصي' }} />
          <Stack.Screen name="news/[id]" options={{ ...detailHeader, title: 'الخبر' }} />
          <Stack.Screen name="news/decisions" options={{ ...detailHeader, title: 'قرارات وأنظمة المملكة' }} />
          <Stack.Screen name="news/interests" options={{ ...detailHeader, title: 'اهتماماتي' }} />
          <Stack.Screen name="portal/entrepreneurs" options={{ ...detailHeader, title: 'بوابة رواد الأعمال' }} />
          <Stack.Screen name="services/index" options={{ ...detailHeader, title: 'خدمات النادي' }} />
          <Stack.Screen name="service/[key]" options={{ ...detailHeader, title: 'الخدمة' }} />
          <Stack.Screen name="videos/index" options={{ ...detailHeader, title: 'مكتبة الفيديو' }} />
          <Stack.Screen name="about" options={{ ...detailHeader, title: 'عنّا' }} />
          <Stack.Screen name="hq/index" options={{ ...detailHeader, title: 'مقر النادي' }} />
          <Stack.Screen name="hq/book" options={{ ...detailHeader, title: 'حجز زيارة' }} />
          <Stack.Screen name="hq/pass/[id]" options={{ ...detailHeader, title: 'باركود الدخول' }} />
          <Stack.Screen name="hq/admin" options={{ ...detailHeader, title: 'طلبات الزيارة' }} />
          <Stack.Screen name="payment/[id]" options={{ ...detailHeader, title: 'الدفع' }} />
          <Stack.Screen name="payments/index" options={{ ...detailHeader, title: 'مدفوعاتي' }} />
          <Stack.Screen name="auth/login" options={{ ...detailHeader, title: 'تسجيل الدخول' }} />
          <Stack.Screen name="auth/register" options={{ ...detailHeader, title: 'إنشاء حساب' }} />
          <Stack.Screen name="auth/verify" options={{ ...detailHeader, title: 'رمز التفعيل' }} />
          <Stack.Screen name="auth/reset" options={{ ...detailHeader, title: 'استعادة كلمة المرور' }} />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}

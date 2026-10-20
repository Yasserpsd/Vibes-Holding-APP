import { Redirect, useRouter } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthConfig } from '@/api/auth';
import { useHq } from '@/api/hq';
import { useGuestGate } from '@/auth/GuestGate';
import { AppButton } from '@/components/AppButton';
import { GoldGradient } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { languageChoiceOffered, t } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { colors, spacing, typography } from '@/theme/tokens';

// M106b (owner): the FULL original logo opens the app — whole, never cropped.
const clubLogo = require('../../assets/images/club-logo.png');

/**
 * The gate every visitor meets first: sign in, create an account, or browse as a guest — M109f:
 * guest mode is permanent, so the guest choice is always offered and never runs out.
 * M106b: the club theatre breathes FAINT behind the whole gate («اعمل من ورا شكل المسرح بشياكة
 * ويكون خفيف في الخلفية») — the first HQ photo at low opacity under a dark wash.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const { locked, startGuest } = useGuestGate();
  const { data: config } = useAuthConfig();
  const theatre = useHq().data?.photos?.[0] ?? null;

  if (!locked) return <Redirect href="/" />;

  return (
    <GoldGradient variant="screen" style={styles.backdrop}>
      {theatre ? <Image source={{ uri: theatre }} style={styles.theatre} resizeMode="cover" blurRadius={2} /> : null}
      <View style={styles.theatreWash} pointerEvents="none" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FadeInView delay={entranceDelay(0)} style={styles.hero}>
            <Image source={clubLogo} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
          </FadeInView>
          <FadeInView delay={entranceDelay(2)}>
            <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>
          </FadeInView>
          <View style={styles.actions}>
            <FadeInView delay={entranceDelay(3)}>
              <AppButton label={t('welcome.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
            </FadeInView>
            {config?.registrationOpen === false ? null : (
              <FadeInView delay={entranceDelay(4)}>
                <AppButton label={t('welcome.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
              </FadeInView>
            )}
            <FadeInView delay={entranceDelay(5)}>
              <AppButton label={t('welcome.guest')} variant="outline" icon="eye-outline" onPress={startGuest} />
            </FadeInView>
            <FadeInView delay={entranceDelay(6)}>
              <Text style={styles.hint}>{t('welcome.guestHint')}</Text>
            </FadeInView>
          </View>
          {languageChoiceOffered(false) ? (
            <FadeInView delay={entranceDelay(8)}>
              <PressScale onPress={chooseLanguage} hitSlop={8}>
                <Text style={styles.language}>{t('welcome.language')}</Text>
              </PressScale>
            </FadeInView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </GoldGradient>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.black },
  // M106b: the theatre, faint and classy, under a dark wash that keeps every word readable.
  theatre: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 },
  theatreWash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7, 7, 8, 0.72)' },
  safeArea: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  hero: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  logo: { width: 230, height: 190 },
  title: { ...typography.title, color: colors.gold, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  actions: { gap: spacing.sm + 4, marginTop: spacing.md },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  language: { ...typography.body, color: colors.goldLight, textAlign: 'center', paddingVertical: spacing.sm },
});

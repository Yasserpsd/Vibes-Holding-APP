import { Redirect, useRouter } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthConfig } from '@/api/auth';
import { useHq } from '@/api/hq';
import { useGuestGate } from '@/auth/GuestGate';
import { AppButton } from '@/components/AppButton';
import { GoldGradient } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { languageChoiceOffered, t } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { colors, spacing, typography } from '@/theme/tokens';

// M106b (owner): the FULL original logo opens the app — whole, never cropped.
const clubLogo = require('../../assets/images/club-logo.png');

/**
 * The gate every visitor meets first: sign in, create an account, or look around as a guest for one
 * minute. When the minute is over the same screen comes back without the guest choice. Preview builds
 * sign in the club's admins only (CLAUDE.md rule 9), so the testers keep the guest choice there.
 * M106b: the club theatre breathes FAINT behind the whole gate («اعمل من ورا شكل المسرح بشياكة
 * ويكون خفيف في الخلفية») — the first HQ photo at low opacity under a dark wash.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const { locked, guestOver, startGuest } = useGuestGate();
  const { data: config } = useAuthConfig();
  const theatre = useHq().data?.photos?.[0] ?? null;

  if (!locked) return <Redirect href="/" />;

  const testBuild = config?.adminOnly === true;
  const guestOffered = !guestOver || testBuild;

  return (
    <GoldGradient variant="screen" style={styles.backdrop}>
      {theatre ? <Image source={{ uri: theatre }} style={styles.theatre} resizeMode="cover" blurRadius={2} /> : null}
      <View style={styles.theatreWash} pointerEvents="none" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FadeInView delay={entranceDelay(0)} style={styles.hero}>
            <Image source={clubLogo} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
          </FadeInView>
          {/* The full logo already carries the club's name: the title line returns only for the guest-over notice. */}
          {guestOver ? (
            <FadeInView delay={entranceDelay(1)}>
              <Text style={styles.title}>{t('welcome.returnTitle')}</Text>
            </FadeInView>
          ) : null}
          <FadeInView delay={entranceDelay(2)}>
            <Text style={styles.subtitle}>{guestOver ? t('welcome.returnText') : t('welcome.subtitle')}</Text>
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
            {guestOffered ? (
              <>
                <FadeInView delay={entranceDelay(5)}>
                  <AppButton label={t('welcome.guest')} variant="outline" icon="eye-outline" onPress={startGuest} />
                </FadeInView>
                <FadeInView delay={entranceDelay(6)}>
                  <Text style={styles.hint}>{t('welcome.guestHint')}</Text>
                </FadeInView>
              </>
            ) : null}
          </View>
          {testBuild && guestOver ? (
            <FadeInView delay={entranceDelay(7)}>
              <Notice tone="warning" text={t('welcome.testNote')} />
            </FadeInView>
          ) : null}
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

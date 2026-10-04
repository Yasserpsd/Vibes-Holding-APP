import { Redirect, useRouter } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthConfig } from '@/api/auth';
import { useGuestGate } from '@/auth/GuestGate';
import { AppButton } from '@/components/AppButton';
import { GoldGradient } from '@/components/lux';
import { entranceDelay, FadeInView, Floating, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { languageChoiceOffered, t } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

const clubEmblem = require('../../assets/images/club-emblem.png');

/**
 * The gate every visitor meets first: sign in, create an account, or look around as a guest for one
 * minute. When the minute is over the same screen comes back without the guest choice. Preview builds
 * sign in the club's admins only (CLAUDE.md rule 9), so the testers keep the guest choice there.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const { locked, guestOver, startGuest } = useGuestGate();
  const { data: config } = useAuthConfig();

  if (!locked) return <Redirect href="/" />;

  const testBuild = config?.adminOnly === true;
  const guestOffered = !guestOver || testBuild;

  return (
    <GoldGradient variant="screen" style={styles.backdrop}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FadeInView delay={entranceDelay(0)} style={styles.hero}>
            <View style={styles.halo} />
            <Floating>
              <Image source={clubEmblem} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
            </Floating>
          </FadeInView>
          <FadeInView delay={entranceDelay(1)}>
            <Text style={styles.title}>{guestOver ? t('welcome.returnTitle') : t('common.clubName')}</Text>
          </FadeInView>
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
  safeArea: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  hero: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  // The soft golden halo breathing behind the floating emblem — the screen's single hero glow.
  halo: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: radii.pill,
    backgroundColor: colors.goldFaint,
    boxShadow: shadows.glowGoldStrong,
  },
  logo: { width: 112, height: 112 },
  title: { ...typography.title, color: colors.gold, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  actions: { gap: spacing.sm + 4, marginTop: spacing.md },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  language: { ...typography.body, color: colors.goldLight, textAlign: 'center', paddingVertical: spacing.sm },
});

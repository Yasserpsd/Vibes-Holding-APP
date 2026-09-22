import { Redirect, useRouter } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthConfig } from '@/api/auth';
import { useGuestGate } from '@/auth/GuestGate';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { languageChoiceOffered, t } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { colors, spacing, typography } from '@/theme/tokens';

const clubLogo = require('../../assets/images/club-logo.png');

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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image source={clubLogo} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
        <Text style={styles.title}>{guestOver ? t('welcome.returnTitle') : t('common.clubName')}</Text>
        <Text style={styles.subtitle}>{guestOver ? t('welcome.returnText') : t('welcome.subtitle')}</Text>
        <View style={styles.actions}>
          <AppButton label={t('welcome.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
          {config?.registrationOpen === false ? null : (
            <AppButton label={t('welcome.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
          )}
          {guestOffered ? (
            <>
              <AppButton label={t('welcome.guest')} variant="outline" icon="eye-outline" onPress={startGuest} />
              <Text style={styles.hint}>{t('welcome.guestHint')}</Text>
            </>
          ) : null}
        </View>
        {testBuild && guestOver ? <Notice tone="warning" text={t('welcome.testNote')} /> : null}
        {languageChoiceOffered(false) ? (
          <Pressable onPress={chooseLanguage} accessibilityRole="button" hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.language}>{t('welcome.language')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.black },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  logo: { width: 112, height: 112, alignSelf: 'center' },
  title: { ...typography.title, color: colors.gold, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  actions: { gap: spacing.sm + 4, marginTop: spacing.md },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  language: { ...typography.body, color: colors.goldLight, textAlign: 'center', paddingVertical: spacing.sm },
  pressed: { opacity: 0.7 },
});

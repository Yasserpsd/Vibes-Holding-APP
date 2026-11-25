import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi, useAuthConfig } from '@/api/auth';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useGuestGate } from '@/auth/GuestGate';
import { AppButton } from '@/components/AppButton';
import { AuthHero, useAuthPhotos } from '@/components/AuthPhotos';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { EMPTY_IDENTIFIER, identifierPhoneProblem, identifierValid, LoginIdentifierField, type Identifier } from '@/components/LoginIdentifier';
import { GoldGradient, GoldHairline } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { SocialButtons } from '@/components/SocialButtons';
import { languageChoiceOffered, t } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { passwordRoad, quickStepPath } from '@/lib/quickEntry';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

// M106b (owner): the FULL original logo opens the app — whole, never cropped.
const clubLogo = require('../../assets/images/club-logo.png');

/** True while the keyboard is up. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

/**
 * The gate every visitor meets first — M109f: guest mode is permanent, so the guest choice is always offered.
 * M106b: the club theatre breathes behind it; M270 (owner, 2026-11-25) made it a real photograph that fills the top
 * edge to edge and melts into the background, with the gate's content at the foot of the screen.
 * M272 (owner, 2026-11-25: «يدخل الرقم ولو مفيش عليه حساب يجيله كود واتس اب وبعدين يكمل تسجيل، ولو في حساب بالفعل
 * يجيله كود ويدخل بدل الهري ده كله»): one number field and one gold button stand where «تسجيل الدخول» and «إنشاء حساب
 * جديد» stood. Everything else stays below in small type. A server that cannot answer the field (`quickEntry` false)
 * keeps the two buttons.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const { locked, startGuest } = useGuestGate();
  const { sessionExpired, dismissSessionExpired } = useAuth();
  const { data: config, refetch: refetchConfig } = useAuthConfig();
  // The answer is kept on the phone between launches: the gate asks again each time it is drawn, so a field the
  // server has since switched off gives way to the two buttons.
  useEffect(() => {
    void refetchConfig();
  }, [refetchConfig]);
  const photos = useAuthPhotos();
  const [identifier, setIdentifier] = useState<Identifier>(EMPTY_IDENTIFIER);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const typing = useKeyboardOpen();
  const scroll = useRef<ScrollView>(null);
  // Where the logo starts on the screen: the photograph behind stays clear above it and darkens from there.
  const insets = useSafeAreaInsets();
  const [logoY, setLogoY] = useState<number | undefined>(undefined);

  if (!locked) return <Redirect href="/" />;

  // Drawn before the config answers: the field is what nearly every server offers, and a late «no» swaps the buttons in.
  const quick = config ? Boolean(config.quickEntry) : true;

  const enter = async () => {
    if (busy) return;
    const problem = !identifierValid(identifier) ? t('quick.numberRequired') : identifierPhoneProblem(identifier, config?.countries);
    if (problem) {
      setFailure({ message: problem, code: 'local' });
      return;
    }
    const number = identifier.value.trim();
    setBusy(true);
    setFailure(null);
    try {
      const step = await authApi.quickStart(number, identifier.country);
      Keyboard.dismiss();
      router.push(quickStepPath(step, number, identifier.country));
    } catch (cause) {
      // The keyboard goes either way: a refusal must leave the other ways in on the screen.
      Keyboard.dismiss();
      if (cause instanceof ApiError && cause.code === 'code_login_off') void refetchConfig();
      const road = passwordRoad(cause, number, identifier.country);
      if (road) router.push(road);
      else setFailure(failureOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const guest = () => {
    dismissSessionExpired();
    startGuest();
  };

  return (
    <GoldGradient variant="screen" style={styles.backdrop}>
      {photos.length ? <AuthHero photos={photos} logoTop={logoY === undefined ? undefined : logoY + insets.top} logoHeight={quick ? 150 : 190} /> : null}
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.safeArea} behavior="padding">
          <ScrollView
            ref={scroll}
            contentContainerStyle={[styles.content, photos.length ? styles.contentLow : null]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollsChildToFocus={false}
            // With the keyboard up the field and its button are the foot of the content: keep them in view.
            onContentSizeChange={() => (typing ? scroll.current?.scrollToEnd({ animated: false }) : undefined)}
            onLayout={() => (typing ? scroll.current?.scrollToEnd({ animated: false }) : undefined)}
          >
            <View onLayout={(event) => setLogoY(Math.round(event.nativeEvent.layout.y))}>
              <FadeInView delay={entranceDelay(0)} style={styles.hero}>
                {/* The field and its button need the room: the logo is a size smaller on the quick-entry gate. */}
                <Image source={clubLogo} style={[styles.logo, quick ? styles.logoCompact : null]} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
              </FadeInView>
            </View>
            <FadeInView delay={entranceDelay(2)}>
              <Text style={styles.subtitle}>{t(quick ? 'quick.subtitle' : 'welcome.subtitle')}</Text>
            </FadeInView>
            <View style={styles.actions}>
              {/* The saved session was refused when the app opened: say why the member is back at the gate, once. */}
              {sessionExpired ? (
                <FadeInView delay={entranceDelay(3)}>
                  <Notice tone="warning" text={t('errors.code.session_expired')} />
                </FadeInView>
              ) : null}
              {quick ? (
                <>
                  <FadeInView delay={entranceDelay(3)}>
                    <LoginIdentifierField
                      phoneOnly
                      value={identifier}
                      onChange={(value) => {
                        setIdentifier(value);
                        setFailure(null);
                      }}
                      onSubmit={() => void enter()}
                      countries={config?.countries}
                    />
                  </FadeInView>
                  {failure ? (
                    <FadeInView offset={8}>
                      <FormFailure failure={failure} onRetry={() => void enter()} />
                    </FadeInView>
                  ) : null}
                  <FadeInView delay={entranceDelay(4)}>
                    <AppButton label={t('quick.submit')} icon="logo-whatsapp" loading={busy} onPress={() => void enter()} />
                  </FadeInView>
                </>
              ) : (
                <>
                  <FadeInView delay={entranceDelay(3)}>
                    <AppButton label={t('welcome.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
                  </FadeInView>
                  {config?.registrationOpen === false ? null : (
                    <FadeInView delay={entranceDelay(4)}>
                      <AppButton label={t('welcome.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
                    </FadeInView>
                  )}
                </>
              )}
              {/* While the number is being typed only the field, its button and the small guest line stay above the
                  keyboard (owner, 2026-11-25: «يقدر يكمل بدون تسجيل بزرار صغير خالص تحت: متابعة كضيف»). */}
              {typing ? (
                <PressScale onPress={guest} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.guestSmall}>{t('welcome.guest')}</Text>
                </PressScale>
              ) : (
                <>
                  {quick ? (
                    <>
                      <View style={styles.divider}>
                        <GoldHairline style={styles.line} />
                        <Text style={styles.or}>{t('quick.or')}</Text>
                        <GoldHairline style={styles.line} />
                      </View>
                      {/* Apple and Google stay full buttons (App Review wants Sign in with Apple beside any social sign-in). */}
                      <SocialButtons bare onError={(message) => setFailure({ message, code: 'social' })} />
                      <PressScale onPress={() => router.push('/auth/login?password=1')} accessibilityRole="button" hitSlop={8}>
                        <Text style={styles.link}>{t('quick.withPassword')}</Text>
                      </PressScale>
                    </>
                  ) : null}
                  <PressScale onPress={guest} accessibilityRole="button" hitSlop={8}>
                    <Text style={quick ? styles.guestSmall : styles.link}>{t('welcome.guest')}</Text>
                  </PressScale>
                  <Text style={styles.hint}>{t('welcome.guestHint')}</Text>
                </>
              )}
            </View>
            {!typing && languageChoiceOffered(false) ? (
              <FadeInView delay={entranceDelay(8)}>
                <PressScale onPress={chooseLanguage} hitSlop={8}>
                  <Text style={styles.language}>{t('welcome.language')}</Text>
                </PressScale>
              </FadeInView>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </GoldGradient>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.black },
  safeArea: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  // Under a photograph the content rests at the foot of the screen, so the picture's clear top stays in view.
  contentLow: { justifyContent: 'flex-end' },
  hero: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  logo: { width: 230, height: 190 },
  logoCompact: { width: 182, height: 150 },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  actions: { gap: spacing.sm + 4, marginTop: spacing.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { flex: 1 },
  or: { ...typography.caption, color: colors.textMuted },
  link: { ...typography.body, color: colors.goldLightText, textAlign: 'center', paddingVertical: spacing.xs },
  guestSmall: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', textDecorationLine: 'underline', paddingVertical: spacing.xs },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  language: { ...typography.body, color: colors.goldLightText, textAlign: 'center', paddingVertical: spacing.sm },
}));

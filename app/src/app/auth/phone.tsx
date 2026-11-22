import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Keyboard } from 'react-native';

import { authApi, type PhoneStepResult } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';

/** M259: `flow=code` — this code IS the sign-in (no password came before it). */
type Params = { stepToken?: string; via?: string; phone?: string; email?: string; seconds?: string; resendAfter?: string; flow?: string };

/**
 * M203 (owner, 2026-11-06): after a sign-out, every new sign-in ends here, Apple and Google included. The session
 * starts with the right code. A code that came by e-mail lets the member in with the number still unproven, so he
 * lands on the number field: the next sign-in would go to the same wrong number otherwise.
 */
export default function PhoneCodeScreen() {
  const params = useLocalSearchParams<Params>();
  const router = useRouter();
  const { signIn } = useAuth();
  const step: PhoneStepResult = {
    pending: false,
    phoneStep: true,
    stepToken: params.stepToken ?? '',
    via: params.via === 'email' ? 'email' : 'whatsapp',
    phone: params.phone ?? '',
    email: params.email ?? '',
    seconds: Number(params.seconds) || 600,
    resendAfter: Number(params.resendAfter) || 60,
  };

  const submit = async (code: string) => {
    if (params.flow === 'code') {
      const signed = await authApi.codeLoginVerify(step.stepToken, code);
      // Emulator pass 2026-11-22: the code was accepted and the keyboard stayed up over the screen that followed.
      Keyboard.dismiss();
      // M140: an account with an authenticator app finishes on its code screen.
      if ('totp' in signed) {
        router.replace(`/auth/totp?stepToken=${encodeURIComponent(signed.stepToken)}` as Href);
        return;
      }
      await signIn(signed.token, signed.me);
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
      return;
    }
    const result = await authApi.phoneVerify(step.stepToken, code);
    Keyboard.dismiss();
    await signIn(result.token, result.me);
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/account');
    if (result.fixPhone) router.push('/profile-edit?fixPhone=1' as Href);
  };

  // No step token (a stale link or a restored screen without its params): there is nothing to confirm, so the way back is offered.
  if (!step.stepToken) {
    return (
      <Screen title={t('phoneCode.title')}>
        <FadeInView delay={entranceDelay(0)}>
          <Notice tone="warning" text={t('auth.totp.expired')} />
        </FadeInView>
        <FadeInView delay={entranceDelay(1)}>
          <AppButton label={t('auth.verify.backToLogin')} icon="arrow-undo-outline" onPress={() => router.replace('/auth/login')} />
        </FadeInView>
      </Screen>
    );
  }

  return (
    <Screen title={t('phoneCode.title')} subtitle={t('phoneCode.subtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <PhoneCodeStep step={step} onSubmit={submit} />
      </FadeInView>
    </Screen>
  );
}

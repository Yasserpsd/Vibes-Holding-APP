import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { authApi, type PhoneStepResult } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { entranceDelay, FadeInView } from '@/components/motion';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';

type Params = { stepToken?: string; via?: string; phone?: string; email?: string; seconds?: string; resendAfter?: string };

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
    const result = await authApi.phoneVerify(step.stepToken, code);
    await signIn(result.token, result.me);
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/account');
    if (result.fixPhone) router.push('/profile-edit?fixPhone=1' as Href);
  };

  return (
    <Screen title={t('phoneCode.title')} subtitle={t('phoneCode.subtitle')}>
      <FadeInView delay={entranceDelay(0)}>
        <PhoneCodeStep step={step} onSubmit={submit} />
      </FadeInView>
    </Screen>
  );
}

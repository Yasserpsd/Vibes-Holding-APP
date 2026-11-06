import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { authApi, type PhoneStepResult } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneCodeStep } from '@/components/PhoneCodeStep';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';

/**
 * M203 (owner, 2026-11-06: «اي حساب مش مفعل رقمه يطلعه تنبيه انه لازم يأكد رقمه لزيادة تأمين الحساب»): the registered
 * number proves itself from an open session. A wrong number leaves for the profile editor, where a new one passes its code.
 */
export default function PhoneConfirmScreen() {
  const router = useRouter();
  const { setMe } = useAuth();
  const [step, setStep] = useState<PhoneStepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  const start = () => {
    setError(null);
    authApi.phoneCurrent().then(setStep, (cause: unknown) => setError(errorMessage(cause)));
  };

  useEffect(() => {
    // One paid message per visit: a re-render must never ask for another code.
    if (asked.current) return;
    asked.current = true;
    start();
  }, []);

  return (
    <Screen title={t('phoneCode.title')} subtitle={t('phoneAlert.text')}>
      <FadeInView delay={entranceDelay(0)}>
        {step ? (
          <PhoneCodeStep
            step={step}
            onBack={() => router.replace('/profile-edit?fixPhone=1' as Href)}
            onSubmit={async (code) => {
              const { me } = await authApi.phoneConfirm(step.stepToken, code);
              setMe(me);
              router.back();
            }}
          />
        ) : error ? (
          <>
            <Notice tone="warning" text={error} support />
            <AppButton label={t('common.retry')} icon="refresh-outline" variant="outline" onPress={start} />
          </>
        ) : (
          <StateView loading />
        )}
      </FadeInView>
    </Screen>
  );
}

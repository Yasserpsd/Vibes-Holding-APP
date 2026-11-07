import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import type { ScrollView } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { CountryPicker } from '@/components/CountryPicker';
import { FormCard } from '@/components/form/FormTheme';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PhoneProofField, type PhoneProofState } from '@/components/PhoneProofField';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { trackRegistration } from '@/lib/adsAttribution';
import { markIntroDue } from '@/lib/introGate';
import { phoneIssue } from '@/lib/validation';

type Params = { signupToken?: string; provider?: string };

/**
 * M211 (owner, 2026-11-07: «اي شخص بيسجل جديد… لازم يأكد رقمه»): a first Google or Apple sign-in ends here. The server
 * holds the identity and creates the account only with the proven number, so leaving this screen leaves nothing behind.
 */
export default function SocialPhoneScreen() {
  const { signupToken, provider } = useLocalSearchParams<Params>();
  const router = useRouter();
  const { signIn } = useAuth();
  const { data: config, isLoading, error: configError, refetch } = useAuthConfig();
  const scrollRef = useRef<ScrollView | null>(null);
  const [country, setCountry] = useState('sa');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [proof, setProof] = useState<PhoneProofState>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const land = config?.countries.find((item) => item.code === country) ?? config?.countries[0];
  const phoneExample = land?.example ? land.example.replace(/^0+/, '') : '';

  const complete = async (token: string) => {
    if (busy || !signupToken) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.socialComplete(signupToken, token);
      // M209: a brand-new account owes the intro film once; marked BEFORE the session is announced.
      if (result.created) markIntroDue();
      await signIn(result.token, result.me);
      if (result.created) trackRegistration(provider === 'apple' ? 'apple' : 'google');
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const change = (next: PhoneProofState) => {
    setProof(next);
    if (next?.kind === 'done') void complete(next.token);
  };

  const check = () => {
    if (phoneIssue(phone, land) === null) return true;
    setPhoneError(phoneExample ? t('form.error.phone', { example: phoneExample }) : t('form.error.phoneNoExample'));
    return false;
  };

  if (!config) {
    return (
      <Screen title={t('phoneCode.title')}>
        <StateView loading={isLoading} error={configError} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen title={t('phoneCode.title')} subtitle={t('phoneProof.socialSubtitle')} scrollRef={scrollRef}>
      <FadeInView delay={entranceDelay(0)}>
        <FormCard tone="light">
          <CountryPicker
            label={t('auth.register.country')}
            countries={config.countries}
            selected={country}
            onSelect={(value) => {
              setCountry(value);
              setProof(null);
              setPhoneError(null);
            }}
          />
          <FormField
            label={t('auth.register.phone')}
            latin
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            editable={!proof}
            value={phone}
            onChangeText={(value) => {
              setPhone(value.replace(/\D+/g, '').replace(/^0+/, ''));
              setPhoneError(null);
            }}
            placeholder={phoneExample || undefined}
            error={phoneError}
          />
          <PhoneProofField phone={phone} country={country} state={proof} onChange={change} check={check} />
          {error ? <Notice tone="warning" text={error} support /> : null}
          {error && proof?.kind === 'done' ? (
            <AppButton label={t('phoneProof.finish')} icon="person-add-outline" loading={busy} onPress={() => void complete(proof.token)} />
          ) : null}
        </FormCard>
      </FadeInView>
    </Screen>
  );
}

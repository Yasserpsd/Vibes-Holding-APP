import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { ApiError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { fonts } from '@/theme/tokens';

type Params = { pendingToken?: string; email?: string; text?: string };

export default function VerifyScreen() {
  const { pendingToken, email, text } = useLocalSearchParams<Params>();
  const router = useRouter();
  const { signIn } = useAuth();
  const { data: config } = useAuthConfig();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(text ?? null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(!pendingToken);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const finish = () => {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/account');
  };

  const submit = async () => {
    if (busy || !pendingToken) return;
    if (!/^\d{6}$/.test(code)) {
      setError('اكتب الرمز المكوّن من 6 أرقام');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.verify(pendingToken, code);
      await signIn(result.token, result.me);
      finish();
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && (cause.status === 410 || cause.status === 403)) setExpired(true);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy || cooldown > 0 || !pendingToken) return;
    setError(null);
    try {
      const result = await authApi.resend(pendingToken);
      setInfo(result.text || 'أعدنا إرسال الرمز');
      setCooldown(60);
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 410) setExpired(true);
    }
  };

  return (
    <Screen title="رمز التفعيل" subtitle={`أرسلنا رمزًا من 6 أرقام إلى ${email || 'بريدك الإلكتروني'}. الرمز صالح 30 دقيقة.`}>
      {info ? <Notice tone="success" text={info} /> : null}
      {config?.testCode ? <Notice tone="warning" text={`وضع الاختبار: الرمز هو ${config.testCode}`} /> : null}
      <FormField
        label="الرمز"
        latin
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={6}
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
        onSubmitEditing={() => void submit()}
        error={error}
        style={styles.code}
        editable={!expired}
      />
      {expired ? (
        <AppButton label="العودة لتسجيل الدخول" icon="arrow-undo-outline" onPress={() => router.replace('/auth/login')} />
      ) : (
        <>
          <AppButton label={busy ? 'جارٍ التحقق…' : 'تأكيد'} icon="checkmark-circle-outline" onPress={() => void submit()} />
          <AppButton
            label={cooldown > 0 ? `إعادة الإرسال بعد ${cooldown} ثانية` : 'إعادة إرسال الرمز'}
            variant="outline"
            icon="mail-outline"
            onPress={() => void resend()}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.semiBold, fontSize: 24, letterSpacing: 8, textAlign: 'center' },
});

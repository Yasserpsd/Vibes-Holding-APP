import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/theme/tokens';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { data: config } = useAuthConfig();
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (busy) return;
    if (login.trim().length < 3) {
      setError('اكتب البريد الإلكتروني أو رقم الجوال المسجّل');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.resetRequest(login.trim());
      setStep('confirm');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError('اكتب الرمز المكوّن من 6 أرقام');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور الجديدة 6 أحرف على الأقل');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.resetConfirm(login.trim(), code, password);
      setStep('done');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <Screen title="استعادة كلمة المرور">
        <Notice tone="success" text="تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة." />
        <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.replace('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen
      title="استعادة كلمة المرور"
      subtitle={step === 'request' ? 'يصلك رمز من 6 أرقام على بريدك الإلكتروني المسجّل.' : `أرسلنا الرمز إلى بريد الحساب ${login.trim()}. الرمز صالح 20 دقيقة.`}
    >
      {step === 'confirm' && config?.testCode ? <Notice tone="warning" text={`وضع الاختبار: الرمز هو ${config.testCode}`} /> : null}
      <FormField
        label="البريد الإلكتروني أو رقم الجوال"
        latin
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={login}
        onChangeText={setLogin}
        editable={step === 'request'}
      />
      {step === 'confirm' ? (
        <>
          <FormField label="الرمز" latin keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} />
          <FormField label="كلمة المرور الجديدة" latin secureTextEntry autoCapitalize="none" textContentType="newPassword" value={password} onChangeText={setPassword} hint="6 أحرف على الأقل" />
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {step === 'request' ? (
        <AppButton label={busy ? 'جارٍ الإرسال…' : 'إرسال الرمز'} icon="mail-outline" onPress={() => void request()} />
      ) : (
        <AppButton label={busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'} icon="key-outline" onPress={() => void confirm()} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: 'right' },
});

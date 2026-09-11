import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { colors, spacing, typography } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { data: config } = useAuthConfig();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!login.trim() || !password) {
      setError('اكتب البريد الإلكتروني أو رقم الجوال وكلمة المرور');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.login(login.trim(), password);
      if (result.pending) {
        router.push({ pathname: '/auth/verify', params: { pendingToken: result.pendingToken, email: result.email, text: result.text } });
        return;
      }
      await signIn(result.token, result.me);
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="تسجيل الدخول" subtitle="بنفس حساب نادي المستثمرين الذي تستخدمه على مواقع المنظومة.">
      {config?.adminOnly ? <Notice text="النسخة التجريبية: الدخول متاح لحسابات إدارة النادي فقط." /> : null}
      <FormField
        label="البريد الإلكتروني أو رقم الجوال"
        latin
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        value={login}
        onChangeText={setLogin}
        placeholder="name@gmail.com أو 0558318777"
      />
      <FormField
        label="كلمة المرور"
        latin
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? 'جارٍ الدخول…' : 'دخول'} icon="log-in-outline" onPress={() => (busy ? undefined : void submit())} />
      <Link href="/auth/reset" style={styles.link}>
        نسيت كلمة المرور؟
      </Link>
      {config?.registrationOpen === false ? null : (
        <AppButton label="إنشاء حساب جديد" variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { ...typography.caption, color: colors.danger, textAlign: 'right' },
  link: { ...typography.body, color: colors.goldLight, textAlign: 'center', paddingVertical: spacing.sm },
});

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthConfig } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { AdvisorChat, type ChatContext } from '@/components/advisor/AdvisorChat';
import { AppButton } from '@/components/AppButton';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { colors, spacing } from '@/theme/tokens';

/** Set by «اسأل المستشار» on a project page; the nonce makes every tap a new request. */
type ContextParams = { ctxType?: string; ctxId?: string; ctxTitle?: string; ctxNonce?: string };

function incomingContext(params: ContextParams): (ChatContext & { key: string }) | null {
  const key = `${params.ctxType ?? ''}:${params.ctxId ?? ''}:${params.ctxNonce ?? ''}`;
  if (params.ctxType === 'news') {
    const id = params.ctxId ?? '';
    if (!/^[a-f0-9]{16}$/.test(id)) return null;
    return { key, type: 'news', id, title: params.ctxTitle?.trim() || 'خبر' };
  }
  const id = Number(params.ctxId);
  if (params.ctxType !== 'project' || !Number.isInteger(id) || id <= 0) return null;
  return { key, type: 'project', id, title: params.ctxTitle?.trim() || `مشروع ${id}` };
}

export default function AdvisorScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data: config } = useAuthConfig();
  const params = useLocalSearchParams<ContextParams>();
  const [handledKey, setHandledKey] = useState<string | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);

  const incoming = incomingContext(params);
  if (incoming && incoming.key !== handledKey) {
    setHandledKey(incoming.key);
    setContext(incoming.type === 'news' ? { type: 'news', id: incoming.id, title: incoming.title } : { type: 'project', id: incoming.id, title: incoming.title });
  }

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.gold} size="large" />
      </SafeAreaView>
    );
  }

  if (status === 'guest') {
    return (
      <PlaceholderScreen
        title="المستشار"
        description="سجّل الدخول لتتحدث مع مستشار النادي الذكي. محادثتك واحدة على موقع النادي وفي التطبيق، بنفس الحساب."
      >
        <View style={styles.actions}>
          <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/auth/login')} />
          {config?.registrationOpen === false ? null : (
            <AppButton label="إنشاء حساب" variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
          )}
        </View>
      </PlaceholderScreen>
    );
  }

  return <AdvisorChat key={me?.id ?? 'me'} context={context} onClearContext={() => setContext(null)} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
  actions: { gap: spacing.sm, alignSelf: 'stretch' },
});

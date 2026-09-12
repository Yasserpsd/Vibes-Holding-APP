import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthConfig } from '@/api/auth';
import { useHomeContent } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { AdvisorChat, type ChatContext, type ChatOpening } from '@/components/advisor/AdvisorChat';
import { AppButton } from '@/components/AppButton';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { colors, spacing } from '@/theme/tokens';

/**
 * Set by «اسأل المستشار» on a project or news page, by the home portals and by services;
 * the nonce makes every tap a new request. `prompt` is a suggested first message.
 */
type ContextParams = { ctxType?: string; ctxId?: string; ctxTitle?: string; ctxNonce?: string; prompt?: string };

type Incoming = { key: string; context: ChatContext; prompt: string | null };

function incomingContext(params: ContextParams): Incoming | null {
  const key = `${params.ctxType ?? ''}:${params.ctxId ?? ''}:${params.ctxNonce ?? ''}`;
  const title = params.ctxTitle?.trim() ?? '';
  const prompt = params.prompt?.trim() || null;
  if (params.ctxType === 'news') {
    const id = params.ctxId ?? '';
    if (!/^[a-f0-9]{16}$/.test(id)) return null;
    return { key, context: { type: 'news', id, title: title || 'خبر' }, prompt };
  }
  if (params.ctxType === 'portal') {
    const id = params.ctxId;
    if (id !== 'investor' && id !== 'entrepreneur' && id !== 'neutral') return null;
    return { key, context: { type: 'portal', id, title: title || 'البوابة' }, prompt };
  }
  if (params.ctxType === 'service') {
    const id = params.ctxId ?? '';
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return null;
    return { key, context: { type: 'service', id, title: title || 'الخدمة' }, prompt };
  }
  const id = Number(params.ctxId);
  if (params.ctxType !== 'project' || !Number.isInteger(id) || id <= 0) return null;
  return { key, context: { type: 'project', id, title: title || `مشروع ${id}` }, prompt };
}

export default function AdvisorScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data: config } = useAuthConfig();
  const home = useHomeContent();
  const params = useLocalSearchParams<ContextParams>();
  const [handledKey, setHandledKey] = useState<string | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  const incoming = incomingContext(params);
  if (incoming && incoming.key !== handledKey) {
    setHandledKey(incoming.key);
    setContext(incoming.context);
    setPrompt(incoming.prompt);
  }

  // The neutral portal lets the advisor open the conversation (server copy); a service suggests its first message.
  const opening = useMemo<ChatOpening | null>(() => {
    if (context?.type === 'portal' && context.id === 'neutral' && home.data) return home.data.neutralOpening;
    if (context?.type === 'service' && prompt) return { title: context.title, text: 'يمكنني مساعدتك في هذه الخدمة، ابدأ بسؤالك أو اختر الاقتراح.', quickReplies: [prompt] };
    return null;
  }, [context, prompt, home.data]);

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

  return (
    <AdvisorChat
      key={me?.id ?? 'me'}
      context={context}
      opening={opening}
      onClearContext={() => {
        setContext(null);
        setPrompt(null);
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
  actions: { gap: spacing.sm, alignSelf: 'stretch' },
});

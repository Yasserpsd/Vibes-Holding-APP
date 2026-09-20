import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthConfig } from '@/api/auth';
import { useHomeContent } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { AdvisorChat } from '@/components/advisor/AdvisorChat';
import { openingFor, parseContextParams, type ChatContext, type ChatOpening, type ContextParams } from '@/components/advisor/context';
import { AppButton } from '@/components/AppButton';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { colors, spacing } from '@/theme/tokens';

export default function AdvisorScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data: config } = useAuthConfig();
  const home = useHomeContent();
  const params = useLocalSearchParams<ContextParams>();
  const [handledKey, setHandledKey] = useState<string | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  // Set by the floating «اسأل المستشار» button, the inline «ناقش … مع المستشار» buttons, the home portals and services.
  const incoming = parseContextParams(params);
  if (incoming && incoming.key !== handledKey) {
    setHandledKey(incoming.key);
    setContext(incoming.context);
    setPrompt(incoming.prompt);
  }

  // The neutral portal lets the advisor open the conversation (server copy); every other context opens with
  // starter questions that fit it, a service's suggested first message leading them.
  const opening = useMemo<ChatOpening | null>(() => {
    if (!context) return null;
    if (context.type === 'portal' && context.id === 'neutral' && home.data) return home.data.neutralOpening;
    return openingFor(context, prompt);
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

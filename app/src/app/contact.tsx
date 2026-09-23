import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, errorMessage } from '@/api/client';
import { contactApi, useContactThread, type ContactMessage } from '@/api/contact';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M36: «راسل الإدارة» — a member with an active annual membership writes to the management at any
 * time; a guest is walked to sign-in and an unactivated account to the membership screen. The
 * thread polls while open, and the management's reply also lands as a push (PushRegistrar).
 */
export default function ContactScreen() {
  const { status, me } = useAuth();
  const router = useRouter();
  const active = status === 'signedIn' && me?.membership.status === 'active';
  const query = useContactThread(active);
  const refusedMeanwhile = query.error instanceof ApiError && query.error.status === 403;

  let body;
  if (status === 'loading') {
    body = <StateView loading />;
  } else if (status === 'guest') {
    body = (
      <View style={styles.gate}>
        <Notice tone="warning" text={t('contact.guest')} />
        <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </View>
    );
  } else if (!active || refusedMeanwhile) {
    // The brief's door: without an active annual membership the member meets the membership screen.
    body = (
      <View style={styles.gate}>
        <FadeInView style={styles.gateCard}>
          <Ionicons name="ribbon-outline" size={40} color={colors.gold} />
          <Text style={styles.gateText}>{t('contact.membersOnly')}</Text>
          <AppButton label={t('contact.activate')} icon="ribbon-outline" onPress={() => router.push('/membership')} />
        </FadeInView>
      </View>
    );
  } else {
    body = <Thread query={query} />;
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t('contact.title') }} />
      {body}
    </View>
  );
}

type ThreadQuery = ReturnType<typeof useContactThread>;

function Thread({ query }: { query: ThreadQuery }) {
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [outbox, setOutbox] = useState<ContactMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  const messages = [...(query.data?.messages ?? []), ...outbox];
  useLayoutEffect(() => {
    // New words, mine or theirs: the eye stays at the end of the thread.
    const timer = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setText('');
    // The bubble appears at once; the server's copy replaces it on the next refetch.
    const echo: ContactMessage = { id: `local:${Date.now()}`, from: 'member', by: null, text: body, at: new Date().toISOString() };
    setOutbox((current) => [...current, echo]);
    try {
      await contactApi.send(body);
      await query.refetch();
      setOutbox((current) => current.filter((entry) => entry.id !== echo.id));
      void queryClient.invalidateQueries({ queryKey: ['contact'] });
    } catch (cause) {
      setOutbox((current) => current.filter((entry) => entry.id !== echo.id));
      setText(body);
      setError(errorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.thread} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {query.isPending ? (
        <StateView loading />
      ) : (
        <ScrollView ref={scroller} style={styles.messages} contentContainerStyle={styles.messagesContent}>
          {messages.length === 0 ? (
            <FadeInView style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={44} color={colors.goldDark} />
              <Text style={styles.emptyText}>{t('contact.empty')}</Text>
            </FadeInView>
          ) : (
            messages.map((message) => <Bubble key={message.id} message={message} pending={message.id.startsWith('local:')} />)
          )}
        </ScrollView>
      )}
      {error ? <Notice tone="warning" text={error} /> : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('contact.placeholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
          maxLength={2000}
        />
        <PressScale onPress={() => void send()} accessibilityLabel={t('contact.send')} style={[styles.sendButton, (!text.trim() || sending) && styles.sendDisabled]}>
          {sending ? <ActivityIndicator color={colors.black} size="small" /> : <Ionicons name="send" size={18} color={colors.black} style={styles.sendIcon} />}
        </PressScale>
      </View>
      <Text style={styles.hint}>{t('contact.hint')}</Text>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message, pending }: { message: ContactMessage; pending: boolean }) {
  const mine = message.from === 'member';
  return (
    <FadeInView offset={10} duration={260} style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, pending && styles.bubblePending]}>
        {!mine ? <Text style={styles.bubbleBy}>{message.by ? t('contact.adminBy', { name: message.by }) : t('contact.admin')}</Text> : null}
        <Text style={styles.bubbleText}>{message.text}</Text>
        <View style={styles.bubbleMeta}>
          {pending ? <Ionicons name="time-outline" size={12} color={colors.textMuted} /> : null}
          <Text style={styles.bubbleTime}>{pending ? t('contact.sending') : formatRelativeTime(message.at)}</Text>
        </View>
      </View>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  gate: { flex: 1, padding: spacing.md, gap: spacing.md, justifyContent: 'center' },
  gateCard: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  gateText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  thread: { flex: 1 },
  messages: { flex: 1 },
  messagesContent: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  bubbleWrap: { maxWidth: '84%' },
  // The forced-RTL row: my words hang on one side, the management's on the other (like any chat).
  bubbleWrapMine: { alignSelf: 'flex-end' },
  bubbleWrapTheirs: { alignSelf: 'flex-start' },
  bubble: { gap: 4, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.lg, borderWidth: 1 },
  bubbleMine: { backgroundColor: 'rgba(201, 162, 39, 0.16)', borderColor: colors.goldDark, borderBottomLeftRadius: radii.sm },
  bubbleTheirs: { backgroundColor: colors.surface, borderColor: colors.border, borderBottomRightRadius: radii.sm },
  bubblePending: { opacity: 0.65 },
  bubbleBy: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.gold, textAlign: textStart },
  bubbleText: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bubbleTime: { ...typography.caption, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    ...typography.body,
    flex: 1,
    maxHeight: 120,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    textAlign: textStart,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  sendDisabled: { opacity: 0.5 },
  // The paper plane flies forward in the RTL layout.
  sendIcon: { transform: [{ scaleX: -1 }] },
  hint: { ...typography.caption, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs, backgroundColor: colors.surface },
});

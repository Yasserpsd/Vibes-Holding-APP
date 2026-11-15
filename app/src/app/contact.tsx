import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { ApiError, errorMessage } from '@/api/client';
import { contactApi, useContactThread, type ContactMessage } from '@/api/contact';
import { useAuth } from '@/auth/AuthProvider';
import { ADVISOR_DOCK_RISE } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { FadeInView, PopIn, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { inputStart, isRTL, markParagraphs, textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M36: «راسل الإدارة» — every signed-in account writes to the management at any time (M241, owner:
 * the annual membership is no longer the door); a guest is walked to sign-in. The thread polls
 * while open, and the management's reply also lands as a push (PushRegistrar).
 */
export default function ContactScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const signedIn = status === 'signedIn';
  const query = useContactThread(signedIn);
  // A server older than M241 still answers 403 to an account without the membership: the old door
  // shows until that server is updated, instead of a raw error.
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
  } else if (refusedMeanwhile) {
    // Only an older server refuses now (see above): its answer keeps the membership door it expects.
    body = (
      <View style={styles.gate}>
        <FadeInView>
          <GlassCard golden style={styles.gateCard}>
            <Ionicons name="ribbon-outline" size={40} color={colors.gold} />
            <Text style={styles.gateText}>{t('contact.membersOnly')}</Text>
            {/* M120 (owner): the lock answers with the subscribe popup — price and pay in one tap. */}
            <AppButton label={t('contact.activate')} icon="ribbon-outline" onPress={showMembershipGate} />
          </GlassCard>
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

/**
 * The raised advisor button of the bottom bar rises above the bar's top edge, right where the centred hint line
 * under the field sits: with the keyboard closed the line was crossed by it (final emulator pass, 2026-11-16).
 * While the keyboard is closed the hint keeps this much air under it — the crown's rise and a little more; while
 * it is open the bar is out of the way (hidden on Android, behind the keys on iOS) and the air goes, as in the
 * advisor's composer.
 */
const DOCK_CROWN_ROOM = ADVISOR_DOCK_RISE + 2;

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return open;
}

function Thread({ query }: { query: ThreadQuery }) {
  const queryClient = useQueryClient();
  const keyboardOpen = useKeyboardOpen();
  // M241: the screen sits under the stack's opaque header, so on iOS the keyboard padding is short by the header's
  // height unless it is passed as the offset. Read from the context (useHeaderHeight() throws where no header exists).
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
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
    // Review 2026-11-16: `padding` on Android too. Edge-to-edge means the window is not resized for the keyboard,
    // so `undefined` left the message field behind the keys. The offset is the header above this view (0 without one).
    <KeyboardAvoidingView style={styles.thread} behavior="padding" keyboardVerticalOffset={headerHeight}>
      {query.isPending ? (
        <StateView loading />
      ) : query.isError && !query.data ? (
        // The thread did not load: say so (an empty «لا رسائل» would hide the earlier messages) and offer a retry.
        <StateView error={query.error} onRetry={() => void query.refetch()} />
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
      {error ? <Notice tone="warning" text={error} support /> : null}
      {/* No bottom inset here: with the keyboard closed the bottom bar under this screen already covers it, and
          with the keyboard open it only left a blank strip above the keys. */}
      <View style={styles.composer}>
        {/* Review 2026-11-16: the focus glow sits on this frame, not on the input. A box shadow set on the input swaps
            its Android background, and Android then resets the input's padding to the stock 4 dp inset: the words
            hugged the border while typing. Never collapsed, so the glow does not re-parent the focused input. */}
        <View style={[styles.inputFrame, focused && styles.inputFrameFocused]} collapsable={false}>
          <TextInput
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t('contact.placeholder')}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, focused && styles.inputFocused]}
            multiline
            maxLength={2000}
          />
        </View>
        <PressScale onPress={() => void send()} accessibilityLabel={t('contact.send')} glow glowRadius={radii.pill} style={[styles.sendButton, (!text.trim() || sending) && styles.sendDisabled]}>
          {sending ? (
            <ActivityIndicator color={colors.goldInk} size="small" />
          ) : (
            <PopIn key={outbox.length}>
              <Ionicons name="send" size={18} color={colors.goldInk} style={styles.sendIcon} />
            </PopIn>
          )}
        </PressScale>
      </View>
      <Text style={[styles.hint, keyboardOpen ? null : styles.hintAboveDock]}>{t('contact.hint')}</Text>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message, pending }: { message: ContactMessage; pending: boolean }) {
  const mine = message.from === 'member';
  return (
    <FadeInView offset={10} duration={260} style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, pending && styles.bubblePending]}>
        {!mine ? <Text style={styles.bubbleBy}>{message.by ? t('contact.adminBy', { name: message.by }) : t('contact.admin')}</Text> : null}
        {/* Written by a member or the management, often several lines: each line carries its own direction mark. */}
        <Text style={styles.bubbleText}>{markParagraphs(message.text)}</Text>
        <View style={styles.bubbleMeta}>
          {pending ? <Ionicons name="time-outline" size={12} color={colors.textMuted} /> : null}
          <Text style={styles.bubbleTime}>{pending ? t('contact.sending') : formatRelativeTime(message.at)}</Text>
        </View>
      </View>
    </FadeInView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.black },
  gate: { flex: 1, padding: spacing.md, gap: spacing.md, justifyContent: 'center' },
  gateCard: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
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
  bubbleMine: { backgroundColor: colors.goldSoft, borderColor: colors.borderGold, borderBottomEndRadius: radii.sm },
  bubbleTheirs: { backgroundColor: colors.surface, borderColor: colors.border, borderBottomStartRadius: radii.sm },
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
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  // The frame takes the row's free width and carries the focus glow; same corners as the input.
  inputFrame: { flex: 1, borderRadius: radii.lg },
  inputFrameFocused: { boxShadow: shadows.glowGoldFaint },
  input: {
    ...typography.body,
    maxHeight: 120,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    // A TextInput reads left/right as the physical sides: its start follows the language (textStart would put Arabic on the left).
    textAlign: inputStart(),
    writingDirection: isRTL() ? 'rtl' : 'ltr',
  },
  // Focus lights the field: a golden border, with the faintest halo on the frame around it.
  inputFocused: { borderColor: colors.gold },
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
  // The paper plane flies toward the reading direction: mirrored for Arabic only.
  sendIcon: { transform: isRTL() ? [{ scaleX: -1 }] : [] },
  hint: { ...typography.caption, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs, backgroundColor: colors.surface },
  // Keyboard closed: the line stays clear of the bar's raised advisor button (see DOCK_CROWN_ROOM).
  hintAboveDock: { paddingBottom: spacing.xs + DOCK_CROWN_ROOM },
}));

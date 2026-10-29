import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useQueryClient } from '@tanstack/react-query';

import { advisorApi, type AdvisorGate, type AdvisorProfile, type HqProposal } from '@/api/advisor';
import { errorMessage } from '@/api/client';
import { hqApi } from '@/api/hq';
import type { PendingFile } from '@/components/advisor/FileButton';
import type { ChatMessage } from '@/components/advisor/useAdvisorChat';
import { readBase64 } from '@/components/advisor/VoiceButton';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { GlassCard, GoldHairline } from '@/components/lux';
import { entranceDelay, FadeInView, PopIn, SkeletonCards, usePulse } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { isProfileGate } from '@/components/ProfileGate';
import { getLang, hubText, t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { showAdvisorBalance } from '@/lib/advisorBalance';
import { formatArabicDate, formatNumber } from '@/lib/format';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

import { Composer } from './Composer';
import { CONTEXT_ICONS, toApiContext, welcomeStarters, type ChatContext, type ChatOpening } from './context';
import { MessageBubble, type ChatAct } from './MessageBubble';
import { stopSpeech } from './speech';
import { SCREEN_ROUTES } from './screens';
import { useAdvisorChat } from './useAdvisorChat';

/** Height of the bottom tab bar on iOS (React Navigation's default), needed to offset the keyboard. */
const IOS_TAB_BAR_HEIGHT = 49;

type Props = { context: ChatContext | null; opening?: ChatOpening | null; onClearContext: () => void };
type Item = { message: ChatMessage; dayLabel: string | null };

function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string): string {
  const now = new Date();
  if (key === dayKey(now.toISOString())) return t('common.today');
  now.setDate(now.getDate() - 1);
  if (key === dayKey(now.toISOString())) return t('time.yesterday');
  return formatArabicDate(key);
}

function withDayLabels(messages: ChatMessage[]): Item[] {
  let previous = '';
  return messages.map((message) => {
    const key = dayKey(message.at);
    const label = key && key !== previous ? dayLabel(key) : null;
    if (key) previous = key;
    return { message, dayLabel: label };
  });
}

/** The advisor conversation for a signed-in member. */
export function AdvisorChat({ context, opening = null, onClearContext }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const chat = useAdvisorChat();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  // M151: the PDF picked for the next message (only binaries with the picker can set it).
  const [attachment, setAttachment] = useState<PendingFile | null>(null);
  // M145: the server reads each line for an app action first; a booking still being completed rides along.
  const [actBusy, setActBusy] = useState(false);
  const pendingHq = useRef<HqProposal | null>(null);
  // The opening the member already answered; a new one (another portal or service) shows again.
  const [answeredOpening, setAnsweredOpening] = useState<ChatOpening | null>(null);
  const listRef = useRef<FlatList<Item>>(null);
  // M148: leaving the chat silences a playing reply.
  useEffect(() => () => stopSpeech(), []);
  const latestContext = useRef(context);

  useEffect(() => {
    latestContext.current = context;
  }, [context]);

  const items = useMemo(() => withDayLabels(chat.messages), [chat.messages]);
  const lastReplyId = useMemo(() => {
    for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
      const role = chat.messages[index]?.role;
      if (role === 'assistant' || role === 'staff') return chat.messages[index]?.id ?? null;
      if (role === 'user') return null;
    }
    return null;
  }, [chat.messages]);

  const submit = async (text: string) => {
    if ((!text.trim() && !attachment) || chat.sending) return;
    setDraft('');
    setAnsweredOpening(opening);
    // M151: a PDF goes straight to the advisor (no app-intent pass): the file is read into base64 here.
    if (attachment) {
      const pending = attachment;
      setAttachment(null);
      setActBusy(true);
      let base64 = '';
      try {
        base64 = await readBase64(pending.uri);
      } catch {
        chat.addLocal(null, t('advisor.file.failed'), []);
        setAttachment(pending);
        setActBusy(false);
        return;
      }
      setActBusy(false);
      const outcome = await chat.send(text, toApiContext(context), { name: pending.name, size: pending.size, base64 });
      if (!outcome.accepted) {
        setDraft((current) => current || text);
        setAttachment(pending);
      }
      if (outcome.contextRefused && latestContext.current === context) onClearContext();
      return;
    }
    // M145: an app action (HQ booking card, a screen, a prefilled service) is answered by the app itself
    // and never reaches the hub; anything else goes to the advisor as before.
    setActBusy(true);
    try {
      const intent = await advisorApi.intent(text, pendingHq.current);
      if (intent.action) {
        pendingHq.current = intent.action.type === 'hq_book' && intent.action.missing.length ? intent.action.proposal : null;
        chat.addLocal(text, intent.reply ?? '', [intent.action]);
        return;
      }
    } catch {
      // The hub answers instead.
    } finally {
      setActBusy(false);
    }
    const outcome = await chat.send(text, toApiContext(context));
    if (!outcome.accepted) setDraft((current) => current || text);
    // An older server took the message only without its context: the pill would claim what the advisor never
    // received. A context the member opened while the message was on its way is a different one and stays.
    if (outcome.contextRefused && latestContext.current === context) onClearContext();
  };

  /** M145: a card's request — navigation, a re-check after a pick, or the booking itself. */
  const act = async (request: ChatAct) => {
    if (request.kind === 'screen') {
      router.push(SCREEN_ROUTES[request.screen]);
      return;
    }
    if (request.kind === 'service') {
      router.push({ pathname: '/service/[key]', params: { key: request.key, answers: JSON.stringify(request.answers) } });
      return;
    }
    if (actBusy) return;
    setActBusy(true);
    try {
      if (request.kind === 'hq_pick') {
        const result = await advisorApi.intent('', request.proposal);
        if (result.action) {
          pendingHq.current = result.action.type === 'hq_book' && result.action.missing.length ? result.action.proposal : null;
          chat.replaceLocal(request.messageId, result.reply ?? '', [result.action]);
        }
        return;
      }
      const proposal = request.proposal;
      if (!proposal.date || !proposal.time) return;
      const space = proposal.kind === 'visit' ? null : proposal.kind;
      await hqApi.book({ date: proposal.date, time: proposal.time, purpose: space ? '' : (proposal.purpose ?? ''), note: proposal.note, ...(space ? { space, hours: proposal.hours } : {}) });
      await queryClient.invalidateQueries({ queryKey: ['hq'] });
      pendingHq.current = null;
      chat.replaceLocal(request.messageId, t('advisor.act.booked'), [{ type: 'screen', screen: 'hq', label: t('advisor.act.openHq') }]);
    } catch (cause) {
      chat.addLocal(null, errorMessage(cause), isProfileGate(cause) ? [{ type: 'membership' }] : []);
    } finally {
      setActBusy(false);
    }
  };

  // The balance shows up only when it is nearly out (owner's rule): otherwise the header carries no counter.
  const dailyLeft = me?.membership.aiDailyLeft ?? null;
  const nearlyOut = showAdvisorBalance(dailyLeft, me?.membership.aiDailyLimit);
  const busy = chat.sending || actBusy || chat.status !== 'ready';
  const showOpening = Boolean(opening) && answeredOpening !== opening;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="sparkles" size={22} color={colors.goldInk} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{botNameOf(chat.profile)}</Text>
          <Text style={styles.subtitle}>{chat.human ? t('advisor.staffFollowing') : t('advisor.oneConversation')}</Text>
        </View>
        {nearlyOut ? <CreditPill left={dailyLeft} /> : null}
      </View>
      <GoldHairline />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? IOS_TAB_BAR_HEIGHT + insets.bottom : 0}
      >
        {chat.status === 'loading' ? (
          <View style={styles.skeleton}>
            <SkeletonCards count={4} />
          </View>
        ) : chat.status === 'error' ? (
          <FadeInView style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
            <Text style={styles.errorText}>{chat.loadError ?? t('advisor.loadFailed')}</Text>
            <AppButton label={t('common.retry')} variant="outline" icon="refresh-outline" onPress={() => void chat.load()} />
          </FadeInView>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(item) => String(item.message.clientKey ?? item.message.id)}
            renderItem={({ item }) => (
              <View>
                {item.dayLabel ? <Text style={styles.day}>{item.dayLabel}</Text> : null}
                <MessageBubble
                  message={item.message}
                  showQuickReplies={item.message.id === lastReplyId && !chat.waiting && !chat.sending && !showOpening}
                  onQuickReply={(text) => void submit(text)}
                  onAct={(request) => void act(request)}
                  actBusy={actBusy}
                />
              </View>
            )}
            contentContainerStyle={styles.list}
            ListHeaderComponent={<Welcome profile={chat.profile} empty={chat.messages.length === 0 && !showOpening} onSuggestion={(text) => void submit(text)} />}
            ListFooterComponent={
              <>
                {showOpening && opening ? <OpeningCard opening={opening} botName={botNameOf(chat.profile)} onReply={(text) => void submit(text)} /> : null}
                {chat.waiting ? <Typing name={botNameOf(chat.profile)} /> : null}
              </>
            }
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {chat.gate ? <GateNotice gate={chat.gate} onDismiss={chat.dismissGate} onMembership={() => router.push('/membership')} /> : null}
        {chat.sendError ? (
          <FadeInView offset={8} duration={220}>
            <Pressable onPress={chat.dismissError} style={styles.notice}>
              <Notice text={chat.sendError} tone="warning" />
            </Pressable>
          </FadeInView>
        ) : null}
        {context ? (
          <FadeInView offset={8} duration={220}>
            <View style={styles.context}>
              <Ionicons name={CONTEXT_ICONS[context.type]} size={16} color={colors.gold} />
              <Text style={styles.contextText} numberOfLines={1}>{t('advisor.askingAbout', { title: context.title })}</Text>
              <Pressable onPress={onClearContext} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('advisor.clearContext')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          </FadeInView>
        ) : null}
        <Composer value={draft} onChange={setDraft} onSend={() => void submit(draft)} busy={busy} attachment={attachment} onAttach={setAttachment} onDetach={() => setAttachment(null)} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The hub writes the bot's name in Arabic: the English version shows the app's own. */
export const botNameOf = (profile: AdvisorProfile | null): string => hubText(profile?.botName, 'advisor.title');

const GATE_KEYS: Record<AdvisorGate['type'] | 'expired', StringKey> = {
  membership: 'advisor.gate.membership',
  expired: 'advisor.gate.expired',
  daily: 'advisor.gate.daily',
  rate: 'advisor.gate.rate',
  site_cap: 'advisor.gate.site_cap',
  contact: 'advisor.gate.contact',
  other: 'advisor.gate.other',
};

/** The near-empty daily balance breathes so the member notices it before the gate does. */
function CreditPill({ left }: { left: number }) {
  const pulse = usePulse(0.55, 1, 900);
  return (
    <Animated.View style={[styles.credit, { opacity: pulse }]}>
      <Ionicons name="flash-outline" size={14} color={colors.gold} />
      <Text style={styles.creditText}>{t('advisor.creditToday', { left: formatNumber(left) })}</Text>
    </Animated.View>
  );
}

/** The hub's welcome and quick menu are Arabic (the owner's own wording): the English version uses the app's strings. */
function Welcome({ profile, empty, onSuggestion }: { profile: AdvisorProfile | null; empty: boolean; onSuggestion: (text: string) => void }) {
  if (!empty || !profile) return null;
  const suggestions = getLang() === 'ar' ? profile.suggestions : welcomeStarters();
  return (
    <FadeInView>
      <GlassCard golden style={styles.welcome}>
        <Text style={styles.welcomeText}>{hubText(profile.welcome, 'advisor.welcome')}</Text>
        {suggestions.length ? (
          <View style={styles.suggestions}>
            {suggestions.map((suggestion, index) => (
              <PopIn key={suggestion} delay={entranceDelay(index, 70)}>
                <Chip label={suggestion} onPress={() => onSuggestion(suggestion)} />
              </PopIn>
            ))}
          </View>
        ) : null}
      </GlassCard>
    </FadeInView>
  );
}

/** The advisor's opening move, rendered like one of its bubbles with the suggested answers underneath. */
function OpeningCard({ opening, botName, onReply }: { opening: ChatOpening; botName: string; onReply: (text: string) => void }) {
  return (
    <FadeInView offset={12} style={styles.opening}>
      <GlassCard golden style={styles.openingBubble}>
        <Text style={styles.openingTitle}>{`${botName} · ${opening.title}`}</Text>
        <Text style={styles.openingText}>{opening.text}</Text>
      </GlassCard>
      {opening.quickReplies.length ? (
        <View style={styles.suggestions}>
          {opening.quickReplies.map((reply, index) => (
            <PopIn key={reply} delay={entranceDelay(index, 70)}>
              <Chip label={reply} onPress={() => onReply(reply)} />
            </PopIn>
          ))}
        </View>
      ) : null}
    </FadeInView>
  );
}

/** Three golden dots breathing in turn while the advisor writes. */
function Typing({ name }: { name: string }) {
  return (
    <FadeInView offset={6} duration={200}>
      <View style={styles.typing} accessible accessibilityLabel={t('advisor.typing', { name })}>
        <TypingDot delay={0} />
        <TypingDot delay={150} />
        <TypingDot delay={300} />
        <Text style={styles.typingText}>{t('advisor.typing', { name })}</Text>
      </View>
    </FadeInView>
  );
}

function TypingDot({ delay }: { delay: number }) {
  const [bounce] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.sequence([
          Animated.timing(bounce, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(bounce, { toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay(300),
        ]),
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, [bounce, delay]);
  return (
    <Animated.View
      style={[
        styles.typingDot,
        {
          opacity: bounce.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: [{ translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
        },
      ]}
    />
  );
}

function GateNotice({ gate, onDismiss, onMembership }: { gate: AdvisorGate; onDismiss: () => void; onMembership: () => void }) {
  return (
    <FadeInView offset={10} duration={260}>
      <GlassCard golden radius={radii.md} style={styles.gate}>
        <View style={styles.gateRow}>
          <Ionicons name={gate.membership ? 'lock-closed-outline' : 'time-outline'} size={20} color={colors.goldLight} />
          <Text style={styles.gateText}>{hubText(gate.text, GATE_KEYS[gate.expired ? 'expired' : gate.type])}</Text>
          <Pressable onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        {gate.membership ? <AppButton label={t('advisor.membershipScreen')} icon="ribbon-outline" onPress={onMembership} /> : null}
      </GlassCard>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.black },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  skeleton: { flex: 1, padding: spacing.md },
  errorText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGoldFaint,
  },
  headerText: { flex: 1 },
  title: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  credit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
  },
  creditText: { ...typography.caption, color: colors.gold, fontFamily: fonts.medium },
  list: { padding: spacing.md, paddingBottom: spacing.lg },
  day: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginVertical: spacing.sm },
  welcome: { gap: spacing.md, padding: spacing.md, marginBottom: spacing.md },
  welcomeText: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // In the forced RTL layout flex-start is the right edge, where the advisor's bubbles sit.
  opening: { alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  openingBubble: { maxWidth: '86%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  openingTitle: { ...typography.caption, color: colors.gold, textAlign: textStart },
  openingText: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  typing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  typingText: { ...typography.caption, color: colors.textMuted, marginStart: spacing.xs },
  typingDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  notice: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  gate: { gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md },
  gateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  gateText: { ...typography.body, color: colors.textPrimary, textAlign: textStart, flex: 1 },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  contextText: { ...typography.caption, color: colors.textPrimary, flexShrink: 1 },
});

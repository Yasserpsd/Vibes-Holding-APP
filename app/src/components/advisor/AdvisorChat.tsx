import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AdvisorGate, AdvisorMessage, AdvisorProfile } from '@/api/advisor';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { Notice } from '@/components/Notice';
import { getLang, hubText, t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { showAdvisorBalance } from '@/lib/advisorBalance';
import { formatArabicDate, formatNumber } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

import { Composer } from './Composer';
import { CONTEXT_ICONS, toApiContext, welcomeStarters, type ChatContext, type ChatOpening } from './context';
import { MessageBubble } from './MessageBubble';
import { useAdvisorChat } from './useAdvisorChat';

/** Height of the bottom tab bar on iOS (React Navigation's default), needed to offset the keyboard. */
const IOS_TAB_BAR_HEIGHT = 49;

type Props = { context: ChatContext | null; opening?: ChatOpening | null; onClearContext: () => void };
type Item = { message: AdvisorMessage; dayLabel: string | null };

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

function withDayLabels(messages: AdvisorMessage[]): Item[] {
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
  const [draft, setDraft] = useState('');
  // The opening the member already answered; a new one (another portal or service) shows again.
  const [answeredOpening, setAnsweredOpening] = useState<ChatOpening | null>(null);
  const listRef = useRef<FlatList<Item>>(null);
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
    if (!text.trim() || chat.sending) return;
    setDraft('');
    setAnsweredOpening(opening);
    const outcome = await chat.send(text, toApiContext(context));
    if (!outcome.accepted) setDraft((current) => current || text);
    // An older server took the message only without its context: the pill would claim what the advisor never
    // received. A context the member opened while the message was on its way is a different one and stays.
    if (outcome.contextRefused && latestContext.current === context) onClearContext();
  };

  // The balance shows up only when it is nearly out (owner's rule): otherwise the header carries no counter.
  const dailyLeft = me?.membership.aiDailyLeft ?? null;
  const nearlyOut = showAdvisorBalance(dailyLeft, me?.membership.aiDailyLimit);
  const busy = chat.sending || chat.status !== 'ready';
  const showOpening = Boolean(opening) && answeredOpening !== opening;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="sparkles" size={22} color={colors.black} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{botNameOf(chat.profile)}</Text>
          <Text style={styles.subtitle}>{chat.human ? t('advisor.staffFollowing') : t('advisor.oneConversation')}</Text>
        </View>
        {nearlyOut ? (
          <View style={styles.credit}>
            <Ionicons name="flash-outline" size={14} color={colors.gold} />
            <Text style={styles.creditText}>{t('advisor.creditToday', { left: formatNumber(dailyLeft) })}</Text>
          </View>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? IOS_TAB_BAR_HEIGHT + insets.bottom : 0}
      >
        {chat.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.gold} size="large" />
          </View>
        ) : chat.status === 'error' ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
            <Text style={styles.errorText}>{chat.loadError ?? t('advisor.loadFailed')}</Text>
            <AppButton label={t('common.retry')} variant="outline" icon="refresh-outline" onPress={() => void chat.load()} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(item) => String(item.message.id)}
            renderItem={({ item }) => (
              <View>
                {item.dayLabel ? <Text style={styles.day}>{item.dayLabel}</Text> : null}
                <MessageBubble
                  message={item.message}
                  showQuickReplies={item.message.id === lastReplyId && !chat.waiting && !chat.sending && !showOpening}
                  onQuickReply={(text) => void submit(text)}
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
          <Pressable onPress={chat.dismissError} style={styles.notice}>
            <Notice text={chat.sendError} tone="warning" />
          </Pressable>
        ) : null}
        {context ? (
          <View style={styles.context}>
            <Ionicons name={CONTEXT_ICONS[context.type]} size={16} color={colors.gold} />
            <Text style={styles.contextText} numberOfLines={1}>{t('advisor.askingAbout', { title: context.title })}</Text>
            <Pressable onPress={onClearContext} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('advisor.clearContext')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        <Composer value={draft} onChange={setDraft} onSend={() => void submit(draft)} busy={busy} />
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

/** The hub's welcome and quick menu are Arabic (the owner's own wording): the English version uses the app's strings. */
function Welcome({ profile, empty, onSuggestion }: { profile: AdvisorProfile | null; empty: boolean; onSuggestion: (text: string) => void }) {
  if (!empty || !profile) return null;
  const suggestions = getLang() === 'ar' ? profile.suggestions : welcomeStarters();
  return (
    <View style={styles.welcome}>
      <Text style={styles.welcomeText}>{hubText(profile.welcome, 'advisor.welcome')}</Text>
      {suggestions.length ? (
        <View style={styles.suggestions}>
          {suggestions.map((suggestion) => (
            <Chip key={suggestion} label={suggestion} onPress={() => onSuggestion(suggestion)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The advisor's opening move, rendered like one of its bubbles with the suggested answers underneath. */
function OpeningCard({ opening, botName, onReply }: { opening: ChatOpening; botName: string; onReply: (text: string) => void }) {
  return (
    <View style={styles.opening}>
      <View style={styles.openingBubble}>
        <Text style={styles.openingTitle}>{`${botName} · ${opening.title}`}</Text>
        <Text style={styles.openingText}>{opening.text}</Text>
      </View>
      {opening.quickReplies.length ? (
        <View style={styles.suggestions}>
          {opening.quickReplies.map((reply) => (
            <Chip key={reply} label={reply} onPress={() => onReply(reply)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Typing({ name }: { name: string }) {
  return (
    <View style={styles.typing}>
      <ActivityIndicator color={colors.gold} size="small" />
      <Text style={styles.typingText}>{t('advisor.typing', { name })}</Text>
    </View>
  );
}

function GateNotice({ gate, onDismiss, onMembership }: { gate: AdvisorGate; onDismiss: () => void; onMembership: () => void }) {
  return (
    <View style={styles.gate}>
      <View style={styles.gateRow}>
        <Ionicons name={gate.membership ? 'lock-closed-outline' : 'time-outline'} size={20} color={colors.goldLight} />
        <Text style={styles.gateText}>{hubText(gate.text, GATE_KEYS[gate.expired ? 'expired' : gate.type])}</Text>
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
      {gate.membership ? <AppButton label={t('advisor.membershipScreen')} icon="ribbon-outline" onPress={onMembership} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.black },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  errorText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  title: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  credit: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.surface },
  creditText: { ...typography.caption, color: colors.gold, fontFamily: fonts.medium },
  list: { padding: spacing.md, paddingBottom: spacing.lg },
  day: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginVertical: spacing.sm },
  welcome: { gap: spacing.md, padding: spacing.md, marginBottom: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  welcomeText: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  // In the forced RTL layout flex-start is the right edge, where the advisor's bubbles sit.
  opening: { alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
  openingBubble: { maxWidth: '86%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg, gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.goldDark },
  openingTitle: { ...typography.caption, color: colors.gold, textAlign: textStart },
  openingText: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  typing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  typingText: { ...typography.caption, color: colors.textSecondary },
  notice: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  gate: { gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gold },
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
    borderColor: colors.border,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  contextText: { ...typography.caption, color: colors.textPrimary, flexShrink: 1 },
});

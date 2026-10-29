import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';

import type { AdvisorAction, AdvisorFile, AdvisorMessage, AppScreen, HqProposal } from '@/api/advisor';
import { formatFileSize } from '@/components/advisor/FileButton';
import { errorMessage } from '@/api/client';
import { Chip } from '@/components/Chip';
import { GlassCard, GoldGradient } from '@/components/lux';
import { entranceDelay, FadeInView, PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textEnd, textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

import { HqProposalCard } from './HqProposalCard';
import { RichText, hasTable } from './RichText';
import { speechAvailable, toggleSpeech, useSpeechState } from './speech';

/** M145: what a chat card asks the screen to do (the screen owns navigation, booking and the pending proposal). */
export type ChatAct =
  | { kind: 'hq_pick'; messageId: number; proposal: HqProposal }
  | { kind: 'hq_confirm'; messageId: number; proposal: HqProposal }
  | { kind: 'screen'; screen: AppScreen }
  | { kind: 'service'; key: string; answers: Record<string, string> };

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type Props = { message: AdvisorMessage; showQuickReplies: boolean; onQuickReply: (text: string) => void; onAct?: (act: ChatAct) => void; actBusy?: boolean };

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? t('time.am') : t('time.pm')}`;
}

/** One chat message. The member's own messages sit on the left, replies on the right (mirrored for RTL). */
export function MessageBubble({ message, showQuickReplies, onQuickReply, onAct, actBusy = false }: Props) {
  if (message.role === 'system') {
    return <Text style={styles.system}>{message.text}</Text>;
  }
  const mine = message.role === 'user';
  const quick = message.actions.find((action) => action.type === 'quick_replies');
  const widgets = message.actions.filter((action) => action.type !== 'quick_replies');
  // A reply with a table takes the bubble's full width so the columns have room.
  const wide = !mine && hasTable(message.text);
  const bubbleStyle = [styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, message.role === 'staff' && styles.bubbleStaff, wide && styles.bubbleWide];
  const content = (
    <>
      {message.role === 'staff' ? <Text style={styles.by}>{message.by ? t('advisor.staffBy', { name: message.by }) : t('advisor.staff')}</Text> : null}
      {message.image ? (
        <Image source={{ uri: message.image }} style={styles.image} resizeMode="cover" accessibilityLabel={t('advisor.attachedImage')} />
      ) : null}
      {message.file ? <FileChip file={message.file} mine={mine} /> : null}
      {message.text && !(message.file && message.text === t('advisor.file.sent', { name: message.file.name })) ? (
        <RichText
          text={message.text}
          style={[styles.text, mine ? styles.textMine : styles.textTheirs]}
          linkColor={mine ? colors.goldInk : colors.goldLight}
          plain={mine}
        />
      ) : null}
      <View style={styles.foot}>
        {!mine && message.text && speechAvailable() ? <SpeakButton id={message.id} text={message.text} /> : null}
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{formatTime(message.at)}</Text>
      </View>
    </>
  );
  return (
    <FadeInView offset={10} duration={240} style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {mine ? <GoldGradient variant="gold" style={bubbleStyle}>{content}</GoldGradient> : <View style={bubbleStyle}>{content}</View>}
      {widgets.length ? (
        <View style={styles.widgets}>
          {widgets.map((action, index) => (
            <FadeInView key={index} delay={entranceDelay(index)} offset={8} duration={240}>
              <ActionView action={action} messageId={message.id} onAct={onAct} busy={actBusy} />
            </FadeInView>
          ))}
        </View>
      ) : null}
      {quick && quick.type === 'quick_replies' && showQuickReplies ? (
        <View style={styles.quick}>
          {quick.options.map((option, index) => (
            <PopIn key={option} delay={entranceDelay(index)}>
              <Chip label={option} onPress={() => onQuickReply(option)} />
            </PopIn>
          ))}
        </View>
      ) : null}
    </FadeInView>
  );
}

function ActionView({ action, messageId, onAct, busy }: { action: AdvisorAction; messageId: number; onAct?: (act: ChatAct) => void; busy: boolean }) {
  const router = useRouter();
  switch (action.type) {
    // M145: app actions — the screen executes them with the member's own session.
    case 'hq_book':
      return (
        <HqProposalCard
          action={action}
          busy={busy}
          onPick={(proposal) => onAct?.({ kind: 'hq_pick', messageId, proposal })}
          onConfirm={(proposal) => onAct?.({ kind: 'hq_confirm', messageId, proposal })}
        />
      );
    case 'screen':
      return <ActionButton icon="arrow-forward-circle-outline" label={action.label} onPress={() => onAct?.({ kind: 'screen', screen: action.screen })} />;
    case 'service':
      return <ActionButton icon="document-text-outline" label={action.label} onPress={() => onAct?.({ kind: 'service', key: action.key, answers: action.answers })} />;
    case 'link':
      return <ActionButton icon="open-outline" label={action.label} onPress={() => void openLink(action.url)} />;
    case 'video':
      return <ActionButton icon="play-circle-outline" label={action.title} onPress={() => void openLink(action.url)} />;
    case 'membership':
      return <ActionButton icon="ribbon-outline" label={t('advisor.membershipDetails')} onPress={() => router.push('/membership')} />;
    case 'card': {
      const url = action.url;
      return (
        <GlassCard radius={radii.md} style={styles.card}>
          <Text style={styles.cardTitle}>{action.title}</Text>
          {action.price ? <Text style={styles.cardPrice}>{action.price}</Text> : null}
          {action.bullets.map((bullet) => (
            <Text key={bullet} style={styles.cardBullet}>{`• ${bullet}`}</Text>
          ))}
          {action.note ? <Text style={styles.cardNote}>{action.note}</Text> : null}
          {url ? <ActionButton icon="open-outline" label={t('advisor.serviceDetails')} onPress={() => void openLink(url)} /> : null}
        </GlassCard>
      );
    }
    default:
      return null;
  }
}

/** M151: the PDF the member sent — name and size; a stored copy (url) opens in the in-app browser. */
function FileChip({ file, mine }: { file: AdvisorFile; mine: boolean }) {
  const color = mine ? colors.goldInk : colors.gold;
  const body = (
    <>
      <Ionicons name="document-text" size={18} color={color} />
      <Text style={[styles.fileName, { color }]} numberOfLines={1}>
        {file.name}
      </Text>
      {file.size > 0 ? <Text style={[styles.fileSize, { color }]}>{formatFileSize(file.size)}</Text> : null}
    </>
  );
  if (!file.url) return <View style={[styles.file, mine ? styles.fileMine : styles.fileTheirs]}>{body}</View>;
  return (
    <PressScale onPress={() => void openLink(file.url)} glow={false} style={[styles.file, mine ? styles.fileMine : styles.fileTheirs]} accessibilityLabel={t('advisor.file.attached')}>
      {body}
    </PressScale>
  );
}

/** M148: the speaker on a reply — tap to hear it, tap again to stop; a spinner while the clip is made. */
function SpeakButton({ id, text }: { id: number; text: string }) {
  const state = useSpeechState(id);
  const press = () => {
    toggleSpeech(id, text).catch((cause: unknown) => Alert.alert(t('advisor.speak.title'), errorMessage(cause) || t('advisor.speak.failed')));
  };
  const label = state === 'playing' ? t('advisor.speak.stop') : state === 'loading' ? t('advisor.speak.loading') : t('advisor.speak.play');
  return (
    <PressScale onPress={press} glow={state === 'playing'} glowRadius={radii.pill} style={[styles.speak, state !== 'idle' && styles.speakActive]} accessibilityLabel={label}>
      {state === 'loading' ? (
        <ActivityIndicator color={colors.gold} size="small" />
      ) : (
        <Ionicons name={state === 'playing' ? 'stop-circle' : 'volume-high-outline'} size={18} color={colors.gold} />
      )}
    </PressScale>
  );
}

function ActionButton({ icon, label, onPress }: { icon: IoniconName; label: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.pill} wrapStyle={styles.actionWrap} style={styles.action}>
      <Ionicons name={icon} size={16} color={colors.gold} />
      <Text style={styles.actionLabel}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.sm },
  // In the forced RTL layout flex-start is the right edge.
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '86%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg, gap: spacing.xs },
  // The tail corner follows the bubble's own side: logical end for the member, start for the advisor.
  bubbleMine: { borderBottomEndRadius: radii.sm },
  bubbleTheirs: { backgroundColor: colors.surfaceElevated, borderBottomStartRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  bubbleStaff: { borderColor: colors.borderGold },
  bubbleWide: { alignSelf: 'stretch', maxWidth: '100%' },
  by: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.gold, textAlign: textStart },
  image: { width: 220, height: 160, borderRadius: radii.md, backgroundColor: colors.surface },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md, borderWidth: 1, maxWidth: 260 },
  fileMine: { borderColor: 'rgba(0,0,0,0.18)', backgroundColor: 'rgba(255,255,255,0.22)' },
  fileTheirs: { borderColor: colors.borderGold, backgroundColor: colors.goldFaint },
  fileName: { ...typography.caption, fontFamily: fonts.medium, flexShrink: 1, writingDirection: 'ltr' },
  fileSize: { ...typography.caption, fontSize: 11, writingDirection: 'ltr' },
  text: { ...typography.body, textAlign: textStart },
  textMine: { color: colors.goldInk },
  textTheirs: { color: colors.textPrimary },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  speak: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderGold, backgroundColor: colors.goldFaint },
  speakActive: { borderColor: colors.gold },
  time: { ...typography.caption, fontSize: 11, lineHeight: 14, textAlign: textEnd },
  timeMine: { color: colors.goldInk },
  timeTheirs: { color: colors.textMuted },
  widgets: { gap: spacing.xs, marginTop: spacing.xs, maxWidth: '86%' },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  actionWrap: { alignSelf: 'flex-start' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldFaint,
  },
  actionLabel: { ...typography.caption, fontFamily: fonts.medium, color: colors.gold },
  card: { gap: spacing.xs, padding: spacing.md },
  cardTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  cardPrice: { ...typography.body, color: colors.gold, textAlign: textStart },
  cardBullet: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  cardNote: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  system: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginVertical: spacing.sm },
});

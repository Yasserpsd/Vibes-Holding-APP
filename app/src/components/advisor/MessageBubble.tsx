import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AdvisorAction, AdvisorMessage } from '@/api/advisor';
import { Chip } from '@/components/Chip';
import { t } from '@/i18n';
import { textEnd, textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

import { RichText, hasTable } from './RichText';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type Props = { message: AdvisorMessage; showQuickReplies: boolean; onQuickReply: (text: string) => void };

const GOLD_INK = '#5A4710';

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? t('time.am') : t('time.pm')}`;
}

/** One chat message. The member's own messages sit on the left, replies on the right (mirrored for RTL). */
export function MessageBubble({ message, showQuickReplies, onQuickReply }: Props) {
  if (message.role === 'system') {
    return <Text style={styles.system}>{message.text}</Text>;
  }
  const mine = message.role === 'user';
  const quick = message.actions.find((action) => action.type === 'quick_replies');
  const widgets = message.actions.filter((action) => action.type !== 'quick_replies');
  // A reply with a table takes the bubble's full width so the columns have room.
  const wide = !mine && hasTable(message.text);
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, message.role === 'staff' && styles.bubbleStaff, wide && styles.bubbleWide]}>
        {message.role === 'staff' ? <Text style={styles.by}>{message.by ? t('advisor.staffBy', { name: message.by }) : t('advisor.staff')}</Text> : null}
        {message.image ? (
          <Image source={{ uri: message.image }} style={styles.image} resizeMode="cover" accessibilityLabel={t('advisor.attachedImage')} />
        ) : null}
        {message.text ? (
          <RichText
            text={message.text}
            style={[styles.text, mine ? styles.textMine : styles.textTheirs]}
            linkColor={mine ? colors.black : colors.goldLight}
            plain={mine}
          />
        ) : null}
        <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{formatTime(message.at)}</Text>
      </View>
      {widgets.length ? (
        <View style={styles.widgets}>
          {widgets.map((action, index) => (
            <ActionView key={index} action={action} />
          ))}
        </View>
      ) : null}
      {quick && quick.type === 'quick_replies' && showQuickReplies ? (
        <View style={styles.quick}>
          {quick.options.map((option) => (
            <Chip key={option} label={option} onPress={() => onQuickReply(option)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ActionView({ action }: { action: AdvisorAction }) {
  const router = useRouter();
  switch (action.type) {
    case 'link':
      return <ActionButton icon="open-outline" label={action.label} onPress={() => void openLink(action.url)} />;
    case 'video':
      return <ActionButton icon="play-circle-outline" label={action.title} onPress={() => void openLink(action.url)} />;
    case 'membership':
      return <ActionButton icon="ribbon-outline" label={t('advisor.membershipDetails')} onPress={() => router.push('/membership')} />;
    case 'card': {
      const url = action.url;
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{action.title}</Text>
          {action.price ? <Text style={styles.cardPrice}>{action.price}</Text> : null}
          {action.bullets.map((bullet) => (
            <Text key={bullet} style={styles.cardBullet}>{`• ${bullet}`}</Text>
          ))}
          {action.note ? <Text style={styles.cardNote}>{action.note}</Text> : null}
          {url ? <ActionButton icon="open-outline" label={t('advisor.serviceDetails')} onPress={() => void openLink(url)} /> : null}
        </View>
      );
    }
    default:
      return null;
  }
}

function ActionButton({ icon, label, onPress }: { icon: IoniconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.actionPressed]} accessibilityRole="button">
      <Ionicons name={icon} size={16} color={colors.gold} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.sm },
  // In the forced RTL layout flex-start is the right edge.
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '86%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg, gap: spacing.xs },
  bubbleMine: { backgroundColor: colors.gold, borderBottomLeftRadius: radii.sm },
  bubbleTheirs: { backgroundColor: colors.surfaceElevated, borderBottomRightRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  bubbleStaff: { borderColor: colors.gold },
  bubbleWide: { alignSelf: 'stretch', maxWidth: '100%' },
  by: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.gold, textAlign: textStart },
  image: { width: 220, height: 160, borderRadius: radii.md, backgroundColor: colors.surface },
  text: { ...typography.body, textAlign: textStart },
  textMine: { color: colors.black },
  textTheirs: { color: colors.textPrimary },
  time: { ...typography.caption, fontSize: 11, lineHeight: 14, textAlign: textEnd },
  timeMine: { color: GOLD_INK },
  timeTheirs: { color: colors.textMuted },
  widgets: { gap: spacing.xs, marginTop: spacing.xs, maxWidth: '86%' },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  actionPressed: { backgroundColor: colors.surface },
  actionLabel: { ...typography.caption, fontFamily: fonts.medium, color: colors.gold },
  card: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  cardPrice: { ...typography.body, color: colors.gold, textAlign: textStart },
  cardBullet: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  cardNote: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  system: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginVertical: spacing.sm },
});

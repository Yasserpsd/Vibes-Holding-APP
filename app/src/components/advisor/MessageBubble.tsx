import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { AdvisorAction, AdvisorMessage } from '@/api/advisor';
import { Chip } from '@/components/Chip';
import { GlassCard, GoldGradient } from '@/components/lux';
import { entranceDelay, FadeInView, PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textEnd, textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

import { RichText, hasTable } from './RichText';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type Props = { message: AdvisorMessage; showQuickReplies: boolean; onQuickReply: (text: string) => void };

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
  const bubbleStyle = [styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, message.role === 'staff' && styles.bubbleStaff, wide && styles.bubbleWide];
  const content = (
    <>
      {message.role === 'staff' ? <Text style={styles.by}>{message.by ? t('advisor.staffBy', { name: message.by }) : t('advisor.staff')}</Text> : null}
      {message.image ? (
        <Image source={{ uri: message.image }} style={styles.image} resizeMode="cover" accessibilityLabel={t('advisor.attachedImage')} />
      ) : null}
      {message.text ? (
        <RichText
          text={message.text}
          style={[styles.text, mine ? styles.textMine : styles.textTheirs]}
          linkColor={mine ? colors.goldInk : colors.goldLight}
          plain={mine}
        />
      ) : null}
      <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>{formatTime(message.at)}</Text>
    </>
  );
  return (
    <FadeInView offset={10} duration={240} style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {mine ? <GoldGradient variant="gold" style={bubbleStyle}>{content}</GoldGradient> : <View style={bubbleStyle}>{content}</View>}
      {widgets.length ? (
        <View style={styles.widgets}>
          {widgets.map((action, index) => (
            <FadeInView key={index} delay={entranceDelay(index)} offset={8} duration={240}>
              <ActionView action={action} />
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
  text: { ...typography.body, textAlign: textStart },
  textMine: { color: colors.goldInk },
  textTheirs: { color: colors.textPrimary },
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

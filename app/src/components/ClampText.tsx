import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View, type NativeSyntheticEvent, type StyleProp, type TextLayoutEventData, type TextStyle } from 'react-native';

import { PressScale } from '@/components/motion';
import { usePaper } from '@/components/paper';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  text: string;
  /** How many lines show before «See more» (owner, 2026-11-14: three). */
  lines?: number;
  style?: StyleProp<TextStyle>;
};

/**
 * A reading paragraph that never becomes a wall: at most `lines` lines, then a «See more» pill that
 * opens the whole text in place and folds it back. The toggle only appears when the text really
 * overflows — measured once on an invisible, unclamped twin (onTextLayout reports the true line count
 * on both iOS and Android, which numberOfLines alone does not). Inside a PaperCard it wears ink colours.
 */
export function ClampText({ text, lines = 3, style }: Props) {
  const paper = usePaper();
  const [open, setOpen] = useState(false);
  // The text the measurement belongs to, so a changed paragraph (language switch, refetch) starts clean.
  const [measured, setMeasured] = useState<{ text: string; lines: number } | null>(null);
  const total = measured && measured.text === text ? measured.lines : 0;
  const overflow = total > lines;
  const centered = StyleSheet.flatten(style)?.textAlign === 'center';

  const textStyle = [styles.text, paper && styles.paperText, style];
  const onMeasure = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const count = event.nativeEvent.lines.length;
    setMeasured((current) => (current && current.text === text && current.lines === count ? current : { text, lines: count }));
  };

  return (
    <View>
      <Text style={textStyle} numberOfLines={open ? undefined : lines}>
        {text}
      </Text>
      {/* The invisible twin: same box, no clamp, only there to count the lines once. */}
      {total === 0 ? (
        <Text style={[textStyle, styles.probe]} onTextLayout={onMeasure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {text}
        </Text>
      ) : null}
      {overflow ? (
        <PressScale
          onPress={() => setOpen((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={open ? t('project.readLess') : t('project.readMore')}
          wrapStyle={centered ? styles.toggleCenter : styles.toggleStart}
          style={[styles.pill, paper && styles.paperPill]}
        >
          <Text style={[styles.pillText, paper && styles.paperPillText]} numberOfLines={1}>
            {open ? t('project.readLess') : t('project.readMore')}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={paper ? colors.paperGold : colors.goldLight} />
        </PressScale>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  text: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  paperText: { color: colors.paperInkSoft },
  probe: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  toggleStart: { alignSelf: 'flex-start', marginTop: spacing.xs },
  toggleCenter: { alignSelf: 'center', marginTop: spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldFaint,
  },
  paperPill: { borderColor: colors.paperBorder, backgroundColor: colors.paper },
  pillText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldLight },
  paperPillText: { color: colors.paperGold },
}));

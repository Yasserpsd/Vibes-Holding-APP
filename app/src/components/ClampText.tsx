import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent, type NativeSyntheticEvent, type StyleProp, type TextLayoutEventData, type TextStyle } from 'react-native';

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
 * overflows — measured on an invisible, unclamped twin (onTextLayout reports the true line count
 * on both iOS and Android, which numberOfLines alone does not). Inside a PaperCard it wears ink colours.
 */
export function ClampText({ text, lines = 3, style }: Props) {
  const paper = usePaper();
  const [open, setOpen] = useState(false);
  // 2026-11-16: the count belongs to this text AT this width AND this system text size. A new paragraph
  // (language switch, refetch), a box that got wider or narrower (split screen, a fold, rotation) or a text size
  // changed in the phone's settings while the app is open counts the lines again — before, the old count stayed
  // and the pill could be missing over text that now ran past the limit.
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState<{ text: string; width: number; fontScale: number; lines: number } | null>(null);
  const fresh = measured !== null && measured.text === text && measured.width === width && measured.fontScale === fontScale;
  const total = fresh ? measured.lines : 0;
  const overflow = total > lines;
  const centered = StyleSheet.flatten(style)?.textAlign === 'center';

  const textStyle = [styles.text, paper && styles.paperText, style];
  const onBox = (event: LayoutChangeEvent) => {
    // Whole points: a sub-pixel wobble must not start a recount.
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth((current) => (current === next ? current : next));
  };
  const onMeasure = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const count = event.nativeEvent.lines.length;
    setMeasured((current) =>
      current && current.text === text && current.width === width && current.fontScale === fontScale && current.lines === count ? current : { text, width, fontScale, lines: count },
    );
  };

  return (
    <View onLayout={onBox}>
      <Text style={textStyle} numberOfLines={open ? undefined : lines}>
        {text}
      </Text>
      {/* The invisible twin: same box, no clamp, only there to count the lines. It waits for the box's width, and a
          new width or text size mounts a new one (the key), so its onTextLayout always reports the current state. */}
      {width > 0 && total === 0 ? (
        <Text
          key={`${width}:${fontScale}`}
          style={[textStyle, styles.probe]}
          onTextLayout={onMeasure}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {text}
        </Text>
      ) : null}
      {overflow ? (
        <PressScale
          onPress={() => setOpen((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={open ? t('project.readLess') : t('project.readMore')}
          hitSlop={10}
          wrapStyle={centered ? styles.toggleCenter : styles.toggleStart}
          style={[styles.pill, paper && styles.paperPill]}
        >
          <Text style={[styles.pillText, paper && styles.paperPillText]} numberOfLines={1}>
            {open ? t('project.readLess') : t('project.readMore')}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={paper ? colors.paperGold : colors.goldLightText} />
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
  pillText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldLightText },
  paperPillText: { color: colors.paperGold },
}));

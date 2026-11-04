import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useFormPalette } from '@/components/form/FormTheme';
import { FadeInView, PopIn, Wiggle } from '@/components/motion';
import { SupportLink } from '@/components/SupportLink';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

// `support`: the notice reports a problem, so the WhatsApp support line sits right under it (owner, 2026-11-03).
type Props = { text: string; tone?: 'info' | 'warning' | 'success'; support?: boolean };

/** Short inline notice (policy hint, test-mode reminder, success message). */
export function Notice({ text, tone = 'info', support = false }: Props) {
  // M195: inside a FormCard the notice follows the form identity (gold wash, navy ink; red for a warning).
  const palette = useFormPalette();
  const color = tone === 'warning' ? (palette ? palette.danger : colors.warning) : tone === 'success' ? colors.success : palette ? palette.accent : colors.goldLight;
  const formBox = palette ? (tone === 'warning' ? { backgroundColor: palette.dangerBg, borderColor: palette.danger } : { backgroundColor: palette.noticeBg, borderColor: palette.noticeBorder }) : null;
  const formText = palette ? { color: tone === 'warning' ? palette.danger : palette.noticeText } : null;
  const formChip = palette ? { backgroundColor: 'transparent' } : null;
  const icon = tone === 'warning' ? 'warning-outline' : tone === 'success' ? 'checkmark-circle-outline' : 'information-circle-outline';
  return (
    <FadeInView offset={8}>
      <View style={[styles.box, tone === 'info' ? styles.boxGold : { borderColor: color }, formBox]}>
        {/* M84e: a warning shakes once to be seen; the others pop into place. */}
        {tone === 'warning' ? (
          <Wiggle delay={260}>
            <View style={[styles.iconChip, formChip]}>
              <Ionicons name={icon} size={16} color={color} />
            </View>
          </Wiggle>
        ) : (
          <PopIn delay={120}>
            <View style={[styles.iconChip, formChip]}>
              <Ionicons name={icon} size={16} color={color} />
            </View>
          </PopIn>
        )}
        <Text style={[styles.text, formText]}>{text}</Text>
      </View>
      {support ? <SupportLink problem={text} /> : null}
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  // Gold tone reads as a soft golden wash instead of a hard outline.
  boxGold: {
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldSoft,
  },
  iconChip: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldFaint,
  },
  text: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: textStart },
});

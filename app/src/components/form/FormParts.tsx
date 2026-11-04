import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode, Ref } from 'react';
import { Text, View } from 'react-native';

import { useFormPalette } from '@/components/form/FormTheme';
import { FadeInView, Wiggle } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, formPalettes, radii, spacing, typography } from '@/theme/tokens';

/** M195: the red line under a field or a chip group — icon + the exact problem. */
export function FieldError({ text }: { text: string }) {
  const palette = useFormPalette() ?? formPalettes.light;
  return (
    <FadeInView offset={4}>
      <View style={styles.errorRow} accessibilityLiveRegion="polite">
        <Ionicons name="alert-circle" size={16} color={palette.danger} />
        <Text style={[styles.errorText, { color: palette.danger }]}>{text}</Text>
      </View>
    </FadeInView>
  );
}

type FieldGroupProps = {
  label: string;
  children: ReactNode;
  error?: string | null;
  hint?: string;
  /** The row the screen scrolls to when this group holds the first error (useFormErrors.anchor). */
  anchorRef?: Ref<View>;
};

/** A labelled block (chips, pickers) that carries its own red state like a FormField. */
export function FieldGroup({ label, children, error, hint, anchorRef }: FieldGroupProps) {
  const palette = useFormPalette();
  return (
    <View ref={anchorRef} style={styles.group} collapsable={false}>
      <Text style={[styles.label, palette ? { color: palette.inkSoft } : null, error ? { color: (palette ?? formPalettes.light).danger } : null]}>{label}</Text>
      <View style={[styles.body, error ? [styles.bodyError, { borderColor: (palette ?? formPalettes.light).danger, backgroundColor: (palette ?? formPalettes.light).dangerBg }] : null]}>{children}</View>
      {error ? <FieldError text={error} /> : hint ? <Text style={[styles.hint, palette ? { color: palette.muted } : null]}>{hint}</Text> : null}
    </View>
  );
}

/** M195: the red box at the top of a form once submit found errors («يوجد N أخطاء…»). */
export function ErrorSummary({ count }: { count: number }) {
  const palette = useFormPalette() ?? formPalettes.light;
  if (count <= 0) return null;
  return (
    <Wiggle delay={120}>
      <View style={[styles.summary, { borderColor: palette.danger, backgroundColor: palette.dangerBg }]} accessibilityRole="alert">
        <Ionicons name="alert-circle" size={20} color={palette.danger} />
        <Text style={[styles.summaryText, { color: palette.danger }]}>{count === 1 ? t('form.summaryOne') : t('form.summaryMany', { count })}</Text>
      </View>
    </Wiggle>
  );
}

/** The chip rows of every form share one wrap. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

const styles = themedStyles(() => ({
  group: { gap: spacing.xs },
  label: { ...typography.caption, fontFamily: fonts.semiBold, fontSize: 14, color: colors.textSecondary, textAlign: textStart },
  body: { borderRadius: radii.md },
  bodyError: { borderWidth: 1, padding: spacing.sm },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  errorText: { ...typography.caption, fontFamily: fonts.medium, flex: 1, textAlign: textStart },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radii.md,
    borderWidth: 1.5,
  },
  summaryText: { ...typography.body, fontFamily: fonts.semiBold, fontSize: 15, flex: 1, textAlign: textStart },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));

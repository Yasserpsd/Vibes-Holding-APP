import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { useFormPalette } from '@/components/form/FormTheme';
import { themedStyles } from '@/theme/styles';
import { fonts, formPalettes, spacing, typography } from '@/theme/tokens';

/**
 * M257 (owner, 2026-11-19): the steps of a form, at its head — «بياناتك ← رمز واتساب ← إنشاء الحساب». A member who
 * pressed the sign-up button did not know a WhatsApp code was due (M227); now he reads it before he types a letter.
 * Each step is a column (mark above its label), so the row needs no direction of its own.
 */
export function SignupSteps({ labels, current }: { labels: string[]; current: number }) {
  const palette = useFormPalette() ?? formPalettes.light;
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={labels[Math.min(current, labels.length - 1)]}>
      {labels.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <View key={label} style={styles.step}>
            <View
              style={[
                styles.mark,
                { borderColor: done || active ? palette.buttonBorder : palette.fieldBorder, backgroundColor: done ? palette.buttonBg : active ? palette.noticeBg : 'transparent' },
              ]}
            >
              {done ? <Ionicons name="checkmark" size={14} color={palette.buttonText} /> : <Text style={[styles.number, { color: active ? palette.ink : palette.muted }]}>{index + 1}</Text>}
            </View>
            <Text numberOfLines={2} style={[styles.label, { color: done || active ? palette.ink : palette.muted }, active ? styles.labelActive : null]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  step: { flex: 1, alignItems: 'center', gap: spacing.xs },
  mark: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  number: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18 },
  label: { ...typography.caption, textAlign: 'center' },
  labelActive: { fontFamily: fonts.semiBold },
}));

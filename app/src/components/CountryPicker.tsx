import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState, type Ref } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Country } from '@/api/auth';
import { FieldError } from '@/components/form/FormParts';
import { useFormPalette } from '@/components/form/FormTheme';
import { getLang, t, tOptional } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** Bundled translation first (the six GCC), then the server's English or Arabic name. */
export function countryLabel(country: Country): string {
  return tOptional(`country.${country.code}`) ?? (getLang() === 'en' && country.nameEn ? country.nameEn : country.name);
}

type Props = {
  countries: Country[];
  selected: string;
  onSelect: (code: string) => void;
  /** M126: flag + dial code only — sits beside the phone field on the login screen. */
  compact?: boolean;
  /** M195: inside a form the picker carries its own label and red state like a FormField. */
  label?: string;
  error?: string | null;
  anchorRef?: Ref<View>;
};

/**
 * Country selector for the world list (M64): a field that opens a searchable sheet.
 * Search matches the Arabic name, the English name and the dial code.
 * M195: inside a FormCard it is drawn exactly like the other fields (same height, radius, border, colours).
 */
export function CountryPicker({ countries, selected, onSelect, compact = false, label, error, anchorRef }: Props) {
  const palette = useFormPalette();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = countries.find((item) => item.code === selected) ?? countries[0];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return countries;
    const digits = needle.replace(/^[+0]+/, '');
    return countries.filter(
      (item) =>
        item.name.includes(query.trim()) ||
        (item.nameEn ?? '').toLowerCase().includes(needle) ||
        (digits !== '' && /^\d+$/.test(digits) && item.dial.startsWith(digits)),
    );
  }, [countries, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const fieldForm = palette ? { backgroundColor: palette.field, borderColor: error ? palette.danger : palette.fieldBorder, borderWidth: error ? 1.5 : 1 } : null;
  const inkForm = palette ? { color: palette.ink } : null;
  const mutedForm = palette ? { color: palette.muted } : null;

  return (
    <View ref={anchorRef} style={styles.wrap} collapsable={false}>
      {label ? <Text style={[styles.label, palette ? { color: error ? palette.danger : palette.inkSoft } : null]}>{label}</Text> : null}
      <Pressable
        style={[styles.field, compact && styles.fieldCompact, fieldForm]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={compact && current ? `${countryLabel(current)} +${current.dial}` : (label ?? t('auth.register.country'))}
      >
        <Text style={styles.flag}>{current?.flag ?? ''}</Text>
        {compact ? null : (
          <Text style={[styles.fieldText, inkForm]} numberOfLines={1}>
            {current ? countryLabel(current) : ''}
          </Text>
        )}
        <Text style={[styles.dial, mutedForm]}>{current ? `‎+${current.dial}` : ''}</Text>
        <Ionicons name="chevron-down" size={16} color={palette ? palette.muted : colors.textMuted} />
      </Pressable>
      {error ? <FieldError text={error} /> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.sheet, palette ? { backgroundColor: palette.card, borderColor: palette.cardBorder } : null]} onPress={() => undefined}>
            <TextInput
              style={[styles.search, palette ? { color: palette.ink, backgroundColor: palette.field, borderColor: palette.fieldBorder } : null]}
              value={query}
              onChangeText={setQuery}
              placeholder={t('auth.register.countrySearch')}
              placeholderTextColor={palette ? palette.placeholder : colors.textMuted}
              autoFocus
              autoCorrect={false}
            />
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={<Text style={[styles.empty, mutedForm]}>{t('common.noResults')}</Text>}
              renderItem={({ item }) => {
                const active = item.code === selected;
                return (
                  <Pressable
                    style={[styles.row, active && (palette ? { backgroundColor: palette.tone === 'dark' ? 'rgba(231, 173, 63, 0.16)' : palette.noticeBg } : styles.rowActive)]}
                    onPress={() => {
                      onSelect(item.code);
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={styles.flag}>{item.flag}</Text>
                    <Text style={[styles.rowText, palette ? { color: active ? palette.accent : palette.ink } : active && styles.rowTextActive, active && styles.rowTextBold]} numberOfLines={1}>
                      {countryLabel(item)}
                    </Text>
                    <Text style={[styles.dial, mutedForm]}>{`‎+${item.dial}`}</Text>
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    minHeight: 50,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // The compact form keeps the same height as a FormField input so the login row lines up.
  fieldCompact: { alignSelf: 'stretch', paddingHorizontal: spacing.sm + 4 },
  fieldText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  flag: { fontSize: 18 },
  dial: { ...typography.caption, color: colors.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.lg },
  sheet: {
    maxHeight: '75%',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  search: {
    ...typography.body,
    color: colors.textPrimary,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlign: textStart,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  rowActive: { backgroundColor: colors.goldSoft },
  rowText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart },
  rowTextActive: { color: colors.goldLight },
  rowTextBold: { fontFamily: fonts.semiBold },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing.md },
});

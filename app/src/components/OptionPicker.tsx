import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState, type Ref } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useFormPalette } from '@/components/form/FormTheme';
import { FieldError } from '@/components/form/FormParts';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, formPalettes, radii, spacing, typography } from '@/theme/tokens';

export type PickerOption = { value: string; label: string };

type Props = {
  label: string;
  options: PickerOption[];
  selected: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  anchorRef?: Ref<View>;
  searchPlaceholder?: string;
};

/**
 * M195: a field that opens a searchable sheet of fixed choices (the city of residence, owner: «اختيار من
 * قائمة مدن مش كتابة حرة»). Same height, radius and border as a FormField, red when in error.
 */
export function OptionPicker({ label, options, selected, onSelect, placeholder, hint, error, anchorRef, searchPlaceholder }: Props) {
  const palette = useFormPalette() ?? formPalettes.light;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((option) => option.value === selected) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle));
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View ref={anchorRef} style={styles.field} collapsable={false}>
      <Text style={[styles.label, { color: error ? palette.danger : palette.inkSoft }]}>{label}</Text>
      <Pressable
        style={[styles.input, { backgroundColor: palette.field, borderColor: error ? palette.danger : palette.fieldBorder }, error ? styles.inputError : null]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? '' }}
      >
        <Text style={[styles.value, { color: current ? palette.ink : palette.placeholder }]} numberOfLines={1}>
          {current?.label ?? placeholder ?? ''}
        </Text>
        <Ionicons name="chevron-down" size={16} color={palette.muted} />
      </Pressable>
      {error ? <FieldError text={error} /> : hint ? <Text style={[styles.hint, { color: palette.muted }]}>{hint}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.sheet, { backgroundColor: palette.card, borderColor: palette.cardBorder }]} onPress={() => undefined}>
            <TextInput
              style={[styles.search, { color: palette.ink, backgroundColor: palette.field, borderColor: palette.fieldBorder }]}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder ?? t('form.search')}
              placeholderTextColor={palette.placeholder}
              autoFocus
              autoCorrect={false}
            />
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={<Text style={[styles.empty, { color: palette.muted }]}>{t('common.noResults')}</Text>}
              renderItem={({ item }) => {
                const active = item.value === selected;
                return (
                  <Pressable
                    style={[styles.row, active && { backgroundColor: palette.tone === 'dark' ? 'rgba(231, 173, 63, 0.16)' : palette.noticeBg }]}
                    onPress={() => {
                      onSelect(item.value);
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.rowText, { color: active ? palette.accent : palette.ink }, active && styles.rowTextActive]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={18} color={palette.accent} /> : null}
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

const styles = themedStyles(() => ({
  field: { gap: spacing.xs },
  label: { ...typography.caption, textAlign: textStart },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    minHeight: 50,
  },
  inputError: { borderWidth: 1.5 },
  value: { fontFamily: fonts.regular, fontSize: 16, flex: 1, textAlign: textStart },
  hint: { ...typography.caption, textAlign: textStart },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.lg },
  sheet: { maxHeight: '75%', gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1 },
  search: { ...typography.body, padding: spacing.sm + 2, borderRadius: radii.md, borderWidth: 1, textAlign: textStart },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radii.md },
  rowText: { ...typography.body, flex: 1, textAlign: textStart },
  rowTextActive: { fontFamily: fonts.semiBold },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing.md },
}));

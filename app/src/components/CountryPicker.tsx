import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import type { Country } from '@/api/auth';
import { getLang, t, tOptional } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

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
};

/**
 * Country selector for the world list (M64): a field that opens a searchable sheet.
 * Search matches the Arabic name, the English name and the dial code.
 */
export function CountryPicker({ countries, selected, onSelect, compact = false }: Props) {
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

  return (
    <>
      <Pressable
        style={[styles.field, compact && styles.fieldCompact]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={compact && current ? `${countryLabel(current)} +${current.dial}` : t('auth.register.country')}
      >
        <Text style={styles.flag}>{current?.flag ?? ''}</Text>
        {compact ? null : (
          <Text style={styles.fieldText} numberOfLines={1}>
            {current ? countryLabel(current) : ''}
          </Text>
        )}
        <Text style={styles.dial}>{current ? `‎+${current.dial}` : ''}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder={t('auth.register.countrySearch')}
              placeholderTextColor={colors.textMuted}
              autoFocus
              autoCorrect={false}
            />
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={<Text style={styles.empty}>{t('common.noResults')}</Text>}
              renderItem={({ item }) => {
                const active = item.code === selected;
                return (
                  <Pressable
                    style={[styles.row, active && styles.rowActive]}
                    onPress={() => {
                      onSelect(item.code);
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={styles.flag}>{item.flag}</Text>
                    <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>
                      {countryLabel(item)}
                    </Text>
                    <Text style={styles.dial}>{`‎+${item.dial}`}</Text>
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // The compact form keeps the same height as a FormField input so the login row lines up.
  fieldCompact: { alignSelf: 'stretch' },
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
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing.md },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { colors, fonts } from '@/theme/tokens';

/**
 * M116 «تقييمات المشاريع»: the golden stars, everywhere the same. `StarsRow` displays a value
 * (halves rounded to the nearest half star); `StarsPicker` is the member's 1–5 input.
 */

function starNames(value: number): ('star' | 'star-half' | 'star-outline')[] {
  const half = Math.round(value * 2) / 2;
  return [1, 2, 3, 4, 5].map((slot) => (half >= slot ? 'star' : half >= slot - 0.5 ? 'star-half' : 'star-outline'));
}

export function StarsRow({ value, count, size = 14 }: { value: number | null; count?: number; size?: number }) {
  if (value === null) return null;
  return (
    <View style={styles.row} accessibilityLabel={t('ratings.a11y', { stars: String(value) })}>
      <View style={styles.stars}>
        {starNames(value).map((name, index) => (
          <Ionicons key={index} name={name} size={size} color={colors.gold} />
        ))}
      </View>
      <Text style={[styles.value, { fontSize: size - 1, lineHeight: size + 4 }]}>{value}</Text>
      {count !== undefined && count > 0 ? (
        <Text style={[styles.count, { fontSize: size - 2, lineHeight: size + 4 }]}>({count})</Text>
      ) : null}
    </View>
  );
}

export function StarsPicker({ value, onChange, size = 34 }: { value: number; onChange: (stars: number) => void; size?: number }) {
  return (
    <View style={styles.picker}>
      {[1, 2, 3, 4, 5].map((slot) => (
        <Pressable
          key={slot}
          onPress={() => onChange(slot)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('ratings.a11y', { stars: String(slot) })}
        >
          <Ionicons name={value >= slot ? 'star' : 'star-outline'} size={size} color={value >= slot ? colors.gold : colors.textSecondary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  value: { fontFamily: fonts.semiBold, color: colors.gold },
  count: { fontFamily: fonts.regular, color: colors.textSecondary },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

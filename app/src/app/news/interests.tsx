import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useNewsPrefs, useNewsTopics, useSaveNewsPrefs } from '@/api/news';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { colors, spacing, typography } from '@/theme/tokens';

/** The member's news interests, stored with the account so every device sees the same ranking. */
export default function InterestsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const topics = useNewsTopics();
  const prefs = useNewsPrefs(signedIn);
  const save = useSaveNewsPrefs();
  // Untouched until the first tap: the saved interests, or the persona's suggestion for a new member.
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? (prefs.data ? (prefs.data.saved ? prefs.data.topics : prefs.data.suggested) : null);

  if (!signedIn) {
    return (
      <Screen title="اهتماماتي">
        <Notice text="سجّل الدخول لحفظ اهتماماتك وترتيب الأخبار حسبها." />
        <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  if (!topics.data || !prefs.data || selected === null) {
    return (
      <Screen title="اهتماماتي">
        <StateView loading={topics.isPending || prefs.isPending} error={topics.error ?? prefs.error} onRetry={() => void Promise.all([topics.refetch(), prefs.refetch()])} />
      </Screen>
    );
  }

  const toggle = (key: string) => setPicked(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  const suggestedLabels = prefs.data.suggested.map((key) => topics.data?.topics.find((topic) => topic.key === key)?.label).filter(Boolean);

  const submit = async () => {
    try {
      await save.mutateAsync(selected);
      if (router.canGoBack()) router.back();
      else router.replace('/news');
    } catch {
      // The mutation error is shown below.
    }
  };

  return (
    <Screen title="اهتماماتي" subtitle="اختر ما يهمك؛ تُرتَّب الأخبار لك حسب اختيارك، ويبقى قسم «قرارات وأنظمة المملكة» ثابتًا للجميع.">
      <View style={styles.chips}>
        {topics.data.topics.map((topic) => (
          <Chip key={topic.key} label={topic.label} selected={selected.includes(topic.key)} onPress={() => toggle(topic.key)} />
        ))}
      </View>
      {suggestedLabels.length > 0 ? (
        <View style={styles.suggestion}>
          <Text style={styles.suggestionText}>{`مقترح لصفتك في النادي: ${suggestedLabels.join('، ')}`}</Text>
          <AppButton label="اختيار المقترح" variant="outline" icon="checkmark-done-outline" onPress={() => setPicked(prefs.data?.suggested ?? [])} />
        </View>
      ) : null}
      {save.error ? <Text style={styles.error}>{errorMessage(save.error)}</Text> : null}
      <AppButton label={save.isPending ? 'جارٍ الحفظ…' : 'حفظ الاهتمامات'} icon="save-outline" onPress={() => void submit()} />
      <Text style={styles.footnote}>{selected.length === 0 ? 'بدون اختيار تُرتَّب الأخبار حسب الأهمية والحداثة فقط.' : `${selected.length} اهتمامات مختارة`}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestion: { gap: spacing.sm },
  suggestionText: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  error: { ...typography.caption, color: colors.danger, textAlign: 'right' },
  footnote: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

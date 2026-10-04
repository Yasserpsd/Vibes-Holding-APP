import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useNewsPrefs, useNewsTopics, useSaveNewsPrefs } from '@/api/news';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { entranceDelay, FadeInView, PopIn, useCountUp } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
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
  // The footnote's number rolls to its new value instead of jumping.
  const shownCount = useCountUp(selected?.length ?? 0, 450);

  if (!signedIn) {
    return (
      <Screen title={t('nav.interests')}>
        <FadeInView delay={entranceDelay(1)}>
          <Notice text={t('news.interests.signInNotice')} />
        </FadeInView>
        <FadeInView delay={entranceDelay(2)}>
          <AppButton label={t('account.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
        </FadeInView>
      </Screen>
    );
  }

  if (!topics.data || !prefs.data || selected === null) {
    return (
      <Screen title={t('nav.interests')}>
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
    <Screen title={t('nav.interests')} subtitle={t('news.interests.subtitle')}>
      <View style={styles.chips}>
        {topics.data.topics.map((topic, index) => (
          // Each chip springs into place, one after the other.
          <PopIn key={topic.key} delay={entranceDelay(index, 40, 12)}>
            <Chip label={topic.label} selected={selected.includes(topic.key)} onPress={() => toggle(topic.key)} />
          </PopIn>
        ))}
      </View>
      {suggestedLabels.length > 0 ? (
        <FadeInView delay={entranceDelay(4)} style={styles.suggestion}>
          <Text style={styles.suggestionText}>{t('news.interests.suggested', { topics: suggestedLabels.join(t('common.listSeparator')) })}</Text>
          <AppButton label={t('news.interests.useSuggested')} variant="outline" icon="checkmark-done-outline" onPress={() => setPicked(prefs.data?.suggested ?? [])} />
        </FadeInView>
      ) : null}
      {save.error ? (
        <FadeInView offset={6} duration={300}>
          <Text style={styles.error}>{errorMessage(save.error)}</Text>
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(5)}>
        <AppButton label={save.isPending ? t('news.interests.saving') : t('news.interests.save')} icon="save-outline" loading={save.isPending} onPress={() => void submit()} />
      </FadeInView>
      <Text style={styles.footnote}>{selected.length === 0 ? t('news.interests.none') : t('news.interests.count', { count: shownCount })}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestion: { gap: spacing.sm },
  suggestionText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  footnote: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

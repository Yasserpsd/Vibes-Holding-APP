import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useInterests, useSaveInterests } from '@/api/interests';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView, PopIn, useCountUp } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * M107: ONE interests list for the whole app — picked at signup (1 to 3), edited here from «حسابي»
 * or the news tab. The same picks rank the news, filter the Projects Bank, badge the agenda and
 * target the notifications. «أخرى» opens a short text the management reviews monthly.
 */
export default function InterestsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const query = useInterests();
  const save = useSaveInterests();
  // Untouched until the first tap: the saved interests, or the persona's suggestion for a new member.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const data = query.data;
  const selected = picked ?? (data ? (data.saved ? (data.mine?.keys ?? []) : data.suggested) : null);
  const otherText = other ?? data?.mine?.other ?? '';
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

  if (!data || selected === null) {
    return (
      <Screen title={t('nav.interests')}>
        <StateView loading={query.isPending} error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const max = data.max;
  const toggle = (key: string) =>
    setPicked(selected.includes(key) ? selected.filter((item) => item !== key) : selected.length >= max ? selected : [...selected, key]);
  const suggestedLabels = data.suggested.map((key) => data.interests.find((item) => item.key === key)?.label).filter(Boolean);

  const submit = async () => {
    try {
      await save.mutateAsync({ keys: selected, other: otherText.trim() || undefined });
      if (router.canGoBack()) router.back();
      else router.replace('/news');
    } catch {
      // The mutation error is shown below.
    }
  };

  return (
    <Screen title={t('nav.interests')} subtitle={t('interests.subtitle')}>
      <View style={styles.chips}>
        {data.interests.map((interest, index) => (
          // Each chip springs into place, one after the other.
          <PopIn key={interest.key} delay={entranceDelay(index, 40, 12)}>
            <Chip label={interest.label} selected={selected.includes(interest.key)} onPress={() => toggle(interest.key)} />
          </PopIn>
        ))}
      </View>
      {selected.includes('other') ? (
        <FadeInView offset={8}>
          <FormField label={t('interests.otherLabel')} value={otherText} onChangeText={setOther} placeholder={t('interests.otherPlaceholder')} maxLength={120} />
        </FadeInView>
      ) : null}
      {suggestedLabels.length > 0 && !data.saved ? (
        <FadeInView delay={entranceDelay(4)} style={styles.suggestion}>
          <Text style={styles.suggestionText}>{t('news.interests.suggested', { topics: suggestedLabels.join(t('common.listSeparator')) })}</Text>
          <AppButton label={t('news.interests.useSuggested')} variant="outline" icon="checkmark-done-outline" onPress={() => setPicked(data.suggested)} />
        </FadeInView>
      ) : null}
      {save.error ? (
        <FadeInView offset={6} duration={300}>
          <Text style={styles.error}>{errorMessage(save.error)}</Text>
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(5)}>
        <AppButton
          label={save.isPending ? t('news.interests.saving') : t('news.interests.save')}
          icon="save-outline"
          loading={save.isPending}
          disabled={selected.length === 0}
          onPress={() => void submit()}
        />
      </FadeInView>
      <Text style={styles.footnote}>{selected.length === 0 ? t('interests.pickAtLeastOne') : t('interests.count', { count: shownCount, max })}</Text>
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

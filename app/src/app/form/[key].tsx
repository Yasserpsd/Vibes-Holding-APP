import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import type { ScrollView } from 'react-native';

import { ApiError } from '@/api/client';
import { useFormDef } from '@/api/forms';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { FormEmbed } from '@/components/FormEmbed';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';

/** M16: a website registration form, native — the fields come from the server, the answers go back to it. */
export default function RegistrationFormScreen() {
  const { key, ticks } = useLocalSearchParams<{ key: string; ticks?: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useFormDef(key);
  // The form scrolls the screen to its first red field after a failed submit.
  const scrollRef = useRef<ScrollView | null>(null);
  useAdvisorScreen(data ? { type: 'service', id: `form-${data.form.key}`, title: data.form.title } : null);

  if (!data) {
    // A form key that no longer exists (an old link): say so and lead to the services, a retry would only fail again.
    if (error instanceof ApiError && error.status === 404) {
      return (
        <Screen>
          <StateView empty emptyText={t('errors.code.not_found')} />
          <AppButton label={t('nav.services')} variant="outline" icon="grid-outline" onPress={() => router.replace('/services')} />
        </Screen>
      );
    }
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen title={data.form.title} subtitle={data.form.intro} scrollRef={scrollRef}>
      <FormEmbed formKey={data.form.key} scrollRef={scrollRef} ticks={ticks ? ticks.split(',').filter(Boolean) : undefined} />
    </Screen>
  );
}

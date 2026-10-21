import { useLocalSearchParams } from 'expo-router';

import { useFormDef } from '@/api/forms';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { FormEmbed } from '@/components/FormEmbed';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';

/** M16: a website registration form, native — the fields come from the server, the answers go back to it. */
export default function RegistrationFormScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { data, isLoading, error, refetch } = useFormDef(key);
  useAdvisorScreen(data ? { type: 'service', id: `form-${data.form.key}`, title: data.form.title } : null);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen title={data.form.title} subtitle={data.form.intro}>
      <FormEmbed formKey={data.form.key} />
    </Screen>
  );
}

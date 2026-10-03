import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AGREED, useFormDef, useMyFormSubmissions, useSubmitForm, type FormDef, type FormField as FormFieldDef } from '@/api/forms';
import type { Me } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** M16: a website registration form, native — the fields come from the server, the answers go back to it. */
export default function RegistrationFormScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useFormDef(key);
  const signedIn = status === 'signedIn' && Boolean(me);
  const mine = useMyFormSubmissions(signedIn);
  useAdvisorScreen(data ? { type: 'service', id: `form-${data.form.key}`, title: data.form.title } : null);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { form } = data;
  const alreadySent = form.once && (mine.data?.submissions.some((entry) => entry.formKey === form.key) ?? false);

  return (
    <Screen title={form.title} subtitle={form.intro}>
      {!form.open ? (
        <Notice tone="warning" text={form.closedText} />
      ) : form.access === 'signedIn' && !signedIn ? (
        <>
          <Notice tone="warning" text={t('form.guest')} />
          <AppButton label={t('form.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
        </>
      ) : alreadySent ? (
        <Notice tone="success" text={t('form.alreadySent')} />
      ) : (
        // Mounted once the account is known, so the fields start prefilled without an effect.
        <Form key={form.key} form={form} me={me} />
      )}
    </Screen>
  );
}

/** What the signed-in account already answers; the member can still edit every field. */
function prefillOf(field: FormFieldDef, me: Me | null): string {
  if (!me || !field.prefill) return '';
  if (field.prefill === 'phone') return me.phone;
  if (field.prefill === 'email') return me.email;
  const space = me.name.indexOf(' ');
  if (field.prefill === 'firstName') return space < 0 ? me.name : me.name.slice(0, space);
  return space < 0 ? '' : me.name.slice(space + 1);
}

function Form({ form, me }: { form: FormDef; me: Me | null }) {
  const submit = useSubmitForm(form.key);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(form.fields.map((field) => [field.key, prefillOf(field, me)])));
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const setAnswer = (fieldKey: string, value: string) => setAnswers((current) => ({ ...current, [fieldKey]: value }));

  const send = () => {
    if (submit.isPending) return;
    for (const field of form.fields) {
      if (field.required && !(answers[field.key] ?? '').trim()) {
        setProblem(field.type === 'agree' ? t('form.agree', { field: field.label }) : t('form.missing', { field: field.label }));
        return;
      }
    }
    setProblem(null);
    submit.mutate(answers, { onSuccess: () => setSent(true) });
  };

  if (sent) {
    return (
      <View style={styles.success}>
        <Ionicons name="checkmark-circle" size={48} color={colors.gold} />
        <Text style={styles.successText}>{form.successText}</Text>
      </View>
    );
  }

  return (
    <>
      {form.fields.map((field) => (
        <Field key={field.key} field={field} value={answers[field.key] ?? ''} onChange={(value) => setAnswer(field.key, value)} />
      ))}
      {problem ? <Notice tone="warning" text={problem} /> : null}
      {submit.error ? <Notice tone="warning" text={submit.error.message} /> : null}
      <AppButton label={submit.isPending ? '…' : form.submitLabel} icon="paper-plane-outline" onPress={send} />
    </>
  );
}

function Field({ field, value, onChange }: { field: FormFieldDef; value: string; onChange: (value: string) => void }) {
  if (field.type === 'agree') {
    const on = value === AGREED;
    return (
      <View style={styles.agree}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          style={styles.agreeRow}
          onPress={() => onChange(on ? '' : AGREED)}
        >
          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.gold : colors.textMuted} />
          <Text style={styles.agreeLabel}>{field.label}</Text>
        </Pressable>
        {field.url ? <AppButton label={t('form.openAgreement')} variant="outline" icon="open-outline" onPress={() => void openLink(field.url ?? '')} /> : null}
      </View>
    );
  }
  if (field.type === 'select') {
    return (
      <View style={styles.select}>
        <Text style={styles.selectLabel}>{field.label}</Text>
        <View style={styles.chips}>
          {(field.options ?? []).map((option) => (
            <Chip key={option} label={option} selected={value === option} onPress={() => onChange(value === option ? '' : option)} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <FormField
      label={field.label}
      value={value}
      onChangeText={onChange}
      placeholder={field.placeholder}
      multiline={field.type === 'textarea'}
      latin={field.latin}
      autoCapitalize={field.latin ? 'none' : undefined}
      autoCorrect={field.latin ? false : undefined}
      maxLength={field.type === 'textarea' ? 2000 : 300}
    />
  );
}

const styles = StyleSheet.create({
  select: { gap: spacing.xs },
  selectLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  agree: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  agreeLabel: { ...typography.caption, color: colors.textPrimary, flex: 1, textAlign: textStart },
  success: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  successText: { ...typography.body, color: colors.textPrimary, textAlign: 'center' },
});

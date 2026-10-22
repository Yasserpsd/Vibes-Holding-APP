import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AGREED, useFormDef, useMyFormSubmissions, useSubmitForm, type FormDef, type FormField as FormFieldDef } from '@/api/forms';
import type { Me } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { showMembershipGate } from '@/components/MembershipGate';
import { entranceDelay, FadeInView, PopIn } from '@/components/motion';
import { PaperCard, usePaper } from '@/components/paper';
import { Notice } from '@/components/Notice';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M119: the M16 registration form as an embeddable block — the form screen renders it alone,
 * and a meetup page renders it under the meetup's video and pitch. The server defines the
 * fields and validates the answers; access gates (sign-in, membership, closed, already sent)
 * show their friendly face here.
 */
export function FormEmbed({ formKey }: { formKey: string | undefined }) {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useFormDef(formKey);
  const signedIn = status === 'signedIn' && Boolean(me);
  const mine = useMyFormSubmissions(signedIn);

  if (!data) return <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />;

  const { form } = data;
  const alreadySent = form.once && (mine.data?.submissions.some((entry) => entry.formKey === form.key) ?? false);

  if (!form.open) {
    return (
      <FadeInView>
        <Notice tone="warning" text={form.closedText} />
      </FadeInView>
    );
  }
  if (form.access !== 'everyone' && !signedIn) {
    return (
      <>
        <FadeInView>
          <Notice tone="warning" text={t('form.guest')} />
        </FadeInView>
        <FadeInView delay={entranceDelay(1)}>
          <AppButton label={t('form.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
        </FadeInView>
      </>
    );
  }
  if (form.access === 'member' && me?.membership.status !== 'active') {
    // M73: the server refuses non-members anyway; this is the friendly face of that gate.
    return (
      <>
        <FadeInView>
          <Notice tone="warning" text={t('form.membersOnly')} />
        </FadeInView>
        <FadeInView delay={entranceDelay(1)}>
          {/* M120 (owner): the lock answers with the subscribe popup — price and pay in one tap. */}
          <AppButton label={t('gate.activateNow')} icon="star-outline" onPress={showMembershipGate} />
        </FadeInView>
      </>
    );
  }
  if (alreadySent) {
    return (
      <FadeInView>
        <Notice tone="success" text={t('form.alreadySent')} />
      </FadeInView>
    );
  }
  // Mounted once the account is known, so the fields start prefilled without an effect.
  return <Form key={form.key} form={form} me={me} />;
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
    // V2: the confirmation lands with a golden pop — celebratory, but quiet.
    return (
      <FadeInView offset={12} style={styles.success}>
        <PopIn delay={120}>
          <Ionicons name="checkmark-circle" size={48} color={colors.gold} />
        </PopIn>
        <Text style={styles.successText}>{form.successText}</Text>
      </FadeInView>
    );
  }

  return (
    // M85 (owner): the whole registration form sits on one paper sheet.
    <PaperCard pinned>
      {form.fields.map((field, index) => (
        <FadeInView key={field.key} delay={entranceDelay(index)}>
          <Field field={field} value={answers[field.key] ?? ''} onChange={(value) => setAnswer(field.key, value)} />
        </FadeInView>
      ))}
      {problem ? (
        <FadeInView offset={8}>
          <Notice tone="warning" text={problem} />
        </FadeInView>
      ) : null}
      {submit.error ? (
        <FadeInView offset={8}>
          <Notice tone="warning" text={submit.error.message} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(form.fields.length)}>
        <AppButton label={form.submitLabel} icon="paper-plane-outline" loading={submit.isPending} onPress={send} />
      </FadeInView>
    </PaperCard>
  );
}

function Field({ field, value, onChange }: { field: FormFieldDef; value: string; onChange: (value: string) => void }) {
  const paper = usePaper();
  if (field.type === 'agree') {
    const on = value === AGREED;
    return (
      <View style={[styles.agree, paper && styles.paperAgree, on && paper && styles.paperAgreeOn]}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          style={styles.agreeRow}
          onPress={() => onChange(on ? '' : AGREED)}
        >
          {on ? (
            <PopIn>
              <Ionicons name="checkbox" size={24} color={paper ? colors.paperGold : colors.gold} />
            </PopIn>
          ) : (
            <Ionicons name="square-outline" size={24} color={paper ? colors.paperMuted : colors.textMuted} />
          )}
          <Text style={[styles.agreeLabel, paper && styles.paperAgreeLabel]}>{field.label}</Text>
        </Pressable>
        {field.url ? <AppButton label={t('form.openAgreement')} variant="outline" icon="open-outline" onPress={() => void openLink(field.url ?? '')} /> : null}
      </View>
    );
  }
  if (field.type === 'select') {
    return (
      <View style={styles.select}>
        <Text style={[styles.selectLabel, paper && styles.paperSelectLabel]}>{field.label}</Text>
        <View style={styles.chips}>
          {(field.options ?? []).map((option) => (
            <Chip key={option} label={option} selected={value === option} dimmed={Boolean(value)} onPress={() => onChange(value === option ? '' : option)} />
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
  // M85: the agreement box on paper.
  paperAgree: { backgroundColor: colors.paperCard, borderColor: colors.paperBorder },
  paperAgreeOn: { borderColor: colors.paperGold },
  paperAgreeLabel: { color: colors.paperInk },
  paperSelectLabel: { color: colors.paperInkSoft },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  agreeLabel: { ...typography.caption, color: colors.textPrimary, flex: 1, textAlign: textStart },
  success: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  successText: { ...typography.body, color: colors.textPrimary, textAlign: 'center' },
});

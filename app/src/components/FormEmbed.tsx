import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type Ref, type RefObject } from 'react';
import { Pressable, Text, View, type ScrollView } from 'react-native';

import { errorMessage } from '@/api/client';
import { AGREED, useFormDef, useMyFormSubmissions, useSubmitForm, type FormDef, type FormField as FormFieldDef } from '@/api/forms';
import type { Me } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { ErrorSummary, FieldError, RequiredMark } from '@/components/form/FormParts';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { FormFileField } from '@/components/FormFileField';
import { GlassCard } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { entranceDelay, FadeInView, PopIn } from '@/components/motion';
import { PaperCard, usePaper } from '@/components/paper';
import { Notice } from '@/components/Notice';
import { StateView } from '@/components/StateView';
import { VoiceFill, type FillField } from '@/components/VoiceFill';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { themedStyles } from '@/theme/styles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M119: the M16 registration form as an embeddable block — the form screen renders it alone,
 * and a meetup page renders it under the meetup's video and pitch. The server defines the
 * fields and validates the answers; access gates (sign-in, membership, closed, already sent)
 * show their friendly face here.
 * The hosting screen may pass its ScrollView ref: a failed submit then scrolls to the first red field.
 */
export function FormEmbed({ formKey, scrollRef }: { formKey: string | undefined; scrollRef?: RefObject<ScrollView | null> }) {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useFormDef(formKey);
  const signedIn = status === 'signedIn' && Boolean(me);
  const mine = useMyFormSubmissions(signedIn);

  if (!data) return <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />;

  const { form } = data;
  // A once-only form waits for the member's own submissions, so the form never flashes before «already sent».
  if (form.once && signedIn && mine.isLoading) return <StateView loading />;
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
  return (
    <>
      {/* M170 (owner, 2026-10-31): a signed-in NON-MEMBER reads the condition before he fills the form —
          the page stays open to everyone, the project simply waits for the membership. Guests see nothing extra. */}
      {form.nonMemberNotice && me && me.membership.status !== 'active' ? <MemberNotice text={form.nonMemberNotice} /> : null}
      <Form key={form.key} form={form} me={me} signedIn={signedIn} scrollRef={scrollRef} />
    </>
  );
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What the signed-in account already answers; the member can still edit every field. */
function prefillOf(field: FormFieldDef, me: Me | null): string {
  if (!me || !field.prefill) return '';
  if (field.prefill === 'phone') return me.phone;
  if (field.prefill === 'email') return me.email;
  const space = me.name.indexOf(' ');
  if (field.prefill === 'firstName') return space < 0 ? me.name : me.name.slice(0, space);
  return space < 0 ? '' : me.name.slice(space + 1);
}

function Form({ form, me, signedIn, scrollRef }: { form: FormDef; me: Me | null; signedIn: boolean; scrollRef?: RefObject<ScrollView | null> }) {
  const submit = useSubmitForm(form.key);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(form.fields.map((field) => [field.key, prefillOf(field, me)])));
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // M193: an attachment still on its way holds the submit button.
  const [uploading, setUploading] = useState(false);
  // The red-error discipline of every form (M195): the red field + its message, a summary on top, a scroll to the first one.
  const marks = useFormErrors<string>(scrollRef);

  const setAnswer = (fieldKey: string, value: string) => {
    setAnswers((current) => ({ ...current, [fieldKey]: value }));
    marks.clear(fieldKey);
    // The line under the button described the old problem; the next submit writes a fresh one.
    setProblem(null);
  };

  const send = () => {
    if (submit.isPending) return;
    if (uploading) {
      setProblem(t('form.file.wait'));
      return;
    }
    const found: Record<string, string> = {};
    // The line under the button names the first problem, for a long form scrolled far from the red field.
    let firstProblem: string | null = null;
    for (const field of form.fields) {
      const value = (answers[field.key] ?? '').trim();
      let message: string | null = null;
      let sentence: string | null = null;
      if (field.required && !value) {
        message = field.type === 'agree' ? t('form.agree', { field: field.label }) : field.type === 'select' ? t('form.error.choose') : t('form.error.required');
        sentence = field.type === 'agree' ? message : t('form.missing', { field: field.label });
      } else if (value && field.prefill === 'email' && !EMAIL_SHAPE.test(value)) {
        message = t('form.error.email');
        sentence = message;
      }
      if (message) {
        found[field.key] = message;
        firstProblem ??= sentence;
      }
    }
    if (marks.fail(found, form.fields.map((field) => field.key))) {
      setProblem(firstProblem);
      return;
    }
    setProblem(null);
    submit.mutate(answers, {
      onSuccess: () => {
        setSent(true);
        // The confirmation sits at the top of the page; the long form had scrolled the member down.
        scrollRef?.current?.scrollTo({ y: 0, animated: true });
      },
    });
  };

  if (sent) {
    // V2: the confirmation lands with a golden pop — celebratory, but quiet.
    return (
      <>
        <FadeInView offset={12} style={styles.success}>
          <PopIn delay={120}>
            <Ionicons name="checkmark-circle" size={48} color={colors.gold} />
          </PopIn>
          <Text style={styles.successText}>{form.successText}</Text>
        </FadeInView>
        {form.memberNudge && me?.membership.status !== 'active' ? <MemberNotice title={t('form.nudgeTitle')} text={form.memberNudge} delay={200} /> : null}
      </>
    );
  }

  return (
    // M85 (owner): the whole registration form sits on one paper sheet.
    <PaperCard pinned>
      <ErrorSummary count={marks.count} />
      {/* M142: every field but the consent box can be spoken. */}
      <VoiceFill
        fields={form.fields
          .filter((field) => field.type !== 'agree' && field.type !== 'file')
          .map(
            (field): FillField => ({
              key: field.key,
              label: field.label,
              type: field.type === 'select' ? 'select' : field.type === 'textarea' ? 'textarea' : field.prefill === 'phone' ? 'phone' : field.prefill === 'email' ? 'email' : 'text',
              options: field.options,
              required: field.required,
            }),
          )}
        values={answers}
        onFill={(values) => setAnswers((current) => ({ ...current, ...values }))}
      />
      {form.fields.map((field, index) => (
        <FadeInView key={field.key} delay={entranceDelay(index)}>
          {field.type === 'file' ? (
            <View ref={marks.anchor(field.key)} collapsable={false} style={styles.fileBox}>
              <FormFileField
                formKey={form.key}
                label={field.label}
                required={field.required}
                signedIn={signedIn}
                value={answers[field.key] ?? ''}
                onChange={(value) => setAnswer(field.key, value)}
                onBusy={setUploading}
              />
              {marks.errors[field.key] ? <FieldError text={marks.errors[field.key] ?? ''} /> : null}
            </View>
          ) : (
            <Field field={field} value={answers[field.key] ?? ''} onChange={(value) => setAnswer(field.key, value)} error={marks.errors[field.key]} anchorRef={marks.anchor(field.key)} />
          )}
        </FadeInView>
      ))}
      {problem ? (
        <FadeInView offset={8}>
          <Notice tone="warning" text={problem} support />
        </FadeInView>
      ) : null}
      {submit.error ? (
        <FadeInView offset={8}>
          <Notice tone="warning" text={errorMessage(submit.error)} support />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(form.fields.length)}>
        <AppButton label={form.submitLabel} icon="paper-plane-outline" loading={submit.isPending} disabled={uploading} onPress={send} />
      </FadeInView>
    </PaperCard>
  );
}

/**
 * The membership condition for a non-member, in the page itself (server text) with the subscribe door.
 * M170 (owner, 2026-10-31): nothing membership-related pops up by itself any more — the after-submission
 * popup of 2026-10-25 became this inline card; the store popup opens only when the member taps the button.
 */
function MemberNotice({ title, text, delay = 0 }: { title?: string; text: string; delay?: number }) {
  return (
    <FadeInView delay={delay} offset={8}>
      <GlassCard golden radius={radii.lg} style={styles.notice}>
        {title ? <Text style={styles.noticeTitle}>{title}</Text> : null}
        <Notice tone="warning" text={text} />
        <AppButton label={t('gate.activateNow')} icon="ribbon-outline" onPress={showMembershipGate} />
      </GlassCard>
    </FadeInView>
  );
}

function Field({ field, value, onChange, error, anchorRef }: { field: FormFieldDef; value: string; onChange: (value: string) => void; error?: string; anchorRef: Ref<View> }) {
  const paper = usePaper();
  if (field.type === 'agree') {
    const on = value === AGREED;
    return (
      <View ref={anchorRef} collapsable={false} style={styles.fileBox}>
        <View style={[styles.agree, paper && styles.paperAgree, on && paper && styles.paperAgreeOn, error ? styles.agreeError : null]}>
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
        {error ? <FieldError text={error} /> : null}
      </View>
    );
  }
  if (field.type === 'select') {
    return (
      <View ref={anchorRef} collapsable={false} style={styles.select}>
        <Text style={[styles.selectLabel, paper && styles.paperSelectLabel]}>
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </Text>
        <View style={styles.chips}>
          {(field.options ?? []).map((option) => (
            <Chip key={option} label={option} selected={value === option} dimmed={Boolean(value)} onPress={() => onChange(value === option ? '' : option)} />
          ))}
        </View>
        {error ? <FieldError text={error} /> : null}
      </View>
    );
  }
  // Phone and e-mail are Latin whatever the form says: typed left-to-right inside the right-to-left form, with their own keyboard.
  const phone = field.prefill === 'phone';
  const email = field.prefill === 'email';
  const latin = Boolean(field.latin) || phone || email;
  return (
    <FormField
      label={field.label}
      required={field.required}
      value={value}
      onChangeText={onChange}
      placeholder={field.placeholder}
      multiline={field.type === 'textarea'}
      latin={latin}
      error={error}
      anchorRef={anchorRef}
      keyboardType={phone ? 'phone-pad' : email ? 'email-address' : undefined}
      textContentType={phone ? 'telephoneNumber' : email ? 'emailAddress' : undefined}
      autoComplete={phone ? 'tel' : email ? 'email' : undefined}
      autoCapitalize={latin ? 'none' : undefined}
      autoCorrect={latin ? false : undefined}
      maxLength={field.type === 'textarea' ? 2000 : 300}
    />
  );
}

const styles = themedStyles(() => ({
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
  agreeError: { borderColor: colors.danger },
  fileBox: { gap: spacing.xs },
  paperAgreeLabel: { color: colors.paperInk },
  paperSelectLabel: { color: colors.paperInkSoft },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  agreeLabel: { ...typography.caption, color: colors.textPrimary, flex: 1, textAlign: textStart },
  success: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  successText: { ...typography.body, color: colors.textPrimary, textAlign: 'center' },
  // M170: the inline membership condition (before the form, and after the success check).
  notice: { gap: spacing.sm, padding: spacing.md },
  noticeTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
}));

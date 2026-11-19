import { Stack, useRouter, type Href } from 'expo-router';
import { useRef, useState, type RefObject } from 'react';
import type { ScrollView } from 'react-native';

import { useApplyProfile, useMyProfile, type MyProfile } from '@/api/people';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormFailure, failureOf, type Failure } from '@/components/form/FormFailure';
import { ErrorSummary, type FieldFix } from '@/components/form/FormParts';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PaperCard } from '@/components/paper';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { VoiceFill } from '@/components/VoiceFill';
import { getLang, t } from '@/i18n';
import { badLines, badLinkLines, emailFix, firstLines, fitLines, linesOf, linksFromText, linksToText, withoutBadLinks } from '@/lib/fixes';
import { cleanEmail, isEmail } from '@/lib/validation';

type Key = 'title' | 'company' | 'specialty' | 'city' | 'bio' | 'milestones' | 'achievements' | 'benefit' | 'seeking' | 'phone' | 'email' | 'links';
type Values = Record<Key, string>;

/** The fields in the order they sit on the sheet: the screen goes to the first one that is wrong. */
const ORDER: Key[] = ['title', 'company', 'specialty', 'city', 'bio', 'milestones', 'achievements', 'benefit', 'seeking', 'phone', 'email', 'links'];
/** The lists typed one item per line, with the server's own limits (server/src/profiles/routes.ts). */
const LISTS: Partial<Record<Key, { min: number; max: number; most: number }>> = {
  milestones: { min: 3, max: 140, most: 10 },
  achievements: { min: 3, max: 300, most: 10 },
  benefit: { min: 3, max: 200, most: 10 },
};
const MOST_LINKS = 5;
const BIO_MIN = 30;

type Verdict = { message: string; fix?: { label: string; value: string } };

/**
 * M253 (owner's screenshot, 2026-11-19: this form answered «Some of the details entered are not valid» and named
 * no field): the verdict on one field BEFORE anything is sent — the server's own rules, each with its sentence —
 * and the one-tap correction where there is one right answer (a long line split in two, a line that is not a
 * link removed, the e-mail meant).
 */
function verdict(key: Key, values: Values): Verdict | null {
  const value = values[key].trim();
  const comma = getLang() === 'ar' ? '، ' : ', ';
  const list = LISTS[key];
  if (list) {
    const count = linesOf(value).length;
    if (key === 'milestones' && !count) return { message: t('people.error.milestones') };
    const bad = badLines(value, list.min, list.max);
    if (bad.length) {
      return { message: t('people.error.lines', { lines: bad.join(comma), min: list.min, max: list.max }), fix: { label: t('people.fix.lines'), value: fitLines(value, list.min, list.max) } };
    }
    if (count > list.most) return { message: t('people.error.tooMany', { most: list.most, count }), fix: { label: t('people.fix.first', { most: list.most }), value: firstLines(value, list.most) } };
    return null;
  }
  switch (key) {
    case 'title':
      return value.length < 2 ? { message: t('people.error.title') } : null;
    case 'specialty':
      return value.length < 2 ? { message: t('people.error.specialty') } : null;
    case 'city':
      return value.length < 2 ? { message: t('people.error.city') } : null;
    case 'bio':
      return value.length < BIO_MIN ? { message: t('people.error.bio', { left: BIO_MIN - value.length }) } : null;
    case 'email': {
      if (!value || isEmail(value)) return null;
      const meant = emailFix(value);
      return { message: t('form.error.email'), ...(meant ? { fix: { label: t('form.fix.use', { value: meant }), value: meant } } : {}) };
    }
    case 'links': {
      const bad = badLinkLines(value);
      if (bad.length) return { message: t('people.error.links', { lines: bad.join(comma) }), fix: { label: t('people.fix.badLinks'), value: withoutBadLinks(value) } };
      const count = linksFromText(value).length;
      if (count > MOST_LINKS) return { message: t('people.error.tooMany', { most: MOST_LINKS, count }), fix: { label: t('people.fix.first', { most: MOST_LINKS }), value: firstLines(value, MOST_LINKS) } };
      return null;
    }
    default:
      return null;
  }
}

/** M11: the member's own «شخصية ومسيرة» application — apply, read the review state, edit again. */
export default function ApplyProfileScreen() {
  const router = useRouter();
  const { me, status } = useAuth();
  const signedIn = status === 'signedIn' && Boolean(me);
  const mine = useMyProfile(signedIn);
  const scrollRef = useRef<ScrollView>(null);

  if (!signedIn) {
    return (
      <Screen title={t('people.title')}>
        <Stack.Screen options={{ title: t('nav.peopleApply') }} />
        <Notice tone="warning" text={t('people.guest')} />
        <AppButton label={t('people.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  const active = me?.membership.status === 'active';
  const profile = mine.data?.profile ?? null;

  return (
    <Screen scrollRef={scrollRef} title={t('people.title')} subtitle={mine.data?.intro ?? ''}>
      <Stack.Screen options={{ title: t('nav.peopleApply') }} />
      {!mine.data ? (
        <StateView loading={mine.isLoading} error={mine.error} onRetry={() => void mine.refetch()} />
      ) : !active && !profile ? (
        <>
          <Notice tone="warning" text={t('people.membership')} />
          <AppButton label={t('people.activate')} icon="ribbon-outline" onPress={() => router.push('/membership')} />
        </>
      ) : (
        // Mounted only once the saved words are known, so the fields start from them without an effect.
        <ApplyForm
          key={profile?.id ?? 'new'}
          profile={profile}
          me={me}
          scrollRef={scrollRef}
          onOpenProfile={(id) => router.push(`/people/${id}` as Href)}
          // The «تم الإرسال» notice sits at the head of the long form: bring it into view.
          onSent={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
        />
      )}
    </Screen>
  );
}

type ApplyFormProps = {
  profile: MyProfile | null;
  me: ReturnType<typeof useAuth>['me'];
  scrollRef: RefObject<ScrollView | null>;
  onOpenProfile: (id: string) => void;
  onSent: () => void;
};

function ApplyForm({ profile, me, scrollRef, onOpenProfile, onSent }: ApplyFormProps) {
  const apply = useApplyProfile();
  // The freshest submission prefills the form: the waiting draft when there is one, else the saved words.
  const fields = profile ? (profile.draft ?? profile.fields) : null;
  // M73: the spotlight sections (the contact fields start from the account; the member edits freely).
  const [values, setValues] = useState<Values>(() => ({
    title: fields?.title ?? '',
    company: fields?.company ?? '',
    specialty: fields?.specialty ?? '',
    city: fields?.city ?? '',
    bio: fields?.bio ?? '',
    milestones: fields ? fields.milestones.join('\n') : '',
    achievements: fields?.achievements ? fields.achievements.join('\n') : '',
    benefit: fields?.benefit ? fields.benefit.join('\n') : '',
    seeking: fields?.seeking ?? '',
    phone: fields?.phone ?? me?.phone ?? '',
    email: fields?.email ?? me?.email ?? '',
    links: fields ? linksToText(fields.links) : '',
  }));
  const errors = useFormErrors<Key>(scrollRef);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sent, setSent] = useState(false);
  const busy = apply.isPending;

  // Typing never paints a new red line; an existing one goes the moment the value is right (the sign-up form's rule).
  const set = (key: Key) => (value: string) => {
    const draft = { ...values, [key]: value };
    setValues(draft);
    if (!verdict(key, draft)) errors.clear(key);
  };
  // Leaving a field judges it. A red line the server painted is not cleared here: only a changed value clears it.
  const blur = (key: Key) => () => {
    let draft = values;
    // What the member cannot see or does not count as wrong is put right for them, as it will be sent.
    if (key === 'links') {
      const tidy = linksToText(linksFromText(values.links));
      if (tidy !== values.links.trim() && !badLinkLines(values.links).length) draft = { ...values, links: tidy };
    }
    if (key === 'email' && values.email) {
      const cleaned = cleanEmail(values.email);
      if (cleaned !== values.email) draft = { ...values, email: cleaned };
    }
    if (draft !== values) setValues(draft);
    const problem = verdict(key, draft);
    if (problem) errors.set(key, problem.message);
  };
  /** The correction button of a field that is red for a reason this screen can put right. */
  const fixOf = (key: Key): FieldFix | null => {
    if (!errors.errors[key]) return null;
    const fix = verdict(key, values)?.fix;
    return fix ? { label: fix.label, onPress: () => set(key)(fix.value) } : null;
  };
  // A right-looking address that is one slip away from a known provider: a caution with its correction, never a block.
  const emailMeant = !errors.errors.email && isEmail(values.email) ? emailFix(values.email) : null;

  const submit = () => {
    if (busy) return;
    setSent(false);
    setFailure(null);
    const next: Partial<Record<Key, string>> = {};
    for (const key of ORDER) {
      const problem = verdict(key, values);
      if (problem) next[key] = problem.message;
    }
    if (errors.fail(next, ORDER)) return;
    apply.mutate(
      {
        title: values.title.trim(),
        company: values.company.trim(),
        specialty: values.specialty.trim(),
        city: values.city.trim(),
        bio: values.bio.trim(),
        milestones: linesOf(values.milestones),
        achievements: linesOf(values.achievements),
        benefit: linesOf(values.benefit),
        seeking: values.seeking.trim(),
        phone: values.phone.trim(),
        email: cleanEmail(values.email),
        links: linksFromText(values.links),
      },
      {
        onSuccess: () => {
          setSent(true);
          onSent();
        },
        // M253: the server's refusal goes under the field it names; only a refusal about no field sits by the button.
        onError: (cause) => {
          if (!errors.fromServer(cause, ORDER).length) setFailure(failureOf(cause));
        },
      },
    );
  };

  /** What every field of the sheet shares: its value, its red line and correction, and its place for the scroll. */
  const bind = (key: Key) => ({
    value: values[key],
    onChangeText: set(key),
    onBlur: blur(key),
    error: errors.errors[key],
    fix: fixOf(key),
    anchorRef: errors.anchor(key),
  });

  return (
    <>
      {sent ? (
        <FadeInView offset={8}>
          <Notice tone="success" text={t('people.applied')} />
        </FadeInView>
      ) : null}
      {profile?.status === 'pending' ? (
        <FadeInView offset={10}>
          <Notice tone="info" text={t('people.pending')} />
        </FadeInView>
      ) : null}
      {profile?.status === 'approved' && profile.draft ? (
        <FadeInView offset={10}>
          <Notice tone="info" text={t('people.pendingEdit')} />
        </FadeInView>
      ) : null}
      {profile?.status === 'approved' && !profile.draft && !sent ? (
        <FadeInView offset={10}>
          <Notice tone="success" text={t('people.approved')} />
        </FadeInView>
      ) : null}
      {profile?.status === 'rejected' && profile.note ? (
        <FadeInView offset={10}>
          <Notice tone="warning" text={`${t('people.rejectedTitle')}: ${profile.note}`} />
        </FadeInView>
      ) : null}
      {profile?.status === 'approved' ? (
        <FadeInView delay={entranceDelay(1)}>
          <AppButton label={t('people.view')} variant="outline" icon="person-circle-outline" onPress={() => onOpenProfile(profile.id)} />
        </FadeInView>
      ) : null}

      {/* M85 (owner): the application fields sit on one paper sheet. */}
      <PaperCard pinned>
      <ErrorSummary count={errors.count} />
      <VoiceFill
        fields={[
          { key: 'title', label: t('people.form.title'), type: 'text', required: true },
          { key: 'company', label: t('people.form.company'), type: 'text' },
          { key: 'specialty', label: t('people.form.specialty'), type: 'text', hint: t('people.form.specialtyHint') },
          { key: 'city', label: t('people.form.city'), type: 'text' },
          { key: 'bio', label: t('people.form.bio'), type: 'textarea', required: true, hint: t('people.form.bioHint') },
          { key: 'milestones', label: t('people.form.milestones'), type: 'textarea' },
          { key: 'achievements', label: t('people.form.achievements'), type: 'textarea' },
          { key: 'benefit', label: t('people.form.benefit'), type: 'textarea' },
          { key: 'seeking', label: t('people.form.seeking'), type: 'textarea' },
          { key: 'phone', label: t('people.form.phone'), type: 'phone' },
          { key: 'email', label: t('people.form.email'), type: 'email' },
          { key: 'links', label: t('people.form.links'), type: 'textarea' },
        ]}
        values={values}
        onFill={(filled) => {
          const draft = { ...values };
          for (const key of ORDER) draft[key] = filled[key] ?? values[key];
          setValues(draft);
          errors.reset();
        }}
      />
      <FadeInView delay={entranceDelay(1)}>
        <FormField label={t('people.form.title')} required maxLength={80} {...bind('title')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <FormField label={t('people.form.company')} maxLength={120} {...bind('company')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <FormField label={t('people.form.specialty')} required hint={t('people.form.specialtyHint')} maxLength={160} {...bind('specialty')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(4)}>
        <FormField label={t('people.form.city')} required maxLength={80} {...bind('city')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(5)}>
        <FormField label={t('people.form.bio')} required hint={t('people.form.bioHint')} maxLength={1200} multiline {...bind('bio')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(6)}>
        <FormField label={t('people.form.milestones')} required multiline {...bind('milestones')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(7)}>
        <FormField label={t('people.form.achievements')} multiline {...bind('achievements')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(8)}>
        <FormField label={t('people.form.benefit')} multiline {...bind('benefit')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(9)}>
        <FormField label={t('people.form.seeking')} maxLength={600} multiline {...bind('seeking')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(10)}>
        <FormField label={t('people.form.phone')} maxLength={40} latin keyboardType="phone-pad" {...bind('phone')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(11)}>
        <FormField
          label={t('people.form.email')}
          maxLength={190}
          latin
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          {...bind('email')}
          warning={emailMeant ? t('form.fix.emailMeant') : null}
          fix={emailMeant ? { label: t('form.fix.use', { value: emailMeant }), onPress: () => set('email')(emailMeant) } : fixOf('email')}
        />
      </FadeInView>
      <FadeInView delay={entranceDelay(12)}>
        <FormField label={t('people.form.links')} hint={t('people.form.linksHint')} multiline latin autoCapitalize="none" autoCorrect={false} {...bind('links')} />
      </FadeInView>
      <FadeInView delay={entranceDelay(13)}>
        <Notice tone="info" text={t('people.photoNote')} />
      </FadeInView>
      {failure ? (
        <FadeInView offset={8}>
          <FormFailure failure={failure} onRetry={submit} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(14)}>
        <AppButton label={profile?.status === 'rejected' ? t('people.reapply') : t('people.submit')} icon="paper-plane-outline" loading={busy} onPress={submit} />
      </FadeInView>
      </PaperCard>
    </>
  );
}

import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';

import { useApplyProfile, useMyProfile, type MyProfile, type PersonLink } from '@/api/people';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PaperCard } from '@/components/paper';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';

const toLines = (list: string[]) => list.join('\n');
const fromLines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
const linksToText = (links: PersonLink[]) => links.map((link) => (link.label ? `${link.label} | ${link.url}` : link.url)).join('\n');
function linksFromText(text: string): PersonLink[] {
  return fromLines(text)
    .map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      return parts.length > 1 ? { label: parts[0] ?? '', url: parts.slice(1).join('|') } : { label: '', url: parts[0] ?? '' };
    })
    .filter((link) => link.url);
}

/** M11: the member's own «شخصية ومسيرة» application — apply, read the review state, edit again. */
export default function ApplyProfileScreen() {
  const router = useRouter();
  const { me, status } = useAuth();
  const signedIn = status === 'signedIn' && Boolean(me);
  const mine = useMyProfile(signedIn);

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
    <Screen title={t('people.title')} subtitle={mine.data?.intro ?? ''}>
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
        <ApplyForm key={profile?.id ?? 'new'} profile={profile} me={me} onOpenProfile={(id) => router.push(`/people/${id}` as Href)} />
      )}
    </Screen>
  );
}

function ApplyForm({ profile, me, onOpenProfile }: { profile: MyProfile | null; me: ReturnType<typeof useAuth>['me']; onOpenProfile: (id: string) => void }) {
  const apply = useApplyProfile();
  // The freshest submission prefills the form: the waiting draft when there is one, else the saved words.
  const fields = profile ? (profile.draft ?? profile.fields) : null;
  const [title, setTitle] = useState(fields?.title ?? '');
  const [company, setCompany] = useState(fields?.company ?? '');
  // M73: the spotlight sections (the contact fields start from the account; the member edits freely).
  const [specialty, setSpecialty] = useState(fields?.specialty ?? '');
  const [city, setCity] = useState(fields?.city ?? '');
  const [bio, setBio] = useState(fields?.bio ?? '');
  const [milestones, setMilestones] = useState(fields ? toLines(fields.milestones) : '');
  const [achievements, setAchievements] = useState(fields?.achievements ? toLines(fields.achievements) : '');
  const [benefit, setBenefit] = useState(fields?.benefit ? toLines(fields.benefit) : '');
  const [seeking, setSeeking] = useState(fields?.seeking ?? '');
  const [phone, setPhone] = useState(fields?.phone ?? me?.phone ?? '');
  const [email, setEmail] = useState(fields?.email ?? me?.email ?? '');
  const [links, setLinks] = useState(fields ? linksToText(fields.links) : '');
  const [sent, setSent] = useState(false);
  const busy = apply.isPending;

  const submit = () => {
    if (busy) return;
    setSent(false);
    apply.mutate(
      {
        title: title.trim(),
        company: company.trim(),
        specialty: specialty.trim(),
        city: city.trim(),
        bio: bio.trim(),
        milestones: fromLines(milestones),
        achievements: fromLines(achievements),
        benefit: fromLines(benefit),
        seeking: seeking.trim(),
        phone: phone.trim(),
        email: email.trim(),
        links: linksFromText(links),
      },
      { onSuccess: () => setSent(true) },
    );
  };

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
      <FadeInView delay={entranceDelay(1)}>
        <FormField label={t('people.form.title')} value={title} onChangeText={setTitle} maxLength={80} />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        <FormField label={t('people.form.company')} value={company} onChangeText={setCompany} maxLength={120} />
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <FormField label={t('people.form.specialty')} hint={t('people.form.specialtyHint')} value={specialty} onChangeText={setSpecialty} maxLength={160} />
      </FadeInView>
      <FadeInView delay={entranceDelay(4)}>
        <FormField label={t('people.form.city')} value={city} onChangeText={setCity} maxLength={80} />
      </FadeInView>
      <FadeInView delay={entranceDelay(5)}>
        <FormField label={t('people.form.bio')} hint={t('people.form.bioHint')} value={bio} onChangeText={setBio} maxLength={1200} multiline />
      </FadeInView>
      <FadeInView delay={entranceDelay(6)}>
        <FormField label={t('people.form.milestones')} value={milestones} onChangeText={setMilestones} multiline />
      </FadeInView>
      <FadeInView delay={entranceDelay(7)}>
        <FormField label={t('people.form.achievements')} value={achievements} onChangeText={setAchievements} multiline />
      </FadeInView>
      <FadeInView delay={entranceDelay(8)}>
        <FormField label={t('people.form.benefit')} value={benefit} onChangeText={setBenefit} multiline />
      </FadeInView>
      <FadeInView delay={entranceDelay(9)}>
        <FormField label={t('people.form.seeking')} value={seeking} onChangeText={setSeeking} maxLength={600} multiline />
      </FadeInView>
      <FadeInView delay={entranceDelay(10)}>
        <FormField label={t('people.form.phone')} value={phone} onChangeText={setPhone} maxLength={40} latin keyboardType="phone-pad" />
      </FadeInView>
      <FadeInView delay={entranceDelay(11)}>
        <FormField label={t('people.form.email')} value={email} onChangeText={setEmail} maxLength={190} latin keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      </FadeInView>
      <FadeInView delay={entranceDelay(12)}>
        <FormField label={t('people.form.links')} value={links} onChangeText={setLinks} multiline latin autoCapitalize="none" autoCorrect={false} />
      </FadeInView>
      <FadeInView delay={entranceDelay(13)}>
        <Notice tone="info" text={t('people.photoNote')} />
      </FadeInView>
      {apply.error ? (
        <FadeInView offset={8}>
          <Notice tone="warning" text={apply.error.message} />
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(14)}>
        <AppButton label={profile?.status === 'rejected' ? t('people.reapply') : t('people.submit')} icon="paper-plane-outline" loading={busy} onPress={submit} />
      </FadeInView>
      </PaperCard>
    </>
  );
}

import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';

import { useApplyProfile, useMyProfile, type MyProfile, type PersonLink } from '@/api/people';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
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
        <ApplyForm key={profile?.id ?? 'new'} profile={profile} onOpenProfile={(id) => router.push(`/people/${id}` as Href)} />
      )}
    </Screen>
  );
}

function ApplyForm({ profile, onOpenProfile }: { profile: MyProfile | null; onOpenProfile: (id: string) => void }) {
  const apply = useApplyProfile();
  // The freshest submission prefills the form: the waiting draft when there is one, else the saved words.
  const fields = profile ? (profile.draft ?? profile.fields) : null;
  const [title, setTitle] = useState(fields?.title ?? '');
  const [company, setCompany] = useState(fields?.company ?? '');
  const [bio, setBio] = useState(fields?.bio ?? '');
  const [milestones, setMilestones] = useState(fields ? toLines(fields.milestones) : '');
  const [links, setLinks] = useState(fields ? linksToText(fields.links) : '');
  const [sent, setSent] = useState(false);
  const busy = apply.isPending;

  const submit = () => {
    if (busy) return;
    setSent(false);
    apply.mutate(
      { title: title.trim(), company: company.trim(), bio: bio.trim(), milestones: fromLines(milestones), links: linksFromText(links) },
      { onSuccess: () => setSent(true) },
    );
  };

  return (
    <>
      {sent ? <Notice tone="success" text={t('people.applied')} /> : null}
      {profile?.status === 'pending' ? <Notice tone="info" text={t('people.pending')} /> : null}
      {profile?.status === 'approved' && profile.draft ? <Notice tone="info" text={t('people.pendingEdit')} /> : null}
      {profile?.status === 'approved' && !profile.draft && !sent ? <Notice tone="success" text={t('people.approved')} /> : null}
      {profile?.status === 'rejected' && profile.note ? <Notice tone="warning" text={`${t('people.rejectedTitle')}: ${profile.note}`} /> : null}
      {profile?.status === 'approved' ? (
        <AppButton label={t('people.view')} variant="outline" icon="person-circle-outline" onPress={() => onOpenProfile(profile.id)} />
      ) : null}

      <FormField label={t('people.form.title')} value={title} onChangeText={setTitle} maxLength={80} />
      <FormField label={t('people.form.company')} value={company} onChangeText={setCompany} maxLength={120} />
      <FormField label={t('people.form.bio')} hint={t('people.form.bioHint')} value={bio} onChangeText={setBio} maxLength={1200} multiline />
      <FormField label={t('people.form.milestones')} value={milestones} onChangeText={setMilestones} multiline />
      <FormField label={t('people.form.links')} value={links} onChangeText={setLinks} multiline latin autoCapitalize="none" autoCorrect={false} />
      <Notice tone="info" text={t('people.photoNote')} />
      {apply.error ? <Notice tone="warning" text={apply.error.message} /> : null}
      <AppButton label={busy ? '…' : profile?.status === 'rejected' ? t('people.reapply') : t('people.submit')} icon="paper-plane-outline" onPress={submit} />
    </>
  );
}

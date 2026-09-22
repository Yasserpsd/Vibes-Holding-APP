import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { adminMessagesApi, type MemberHit, type MessageAudience } from '@/api/posts';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type AudienceKey = 'all' | 'neutral' | 'entrepreneur' | 'investor' | 'member';

const AUDIENCES: { key: AudienceKey; label: StringKey }[] = [
  { key: 'all', label: 'compose.all' },
  // The club's three categories, in the owner's order.
  { key: 'neutral', label: 'compose.neutral' },
  { key: 'entrepreneur', label: 'compose.entrepreneurs' },
  { key: 'investor', label: 'compose.investors' },
  { key: 'member', label: 'compose.member' },
];

/**
 * M29: the admin composer inside the app — a message to everyone, to one category, or to one
 * member's inbox, with its push notification in the same act. Admin accounts only.
 */
export default function ComposeScreen() {
  const { me } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [audience, setAudience] = useState<AudienceKey>('all');
  const [member, setMember] = useState<MemberHit | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<MemberHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!me?.isAdmin) {
    return (
      <Screen title={t('compose.screenTitle')}>
        <Stack.Screen options={{ title: t('compose.screenTitle') }} />
        <Notice tone="warning" text={t('compose.adminOnly')} />
      </Screen>
    );
  }

  const findMembers = async () => {
    const q = search.trim();
    if (q.length < 2) {
      setError(t('compose.searchShort'));
      return;
    }
    setSearching(true);
    setError(null);
    try {
      setHits((await adminMessagesApi.searchMembers(q)).members);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSearching(false);
    }
  };

  const send = async () => {
    setError(null);
    setDone(null);
    if (!title.trim() || !body.trim()) {
      setError(t('compose.needText'));
      return;
    }
    if (audience === 'member' && !member) {
      setError(t('compose.needMember'));
      return;
    }
    const target: MessageAudience =
      audience === 'all' ? { type: 'all' } : audience === 'member' && member ? { type: 'member', contactId: member.id, name: member.name } : { type: 'persona', persona: audience as 'neutral' | 'entrepreneur' | 'investor' };
    setBusy(true);
    try {
      const result = await adminMessagesApi.send({ title: title.trim(), body: body.trim(), audience: target });
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
      setDone(result.push && result.push.sent > 0 ? `${t('compose.sent')} ${t('compose.sentPush', { sent: result.push.sent })}` : `${t('compose.sent')} ${t('compose.sentNoDevices')}`);
      setTitle('');
      setBody('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('compose.screenTitle')} subtitle={t('compose.subtitle')}>
      <Stack.Screen options={{ title: t('compose.screenTitle') }} />

      <Text style={styles.label}>{t('compose.audience')}</Text>
      <View style={styles.chips}>
        {AUDIENCES.map((entry) => (
          <Chip key={entry.key} label={t(entry.label)} selected={entry.key === audience} onPress={() => setAudience(entry.key)} />
        ))}
      </View>

      {audience === 'member' ? (
        member ? (
          <View style={styles.chosen}>
            <Text style={styles.chosenName}>{t('compose.chosen', { name: member.name || member.email })}</Text>
            <AppButton label={t('compose.change')} variant="outline" icon="swap-horizontal" onPress={() => setMember(null)} />
          </View>
        ) : (
          <View style={styles.search}>
            <FormField label={t('compose.searchLabel')} hint={t('compose.searchHint')} value={search} onChangeText={setSearch} onSubmitEditing={() => void findMembers()} returnKeyType="search" />
            <AppButton label={searching ? '…' : t('compose.search')} variant="outline" icon="search" onPress={() => (searching ? null : void findMembers())} />
            {hits ? (
              hits.length ? (
                hits.map((hit) => (
                  <Pressable
                    key={hit.id}
                    accessibilityRole="button"
                    onPress={() => {
                      setMember(hit);
                      setHits(null);
                      setSearch('');
                    }}
                    style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
                  >
                    <Text style={styles.hitName}>{hit.name || hit.email}</Text>
                    <Text style={styles.hitMeta}>{[hit.personaLabel, hit.email].filter(Boolean).join(' · ')}</Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.empty}>{t('compose.noResults')}</Text>
              )
            ) : null}
          </View>
        )
      ) : null}

      <FormField label={t('compose.titleField')} value={title} onChangeText={setTitle} maxLength={140} />
      <FormField label={t('compose.bodyField')} value={body} onChangeText={setBody} multiline maxLength={6000} />

      {error ? <Notice tone="warning" text={error} /> : null}
      {done ? <Notice tone="success" text={done} /> : null}
      <AppButton label={busy ? t('compose.sending') : t('compose.send')} icon="send" onPress={() => (busy ? null : void send())} />
      {done ? <AppButton label={t('compose.backToInbox')} variant="outline" icon="mail-open-outline" onPress={() => router.back()} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  search: { gap: spacing.sm },
  chosen: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface },
  chosenName: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  hit: { gap: 2, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  hitName: { ...typography.body, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: textStart },
  hitMeta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  empty: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  pressed: { opacity: 0.85 },
});

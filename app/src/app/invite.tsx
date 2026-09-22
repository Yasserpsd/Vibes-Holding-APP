import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { Share, StyleSheet, Text, View } from 'react-native';

import { useMyInvites, type Invitee, type InviteeState } from '@/api/invites';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';

// Left-to-right mark: keeps the Latin membership number readable inside Arabic lines (Android RTL).
const LRM = '‎';

const STATE_KEY: Record<InviteeState, StringKey> = {
  registered: 'invite.state.registered',
  verified: 'invite.state.verified',
  member: 'invite.state.member',
};
const STATE_ICON: Record<InviteeState, keyof typeof Ionicons.glyphMap> = {
  registered: 'time-outline',
  verified: 'checkmark-circle-outline',
  member: 'ribbon-outline',
};

/**
 * M32: «دعوة عضو جديد» — the member's invite code is his membership number; he shares the
 * server-written invitation text, and sees how far each nominee got. The gift itself is the
 * administration's, delivered by hand; the wording here comes from the dashboard.
 */
export default function InviteScreen() {
  const { me, status } = useAuth();
  const router = useRouter();
  const invites = useMyInvites(status === 'signedIn');

  if (status !== 'signedIn' || !me) {
    return (
      <Screen title={t('invite.title')}>
        <Stack.Screen options={{ title: t('nav.invite') }} />
        <Notice tone="warning" text={t('invite.guest')} />
        <AppButton label={t('invite.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  const data = invites.data;

  const share = async () => {
    if (!data) return;
    try {
      await Share.share({ message: data.shareText });
    } catch {
      // The member closed the share sheet or the system refused it; nothing to do.
    }
  };

  return (
    <Screen title={t('invite.title')} subtitle={t('invite.subtitle')}>
      <Stack.Screen options={{ title: t('nav.invite') }} />

      {!data ? (
        <StateView loading={invites.isLoading} error={invites.error} onRetry={() => void invites.refetch()} />
      ) : (
        <>
          <Text style={styles.gift}>{data.giftText}</Text>

          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>{t('invite.codeLabel')}</Text>
            <Text style={styles.code}>{`${LRM}${data.code}`}</Text>
            <Text style={styles.codeHint}>{t('invite.codeHint')}</Text>
          </View>

          {data.eligible ? (
            <AppButton label={t('invite.share')} icon="share-social-outline" onPress={() => void share()} />
          ) : (
            <>
              <Notice tone="warning" text={t('invite.locked')} />
              <AppButton label={t('invite.activate')} variant="outline" icon="ribbon-outline" onPress={() => router.push('/membership')} />
            </>
          )}

          <View style={styles.listHead}>
            <Text style={styles.listTitle}>{t('invite.invitedTitle')}</Text>
            <Text style={styles.listHint}>{t('invite.invitedHint')}</Text>
          </View>
          {data.invited.length === 0 ? (
            <Text style={styles.empty}>{t('invite.empty')}</Text>
          ) : (
            data.invited.map((person, index) => <InviteeRow key={`${person.at}-${index}`} person={person} />)
          )}
        </>
      )}
    </Screen>
  );
}

function InviteeRow({ person }: { person: Invitee }) {
  return (
    <View style={styles.row}>
      <Ionicons name={STATE_ICON[person.state]} size={20} color={person.state === 'registered' ? colors.textMuted : colors.gold} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.rowState}>{`${t(STATE_KEY[person.state])} · ${formatArabicDate(person.at)}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gift: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  codeBox: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  codeLabel: { ...typography.caption, color: colors.textSecondary },
  code: { ...typography.title, color: colors.gold, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  codeHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  listHead: { gap: 2, marginTop: spacing.md },
  listTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  listHint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  rowState: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});

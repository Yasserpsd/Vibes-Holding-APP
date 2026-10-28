import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { useMyInvites, type Invitee, type InviteeState } from '@/api/invites';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale, Sheen } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate } from '@/lib/format';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

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
  // V2: the code box is the hero — a light band sweeps it, so its size is measured once laid out.
  const [codeSize, setCodeSize] = useState<{ width: number; height: number } | null>(null);

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
          <FadeInView delay={entranceDelay(0)}>
            <Text style={styles.gift}>{data.giftText}</Text>
          </FadeInView>

          <FadeInView delay={entranceDelay(1)}>
            <PressScale glow glowRadius={radii.lg} accessibilityRole="none">
              <View
                style={styles.codeBox}
                onLayout={(event) => setCodeSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
              >
                <Text style={styles.codeLabel}>{t('invite.codeLabel')}</Text>
                <Text style={styles.code}>{`${LRM}${data.code}`}</Text>
                <Text style={styles.codeHint}>{t('invite.codeHint')}</Text>
                {codeSize ? <Sheen width={codeSize.width} height={codeSize.height} /> : null}
              </View>
            </PressScale>
          </FadeInView>

          <FadeInView delay={entranceDelay(2)}>
            {/* M143: every signed-in account shares its code — the membership lock is gone (owner, 2026-10-28). */}
            <AppButton label={t('invite.share')} icon="share-social-outline" onPress={() => void share()} />
          </FadeInView>

          <FadeInView delay={entranceDelay(3)}>
            <View style={styles.listHead}>
              <Text style={styles.listTitle}>{t('invite.invitedTitle')}</Text>
              <Text style={styles.listHint}>{t('invite.invitedHint')}</Text>
            </View>
          </FadeInView>
          {data.invited.length === 0 ? (
            <StateView empty emptyText={t('invite.empty')} />
          ) : (
            data.invited.map((person, index) => (
              <FadeInView key={`${person.at}-${index}`} delay={entranceDelay(index + 4)}>
                <InviteeRow person={person} />
              </FadeInView>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

function InviteeRow({ person }: { person: Invitee }) {
  return (
    <GlassCard radius={radii.md} style={styles.row}>
      <Ionicons name={STATE_ICON[person.state]} size={20} color={person.state === 'registered' ? colors.textMuted : colors.gold} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.rowState}>{`${t(STATE_KEY[person.state])} · ${formatArabicDate(person.at)}`}</Text>
      </View>
    </GlassCard>
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
    boxShadow: shadows.glowGold,
    overflow: 'hidden',
  },
  codeLabel: { ...typography.caption, color: colors.textSecondary },
  code: { ...typography.title, color: colors.gold, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  codeHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  listHead: { gap: 2, marginTop: spacing.md },
  listTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  listHint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  rowState: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});

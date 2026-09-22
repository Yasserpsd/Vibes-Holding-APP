import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, errorMessage } from '@/api/client';
import { projectAccessKey, projectsApi, useProjectAccess } from '@/api/queries';
import type { ProjectAccess, ProjectContact, ProjectsBalance } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { hubText, t } from '@/i18n';
import { arrowForward, chevronForward, textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { openLink } from '@/lib/openLink';
import { openWhatsApp } from '@/lib/whatsapp';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = { projectId: string; projectTitle: string; hasPitchDeck: boolean };

/**
 * Unlocking a project: رصيد بنك المشاريع left, a confirm sheet, then the founder's contact data and pitch deck exactly
 * as the server answers them for this member (CLAUDE.md rule 4). Nothing is written to the device: the data lives
 * in the session's query cache only, keyed by account, dropped when the page closes and on sign-out.
 */
export function ProjectUnlock({ projectId, projectTitle, hasPitchDeck }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, me } = useAuth();
  const account = status === 'signedIn' ? `${me?.id ?? 'me'}:${me?.membership.status ?? ''}` : null;
  const query = useProjectAccess(projectId, account);
  const [confirming, setConfirming] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') return null;
  if (status === 'guest') {
    return (
      <Frame icon="lock-closed-outline" text={t('unlock.guest')}>
        <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Frame>
    );
  }
  if (query.isPending) {
    return (
      <Frame icon="lock-closed-outline" text={t('unlock.checking')}>
        <ActivityIndicator color={colors.gold} />
      </Frame>
    );
  }
  const access = query.data;
  if (!access) {
    // A server that does not know the route yet (deployed after this update): stay quiet, the page works without it.
    if (query.error instanceof ApiError && query.error.status === 404) return <Frame icon="time-outline" text={t('unlock.notAvailable')} quiet />;
    return (
      <Frame icon="cloud-offline-outline" text={query.error ? errorMessage(query.error) : t('unlock.checkFailed')}>
        <AppButton label={t('common.retry')} variant="outline" icon="refresh-outline" onPress={() => void query.refetch()} />
      </Frame>
    );
  }

  const unlock = async () => {
    if (unlocking) return;
    setUnlocking(true);
    setError(null);
    try {
      const result = await projectsApi.unlock(projectId);
      // The answer goes where the access answer lives, so both leave the memory together.
      queryClient.setQueryData<ProjectAccess>(projectAccessKey(projectId, account ?? ''), (previous) => ({
        state: 'unlocked',
        isMember: true,
        balance: previous?.balance ? { ...previous.balance, left: result.left, used: previous.balance.used + (result.already ? 0 : 1) } : null,
        contact: result.contact,
        message: null,
      }));
      setConfirming(false);
    } catch (cause) {
      setConfirming(false);
      setError(errorMessage(cause));
      // The balance ran out, the membership lapsed or the project became golden meanwhile: read the state again.
      if (cause instanceof ApiError && [402, 403, 409].includes(cause.status)) void query.refetch();
    } finally {
      setUnlocking(false);
    }
  };

  switch (access.state) {
    // Golden projects cost nothing: their partner page button is already on the project page.
    case 'golden':
      return null;
    case 'not_member':
      return (
        <Frame icon="ribbon-outline" text={hubText(access.message, 'unlock.membersOnly')}>
          <AppButton label={t('account.benefits')} icon="ribbon-outline" onPress={() => router.push('/membership')} />
        </Frame>
      );
    case 'unavailable':
      return <Frame icon="time-outline" text={hubText(access.message, 'unlock.later')} quiet />;
    case 'exhausted':
      return (
        <Frame icon="wallet-outline" text={t('unlock.used')}>
          {access.balance ? <BalanceRow balance={access.balance} /> : null}
        </Frame>
      );
    case 'unlocked':
      return (
        <View style={styles.box}>
          <View style={styles.row}>
            <Ionicons name="lock-open-outline" size={20} color={colors.success} />
            <Text style={styles.title}>{t('unlock.contactTitle')}</Text>
          </View>
          {access.contact ? <ContactList contact={access.contact} projectTitle={projectTitle} /> : null}
          {access.balance ? <BalanceRow balance={access.balance} /> : null}
          <Text style={styles.hint}>{t('unlock.private')}</Text>
        </View>
      );
    case 'can_unlock':
      return (
        <Frame
          icon="lock-closed-outline"
          text={hasPitchDeck ? t('unlock.promptWithDeck') : t('unlock.prompt')}
        >
          {access.balance ? <BalanceRow balance={access.balance} /> : null}
          <AppButton label={t('unlock.open')} icon="lock-open-outline" onPress={() => setConfirming(true)} />
          {error ? <Notice tone="warning" text={error} /> : null}
          <ConfirmSheet
            visible={confirming}
            busy={unlocking}
            projectTitle={projectTitle}
            balance={access.balance}
            onConfirm={() => void unlock()}
            onClose={() => (unlocking ? undefined : setConfirming(false))}
          />
        </Frame>
      );
    default:
      return null;
  }
}

function Frame({ icon, text, quiet = false, children }: { icon: IoniconName; text: string; quiet?: boolean; children?: ReactNode }) {
  return (
    <View style={[styles.box, quiet && styles.boxQuiet]}>
      <View style={styles.row}>
        <Ionicons name={icon} size={20} color={quiet ? colors.textMuted : colors.goldLight} />
        <Text style={[styles.text, quiet && styles.textQuiet]}>{text}</Text>
      </View>
      {children}
    </View>
  );
}

function BalanceRow({ balance }: { balance: ProjectsBalance }) {
  const total = balance.credits + balance.granted;
  return (
    <View style={styles.balance}>
      <Ionicons name="wallet-outline" size={18} color={colors.gold} />
      <Text style={styles.balanceLabel}>{t('unlock.balance')}</Text>
      <Text style={styles.balanceValue}>{t('unlock.balanceLeft', { left: formatNumber(balance.left), total: formatNumber(total) })}</Text>
    </View>
  );
}

function ContactList({ contact, projectTitle }: { contact: ProjectContact; projectTitle: string }) {
  const empty = !contact.whatsapp && !contact.email && !contact.website && !contact.pitchUrl;
  if (empty) return <Text style={styles.hint}>{t('unlock.empty')}</Text>;
  const greeting = t('unlock.greeting', { title: projectTitle });
  return (
    <View style={styles.contacts}>
      {contact.whatsapp ? <ContactRow icon="logo-whatsapp" label={t('unlock.whatsapp')} value={contact.whatsapp} latin onPress={() => void openWhatsApp(contact.whatsapp, greeting)} /> : null}
      {contact.email ? <ContactRow icon="mail-outline" label={t('unlock.email')} value={contact.email} latin onPress={() => void Linking.openURL(`mailto:${contact.email}`).catch(() => undefined)} /> : null}
      {contact.website ? <ContactRow icon="globe-outline" label={t('unlock.website')} value={contact.website} latin onPress={() => void openLink(contact.website)} /> : null}
      {contact.pitchUrl ? <ContactRow icon="document-text-outline" label={t('unlock.pitch')} value={t('unlock.openPitch')} onPress={() => void openLink(contact.pitchUrl)} /> : null}
    </View>
  );
}

function ContactRow({ icon, label, value, latin = false, onPress }: { icon: IoniconName; label: string; value: string; latin?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.contact, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.gold} />
      <View style={styles.contactTexts}>
        <Text style={styles.contactLabel}>{label}</Text>
        {/* The left-to-right mark keeps a leading «+» in front of the number: Android ignores writingDirection. */}
        <Text style={[styles.contactValue, latin && styles.latin]} numberOfLines={1}>
          {latin ? `‎${value}` : value}
        </Text>
      </View>
      <Ionicons name={chevronForward()} size={16} color={colors.goldDark} />
    </Pressable>
  );
}

type SheetProps = { visible: boolean; busy: boolean; projectTitle: string; balance: ProjectsBalance | null; onConfirm: () => void; onClose: () => void };

/** The member sees what the unlock takes from his رصيد before it happens. */
function ConfirmSheet({ visible, busy, projectTitle, balance, onConfirm, onClose }: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('unlock.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>{t('unlock.confirmTitle')}</Text>
        <Text style={styles.sheetText}>{t('unlock.confirmText', { title: projectTitle })}</Text>
        {balance ? (
          <View style={styles.sheetFigures}>
            <Figure label={t('unlock.now')} value={formatNumber(balance.left)} />
            <Ionicons name={arrowForward()} size={18} color={colors.textMuted} />
            <Figure label={t('unlock.after')} value={formatNumber(Math.max(0, balance.left - 1))} highlight />
          </View>
        ) : null}
        {busy ? <ActivityIndicator color={colors.gold} /> : <AppButton label={t('unlock.confirm')} icon="lock-open-outline" onPress={onConfirm} />}
        <AppButton label={t('common.cancel')} variant="outline" onPress={onClose} />
      </View>
    </Modal>
  );
}

function Figure({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, highlight && styles.figureValueHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface },
  boxQuiet: { borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...typography.subtitle, flex: 1, color: colors.textPrimary, textAlign: textStart },
  text: { ...typography.caption, fontSize: 14, lineHeight: 22, flex: 1, color: colors.textSecondary, textAlign: textStart },
  textQuiet: { color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  balance: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  balanceLabel: { ...typography.caption, flex: 1, color: colors.textSecondary, textAlign: textStart },
  balanceValue: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 24, color: colors.gold },
  contacts: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  contact: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceElevated, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  contactTexts: { flex: 1 },
  contactLabel: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  contactValue: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  // Phone numbers, e-mails and links read left to right, still aligned with the Arabic labels.
  latin: { writingDirection: 'ltr' },
  pressed: { opacity: 0.8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  sheet: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, borderTopWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.xs },
  sheetTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  sheetText: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  sheetFigures: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  figure: { alignItems: 'center', gap: 2 },
  figureLabel: { ...typography.caption, color: colors.textMuted },
  figureValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.textPrimary },
  figureValueHighlight: { color: colors.gold },
});

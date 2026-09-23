import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authApi, useAuthConfig, useMembershipContent, type Me } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { hasSecureStorage } from '@/auth/storage';
import { AppButton } from '@/components/AppButton';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { Notice } from '@/components/Notice';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { Screen } from '@/components/Screen';
import { env } from '@/config/env';
import { languageChoiceOffered, t, tOptional } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { chevronForward, textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export default function AccountScreen() {
  const router = useRouter();
  const { status, me, signOut, refresh } = useAuth();
  const { data: config } = useAuthConfig();
  const { data: content } = useMembershipContent();
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.gold} size="large" />
      </SafeAreaView>
    );
  }

  if (status === 'guest') {
    return (
      <PlaceholderScreen
        title={t('account.title')}
        description={t('account.guestDescription')}
      >
        <View style={styles.actions}>
          <AppButton label={t('account.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
          {config?.registrationOpen === false ? null : (
            <AppButton label={t('account.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
          )}
          <AppButton label={t('account.benefits')} variant="outline" icon="ribbon-outline" onPress={() => router.push('/membership')} />
          <AppButton label={t('account.about')} variant="outline" icon="information-circle-outline" onPress={() => router.push('/about')} />
          {languageChoiceOffered(false) ? <AppButton label={t('account.menu.language')} variant="outline" icon="language-outline" onPress={chooseLanguage} /> : null}
        </View>
      </PlaceholderScreen>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const confirmDelete = async (password: string) => {
    if (!password) {
      setDeleteError(t('account.delete.passwordRequired'));
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await authApi.deleteMe(password);
      setDeleting(false);
      await signOut();
    } catch (cause) {
      setDeleteError(errorMessage(cause));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Screen aboveTabBar refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} />}>
      {me ? <ProfileHeader me={me} /> : <Notice tone="warning" text={t('account.loadFailed')} />}
      <MembershipStatusCard membership={me?.membership ?? null} texts={content?.statusTexts} activationNote={content?.activationNote} title={content?.title} />
      {!hasSecureStorage() ? <Notice tone="warning" text={t('account.noSecureStorage')} /> : null}

      <View style={styles.menu}>
        <MenuRow icon="ribbon-outline" label={t('account.menu.membership')} onPress={() => router.push('/membership')} />
        <MenuRow icon="chatbubbles-outline" label={t('account.menu.contact')} onPress={() => router.push('/contact' as Href)} />
        <MenuRow icon="card-outline" label={t('nav.card')} onPress={() => router.push('/card' as Href)} />
        <MenuRow icon="gift-outline" label={t('account.menu.invite')} onPress={() => router.push('/invite' as Href)} />
        <MenuRow icon="sparkles-outline" label={t('people.title')} onPress={() => router.push('/people/apply' as Href)} />
        <MenuRow icon="create-outline" label={t('account.menu.profile')} onPress={() => router.push('/profile-edit')} />
        <MenuRow icon="business-outline" label={t('account.menu.hq')} onPress={() => router.push('/hq')} />
        <MenuRow icon="receipt-outline" label={t('account.menu.payments')} onPress={() => router.push('/payments')} />
        <MenuRow icon="grid-outline" label={t('account.menu.services')} onPress={() => router.push('/services')} />
        <MenuRow icon="play-circle-outline" label={t('account.menu.videos')} onPress={() => router.push('/videos')} />
        <MenuRow icon="information-circle-outline" label={t('account.menu.about')} onPress={() => router.push('/about')} />
        {languageChoiceOffered(me?.isAdmin === true) ? <MenuRow icon="language-outline" label={t('account.menu.language')} onPress={chooseLanguage} /> : null}
        {me?.isAdmin ? <MenuRow icon="shield-checkmark-outline" label={t('account.menu.hqAdmin')} onPress={() => router.push('/hq/admin')} /> : null}
        <MenuRow icon="log-out-outline" label={t('account.menu.signOut')} onPress={() => void signOut()} />
        <MenuRow icon="trash-outline" label={t('account.menu.delete')} danger onPress={() => setDeleting(true)} />
      </View>

      <PasswordPrompt
        visible={deleting}
        title={t('account.delete.title')}
        message={t('account.delete.message')}
        confirmLabel={t('account.delete.confirm')}
        busy={deleteBusy}
        error={deleteError}
        onConfirm={(password) => void confirmDelete(password)}
        onCancel={() => {
          setDeleting(false);
          setDeleteError(null);
        }}
      />

      <Text style={styles.footer}>{t(env.isProduction ? 'account.version' : 'account.versionPreview', { version: env.appVersion })}</Text>
    </Screen>
  );
}

function ProfileHeader({ me }: { me: Me }) {
  const initial = me.name.trim().charAt(0) || '؟';
  return (
    <View style={styles.header}>
      {me.avatarUrl ? (
        <Image source={{ uri: me.avatarUrl }} style={styles.avatar} accessibilityLabel={me.name} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}
      <View style={styles.headerText}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{me.name}</Text>
          {me.isAdmin ? (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>{t('account.adminBadge')}</Text>
            </View>
          ) : null}
        </View>
        {me.personaLabel ? <Text style={styles.meta}>{tOptional(`persona.${me.persona}`) ?? me.personaLabel}</Text> : null}
        {me.jobTitle ? <Text style={styles.meta}>{me.jobTitle}</Text> : null}
        <Text style={styles.contact}>{me.email}</Text>
        <Text style={styles.contact}>{me.phone}</Text>
      </View>
    </View>
  );
}

type MenuRowProps = { icon: IoniconName; label: string; onPress: () => void; danger?: boolean };

function MenuRow({ icon, label, onPress, danger = false }: MenuRowProps) {
  const color = danger ? colors.danger : colors.gold;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      <Ionicons name={chevronForward()} size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.goldDark },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
  avatarInitial: { ...typography.title, color: colors.gold },
  headerText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  adminBadge: { paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.gold },
  adminBadgeText: { ...typography.caption, color: colors.goldLight, fontSize: 11 },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  contact: { ...typography.caption, color: colors.textMuted, textAlign: textStart, writingDirection: 'ltr' },
  menu: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  rowLabel: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  footer: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

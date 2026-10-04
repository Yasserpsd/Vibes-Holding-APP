import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authApi, useAuthConfig, useMembershipContent, type Me } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { hasSecureStorage } from '@/auth/storage';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldGradient, GoldHairline } from '@/components/lux';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { entranceDelay, FadeInView, PopIn, PressScale, SkeletonCards } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { Screen } from '@/components/Screen';
import { env } from '@/config/env';
import { languageChoiceOffered, t, tOptional } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { chevronForward, textStart } from '@/i18n/direction';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

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
      <SafeAreaView style={styles.loading}>
        <SkeletonCards count={4} />
      </SafeAreaView>
    );
  }

  if (status === 'guest') {
    return (
      <PlaceholderScreen
        title={t('account.title')}
        description={t('account.guestDescription')}
      >
        <FadeInView delay={120} style={styles.actions}>
          <AppButton label={t('account.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
          {config?.registrationOpen === false ? null : (
            <AppButton label={t('account.register')} variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
          )}
          <AppButton label={t('account.benefits')} variant="outline" icon="ribbon-outline" onPress={() => router.push('/membership')} />
          <AppButton label={t('account.about')} variant="outline" icon="information-circle-outline" onPress={() => router.push('/about')} />
          {languageChoiceOffered(false) ? <AppButton label={t('account.menu.language')} variant="outline" icon="language-outline" onPress={chooseLanguage} /> : null}
        </FadeInView>
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
    <Screen aboveTabBar watermark refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}>
      {me ? (
        <FadeInView offset={12}>
          <ProfileHeader me={me} />
        </FadeInView>
      ) : (
        <Notice tone="warning" text={t('account.loadFailed')} />
      )}
      <FadeInView delay={entranceDelay(1, 90)}>
        <MembershipStatusCard membership={me?.membership ?? null} texts={content?.statusTexts} activationNote={content?.activationNote} title={content?.title} />
      </FadeInView>
      {!hasSecureStorage() ? <Notice tone="warning" text={t('account.noSecureStorage')} /> : null}

      <FadeInView delay={entranceDelay(2, 90)}>
        <GlassCard radius={radii.lg}>
          {/* Membership rows */}
          <MenuRow icon="ribbon-outline" label={t('account.menu.membership')} onPress={() => router.push('/membership')} />
          <MenuRow icon="chatbubbles-outline" label={t('account.menu.contact')} onPress={() => router.push('/contact' as Href)} />
          <MenuRow icon="card-outline" label={t('nav.card')} onPress={() => router.push('/card' as Href)} />
          <MenuRow icon="gift-outline" label={t('account.menu.invite')} onPress={() => router.push('/invite' as Href)} />
          <GoldHairline style={styles.groupHairline} />
          {/* Club tools */}
          <MenuRow icon="calendar-outline" label={t('agenda.title')} onPress={() => router.push('/agenda' as Href)} />
          <MenuRow icon="sparkles-outline" label={t('people.title')} onPress={() => router.push('/people/apply' as Href)} />
          <MenuRow icon="create-outline" label={t('account.menu.profile')} onPress={() => router.push('/profile-edit')} />
          <MenuRow icon="business-outline" label={t('account.menu.hq')} onPress={() => router.push('/hq')} />
          <MenuRow icon="receipt-outline" label={t('account.menu.payments')} onPress={() => router.push('/payments')} />
          <MenuRow icon="grid-outline" label={t('account.menu.services')} onPress={() => router.push('/services')} />
          <MenuRow icon="play-circle-outline" label={t('account.menu.videos')} onPress={() => router.push('/videos')} />
          <GoldHairline style={styles.groupHairline} />
          {/* The app */}
          <MenuRow icon="information-circle-outline" label={t('account.menu.about')} onPress={() => router.push('/about')} />
          {languageChoiceOffered(me?.isAdmin === true) ? <MenuRow icon="language-outline" label={t('account.menu.language')} onPress={chooseLanguage} /> : null}
          {me?.isAdmin ? <MenuRow icon="shield-checkmark-outline" label={t('account.menu.hqAdmin')} onPress={() => router.push('/hq/admin')} /> : null}
          <MenuRow icon="log-out-outline" label={t('account.menu.signOut')} onPress={() => void signOut()} />
        </GlassCard>
      </FadeInView>

      <FadeInView delay={entranceDelay(3, 90)}>
        <GlassCard radius={radii.lg}>
          <MenuRow icon="trash-outline" label={t('account.menu.delete')} danger onPress={() => setDeleting(true)} />
        </GlassCard>
      </FadeInView>

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
      <GoldGradient style={styles.avatarRing}>
        {me.avatarUrl ? (
          <Image source={{ uri: me.avatarUrl }} style={styles.avatar} accessibilityLabel={me.name} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}
      </GoldGradient>
      <View style={styles.headerText}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{me.name}</Text>
          {me.isAdmin ? (
            <PopIn delay={260}>
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>{t('account.adminBadge')}</Text>
              </View>
            </PopIn>
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
    <PressScale onPress={onPress} style={styles.row}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
      <Ionicons name={chevronForward()} size={18} color={colors.textMuted} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.black, padding: spacing.lg, justifyContent: 'center' },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarRing: {
    width: 78,
    height: 78,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGoldFaint,
  },
  avatar: { width: 70, height: 70, borderRadius: radii.pill },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
  avatarInitial: { ...typography.title, color: colors.gold },
  headerText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  adminBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  adminBadgeText: { ...typography.caption, color: colors.goldLight, fontSize: 11 },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  contact: { ...typography.caption, color: colors.textMuted, textAlign: textStart, writingDirection: 'ltr' },
  groupHairline: { marginHorizontal: spacing.md, marginVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
  },
  rowLabel: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  rowLabelDanger: { color: colors.danger },
  footer: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

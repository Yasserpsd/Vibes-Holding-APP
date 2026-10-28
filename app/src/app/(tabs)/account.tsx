import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { displayProfile, useAuthConfig, useMembershipContent, type Me } from '@/api/auth';
import { useStoreConfig } from '@/api/membership';
import { companionApi } from '@/api/push';
import { useAuth } from '@/auth/AuthProvider';
import { hasSecureStorage } from '@/auth/storage';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldGradient } from '@/components/lux';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { entranceDelay, FadeInView, PopIn, PressScale, SkeletonCards } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { CompleteProfilePopup, CompletionMeter, profileCompletion } from '@/components/ProfileCompleteness';
import { DeletionBanner } from '@/components/DeletionBanner';
import { Screen } from '@/components/Screen';
import { WalletCard } from '@/components/WalletCard';
import { env } from '@/config/env';
import { getLang, languageChoiceOffered, t, tOptional } from '@/i18n';
import { chooseLanguage } from '@/i18n/chooseLanguage';
import { chevronForward, textStart } from '@/i18n/direction';
import { markSeen } from '@/lib/seen';

import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export default function AccountScreen() {
  const router = useRouter();
  const { status, me, signOut, refresh } = useAuth();
  const { data: config } = useAuthConfig();
  const { data: content } = useMembershipContent();
  // M109c: the legal rows of «المزيد» open the server's own pages (or the owner's override URLs).
  const { data: store } = useStoreConfig();
  const [refreshing, setRefreshing] = useState(false);
  // M75: opening حسابي clears its +N badge.
  useFocusEffect(
    useCallback(() => {
      markSeen('account');
    }, []),
  );

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

  return (
    <Screen aboveTabBar watermark refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}>
      {me ? (
        <FadeInView offset={12}>
          {/* M103: the gentle «كمّل بياناتك» popup — at most once a week while the profile is incomplete. */}
          <CompleteProfilePopup me={me} />
          <ProfileHeader me={me} />
        </FadeInView>
      ) : (
        <Notice tone="warning" text={t('account.loadFailed')} />
      )}
      {/* M117: the 30-day deletion countdown with its «تراجع» door — only while a deletion is scheduled. */}
      {me ? <DeletionBanner account={String(me.id)} /> : null}
      <FadeInView delay={entranceDelay(1, 90)}>
        <MembershipStatusCard membership={me?.membership ?? null} texts={content?.statusTexts} activationNote={content?.activationNote} title={content?.title} subscribeCta />
      </FadeInView>
      {!hasSecureStorage() ? <Notice tone="warning" text={t('account.noSecureStorage')} /> : null}

      {/* M79 (owner): «الحاجات اللي ليها علاقة ببعض لازم تتحط مع بعض» — the pile became titled groups. */}
      <FadeInView delay={entranceDelay(2, 90)}>
        <MenuGroup title={t('account.group.data')} icon="person-circle-outline">
          <MenuRow icon="create-outline" label={t('account.menu.profile')} onPress={() => router.push('/profile-edit')} />
          <MenuRow icon="heart-outline" label={t('nav.interests')} onPress={() => router.push('/news/interests' as Href)} />
          {/* M101: the member changes his direction with an e-mailed code, once every 30 days. */}
          <MenuRow icon="compass-outline" label={t('persona.title')} onPress={() => router.push('/persona' as Href)} />
          <MenuRow icon="card-outline" label={t('nav.card')} onPress={() => router.push('/card' as Href)} />
          <MenuRow icon="sparkles-outline" label={t('people.title')} onPress={() => router.push('/people/apply' as Href)} />
        </MenuGroup>
      </FadeInView>

      <FadeInView delay={entranceDelay(3, 90)}>
        <MenuGroup title={t('account.group.membership')} icon="ribbon-outline">
          <MenuRow icon="ribbon-outline" label={t('account.menu.membership')} onPress={() => router.push('/membership')} />
          <MenuRow icon="receipt-outline" label={t('account.menu.payments')} onPress={() => router.push('/payments')} />
          <MenuRow icon="gift-outline" label={t('account.menu.invite')} onPress={() => router.push('/invite' as Href)} />
        </MenuGroup>
      </FadeInView>

      <FadeInView delay={entranceDelay(4, 90)}>
        {/* M144 (owner): the Projects Bank balance sits with the club group too. */}
        <WalletCard />
        <MenuGroup title={t('account.group.club')} icon="business-outline">
          <MenuRow icon="grid-outline" label={t('account.menu.services')} onPress={() => router.push('/services')} />
          {/* M99b: the Projects Bank stays reachable from here for the persona whose tabs hide it. */}
          <MenuRow icon="briefcase-outline" label={t('tabs.projects')} onPress={() => router.push('/projects')} />
          <MenuRow icon="calendar-outline" label={t('agenda.title')} onPress={() => router.push('/agenda' as Href)} />
          <MenuRow icon="business-outline" label={t('account.menu.hq')} onPress={() => router.push('/hq')} />
          <MenuRow icon="chatbubbles-outline" label={t('account.menu.contact')} onPress={() => router.push('/contact' as Href)} />
          <MenuRow icon="play-circle-outline" label={t('account.menu.videos')} onPress={() => router.push('/videos')} />
        </MenuGroup>
      </FadeInView>

      <FadeInView delay={entranceDelay(5, 90)}>
        <MenuGroup title={t('account.group.security')} icon="shield-checkmark-outline">
          <MenuRow icon="shield-checkmark-outline" label={t('security.title')} onPress={() => router.push('/security' as Href)} />
        </MenuGroup>
      </FadeInView>

      <FadeInView delay={entranceDelay(6, 90)}>
        <MenuGroup title={t('account.group.preferences')} icon="options-outline">
          {/* M87b: the daily advisor message, on or off — server-side, follows the account. */}
          <CompanionToggleRow />
          {languageChoiceOffered(me?.isAdmin === true) ? <MenuRow icon="language-outline" label={t('account.menu.language')} onPress={chooseLanguage} /> : null}
          {me?.isAdmin ? <MenuRow icon="key-outline" label={t('account.menu.hqAdmin')} onPress={() => router.push('/hq/admin')} /> : null}
          <MenuRow icon="log-out-outline" label={t('account.menu.signOut')} onPress={() => void signOut()} />
        </MenuGroup>
      </FadeInView>

      {/* M109c «المزيد»: the low-traffic legal and account rows, gathered in one quiet group. */}
      <FadeInView delay={entranceDelay(7, 90)}>
        <MenuGroup title={t('account.group.more')} icon="ellipsis-horizontal-outline">
          <MenuRow icon="information-circle-outline" label={t('account.menu.about')} onPress={() => router.push('/about')} />
          {/* M116d (owner): legal pages render INSIDE the app — no browser bar, no hosting domain on show. */}
          {store?.termsUrl ? <MenuRow icon="document-text-outline" label={t('store.terms')} onPress={() => router.push({ pathname: '/webpage', params: { url: store.termsUrl ?? '', title: t('store.terms') } })} /> : null}
          {store?.privacyUrl ? <MenuRow icon="shield-outline" label={t('store.privacy')} onPress={() => router.push({ pathname: '/webpage', params: { url: store.privacyUrl ?? '', title: t('store.privacy') } })} /> : null}
          {/* M118d (owner): deletion left «المزيد» — it lives deep inside الأمان ← إعدادات أمان إضافية. */}
        </MenuGroup>
      </FadeInView>

      <Text style={styles.footer}>{t(env.isProduction ? 'account.version' : 'account.versionPreview', { version: env.appVersion })}</Text>
    </Screen>
  );
}

function ProfileHeader({ me }: { me: Me }) {
  // M109e: the English app shows the member's own data in English (display only).
  const shown = displayProfile(me);
  const initial = shown.name.trim().charAt(0) || (getLang() === 'en' ? '?' : '؟');
  // M103: the completion meter around the avatar — golden dots fill as the profile does.
  const percent = profileCompletion(me);
  return (
    <View style={styles.header}>
      <CompletionMeter percent={percent} size={78}>
        <GoldGradient style={styles.avatarRing}>
          {me.avatarUrl ? (
            <Image source={{ uri: me.avatarUrl }} style={styles.avatar} accessibilityLabel={me.name} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
        </GoldGradient>
      </CompletionMeter>
      <View style={styles.headerText}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{shown.name}</Text>
          {me.isAdmin ? (
            <PopIn delay={260}>
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>{t('account.adminBadge')}</Text>
              </View>
            </PopIn>
          ) : null}
        </View>
        {me.personaLabel ? <Text style={styles.meta}>{tOptional(`persona.${me.persona}`) ?? me.personaLabel}</Text> : null}
        {shown.jobTitle ? <Text style={styles.meta}>{shown.jobTitle}</Text> : null}
        <Text style={styles.contact}>{me.email}</Text>
        <Text style={styles.contact}>{me.phone}</Text>
      </View>
    </View>
  );
}

/** M87b: «رسالة المستشار اليومية» — the switch flips the server-side mute (the wave then skips this member). */
function CompanionToggleRow() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['companion', 'me'], queryFn: companionApi.me, staleTime: 5 * 60_000 });
  const toggle = useMutation({
    mutationFn: (muted: boolean) => companionApi.setMuted(muted),
    onSuccess: (answer) => queryClient.setQueryData(['companion', 'me'], answer),
  });
  const muted = toggle.isPending ? !(query.data?.muted ?? false) : (query.data?.muted ?? false);
  return (
    <View style={styles.row}>
      <PopIn delay={80}>
        <Ionicons name="sparkles-outline" size={22} color={colors.gold} />
      </PopIn>
      <Text style={styles.rowLabel}>{t('account.companion')}</Text>
      <Switch
        value={!muted}
        disabled={query.isLoading || toggle.isPending}
        onValueChange={(on) => toggle.mutate(!on)}
        trackColor={{ false: colors.surfaceElevated, true: colors.goldDark }}
        thumbColor={muted ? colors.textMuted : colors.gold}
        accessibilityLabel={t('account.companion')}
      />
    </View>
  );
}

/** Icons pass: the member's Projects Bank wallet, at a glance — hidden entirely while both are zero. */
/** M79: one titled group of related rows — the eyebrow title sits above its card (icons pass: with its small gold icon). */
function MenuGroup({ title, icon, children }: { title: string; icon?: IoniconName; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        {icon ? <Ionicons name={icon} size={14} color={colors.gold} /> : null}
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
      <GlassCard radius={radii.lg}>{children}</GlassCard>
    </View>
  );
}

type MenuRowProps = { icon: IoniconName; label: string; onPress: () => void; danger?: boolean };

function MenuRow({ icon, label, onPress, danger = false }: MenuRowProps) {
  const color = danger ? colors.danger : colors.gold;
  return (
    <PressScale onPress={onPress} style={styles.row}>
      {/* M84e: every menu icon pops into place — the reorganized groups read icon-first. */}
      <PopIn delay={80}>
        <Ionicons name={icon} size={22} color={color} />
      </PopIn>
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
  // M79: the titled groups.
  group: { gap: spacing.xs },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  groupTitle: { ...typography.caption, color: colors.gold, textAlign: textStart, flex: 1 },
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

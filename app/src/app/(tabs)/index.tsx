import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMembershipContent } from '@/api/auth';
import { useHomeContent, useServices, type HomeContent, type HomePortal } from '@/api/content';
import { useGolden } from '@/api/queries';
import type { GoldenCompany, GoldenContent } from '@/api/types';
import { useLatestPosts } from '@/api/posts';
import { useVideos } from '@/api/videos';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { PortalCard } from '@/components/PortalCard';
import { HOME_POSTS_LIMIT, PostsBlock } from '@/components/PostsBlock';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ServiceCard } from '@/components/ServiceCard';
import { StateView } from '@/components/StateView';
import { VideoCard } from '@/components/VideoCard';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatMillionsSar } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const clubLogo = require('../../../assets/images/club-logo.png');

export default function HomeScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const home = useHomeContent();
  const golden = useGolden();
  const services = useServices();
  const videos = useVideos();
  // Same query as <PostsBlock />: one cache entry, refetched with the rest on pull-to-refresh.
  const latestPosts = useLatestPosts(HOME_POSTS_LIMIT);
  const membershipContent = useMembershipContent();
  const [refreshing, setRefreshing] = useState(false);
  // Tab screens keep the floating «اسأل المستشار» button above the tab bar.
  useAdvisorScreen({ type: 'screen', id: 'home', title: t('tabs.home') }, true);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([home.refetch(), golden.refetch(), services.refetch(), videos.refetch(), latestPosts.refetch()]);
    setRefreshing(false);
  };

  const content = home.data;
  if (!content) {
    return (
      <Screen aboveTabBar>
        <StateView loading={home.isLoading} error={home.error} onRetry={() => void home.refetch()} />
      </Screen>
    );
  }

  const openPortal = (portal: HomePortal, nonce: string) => {
    switch (portal.target) {
      case 'projects':
        router.push('/projects');
        return;
      case 'entrepreneurs':
        router.push('/portal/entrepreneurs');
        return;
      case 'advisor':
        router.push({ pathname: '/advisor', params: { ctxType: 'portal', ctxId: portal.key, ctxTitle: portal.title, ctxNonce: nonce } });
    }
  };

  const greeting = status === 'signedIn' && me ? t('home.greeting', { name: me.name.split(' ')[0] }) : '';
  const featured = videos.data?.pages[0]?.featured ?? [];
  const teaser = services.data?.services.slice(0, 4) ?? [];

  return (
    <Screen aboveTabBar refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} />}>
      {/* «رسائل الإدارة» is the first thing on the home, above the hero (owner, 2026-09-16 and again 2026-09-22). Renders nothing without posts. */}
      <PostsBlock />

      <View style={styles.hero}>
        <Image source={clubLogo} style={styles.logo} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
        <Text style={styles.eyebrow}>{content.hero.eyebrow}</Text>
        <Text style={styles.heroTitle}>{content.hero.title}</Text>
        <Text style={styles.heroSubtitle}>{greeting ? `${greeting} ${content.hero.subtitle}` : content.hero.subtitle}</Text>
      </View>

      <View style={styles.portals}>
        {content.portals.map((portal) => (
          <PortalCard key={portal.key} portal={portal} onPress={() => openPortal(portal, String(Date.now()))} />
        ))}
      </View>

      <SectionHeader title={content.golden.title} subtitle={content.golden.subtitle} cta={content.golden.cta} onPress={() => router.push('/golden')} />
      {golden.data ? <GoldenStrip content={golden.data} onPress={() => router.push('/golden')} /> : null}

      <MembershipBlock
        block={content.membership}
        signedIn={status === 'signedIn'}
        membership={me?.membership ?? null}
        statusTexts={membershipContent.data?.statusTexts}
        onPress={() => router.push('/membership')}
      />

      <SectionHeader title={content.services.title} subtitle={content.services.subtitle} cta={content.services.cta} onPress={() => router.push('/services')} />
      <View style={styles.list}>
        {teaser.map((service) => (
          <ServiceCard key={service.key} service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
        ))}
      </View>

      {featured.length ? (
        <>
          <SectionHeader title={content.videos.title} subtitle={content.videos.subtitle} cta={content.videos.cta} onPress={() => router.push('/videos')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {featured.slice(0, 6).map((video) => (
              <VideoCard key={video.id} video={video} width={240} onPress={() => void openLink(video.url)} />
            ))}
          </ScrollView>
        </>
      ) : null}

      <View style={styles.footerLinks}>
        <FooterLink icon="business-outline" label={t('nav.hq')} onPress={() => router.push('/hq')} />
        <FooterLink icon="information-circle-outline" label={t('nav.about')} onPress={() => router.push('/about')} />
      </View>
    </Screen>
  );
}

function GoldenStrip({ content, onPress }: { content: GoldenContent; onPress: () => void }) {
  const companies = [content.umbrella, ...content.companies];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {companies.map((company) => (
        <GoldenMini key={company.code} company={company} onPress={onPress} />
      ))}
    </ScrollView>
  );
}

function GoldenMini({ company, onPress }: { company: GoldenCompany; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.mini, pressed && styles.pressed]}>
      <View style={styles.miniLogoBox}>
        <Image source={{ uri: company.logoUrl }} style={styles.miniLogo} resizeMode="contain" accessibilityLabel={company.name} />
      </View>
      <Text style={styles.miniName} numberOfLines={2}>
        {company.name}
      </Text>
      {company.valuationSarMillions !== null ? <Text style={styles.miniValue}>{formatMillionsSar(company.valuationSarMillions)}</Text> : <Text style={styles.miniCode}>{company.code}</Text>}
    </Pressable>
  );
}

type MembershipBlockProps = {
  block: HomeContent['membership'];
  signedIn: boolean;
  membership: NonNullable<ReturnType<typeof useAuth>['me']>['membership'] | null;
  statusTexts: Parameters<typeof MembershipStatusCard>[0]['texts'];
  onPress: () => void;
};

function MembershipBlock({ block, signedIn, membership, statusTexts, onPress }: MembershipBlockProps) {
  const active = membership?.status === 'active';
  return (
    <View style={styles.membership}>
      <View style={styles.membershipHeader}>
        <Ionicons name="ribbon" size={26} color={colors.gold} />
        <Text style={styles.membershipTitle}>{block.title}</Text>
      </View>
      {signedIn ? <MembershipStatusCard membership={membership} texts={statusTexts} title={block.title} /> : null}
      <Text style={styles.membershipText}>{active ? block.activeText : block.subtitle}</Text>
      <AppButton label={block.cta} variant={active ? 'outline' : 'primary'} icon={chevronForward()} onPress={onPress} />
    </View>
  );
}

function FooterLink({ icon, label, onPress }: { icon: IoniconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.footerLink, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.gold} />
      <Text style={styles.footerLinkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  logo: { width: 84, height: 84, marginBottom: spacing.xs },
  eyebrow: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.gold, letterSpacing: 1 },
  heroTitle: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 40, color: colors.textPrimary, textAlign: 'center' },
  heroSubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  portals: { gap: spacing.sm, marginTop: spacing.sm },
  list: { gap: spacing.sm },
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  pressed: { opacity: 0.8 },
  mini: {
    width: 124,
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  miniLogoBox: { width: 72, height: 72, padding: spacing.xs, borderRadius: radii.md, backgroundColor: colors.white },
  miniLogo: { width: '100%', height: '100%' },
  miniName: { ...typography.caption, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: 'center', minHeight: 40 },
  miniValue: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 18, color: colors.goldLight },
  miniCode: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 18, color: colors.gold },
  membership: {
    gap: spacing.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surfaceElevated,
  },
  membershipHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  membershipTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: colors.gold, textAlign: textStart },
  membershipText: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  footerLinks: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  footerLink: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerLinkText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 22, color: colors.textPrimary },
});

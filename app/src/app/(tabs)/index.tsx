import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMembershipContent } from '@/api/auth';
import { useHomeContent, useServices, type HomeContent, type HomePortal } from '@/api/content';
import { useGolden } from '@/api/queries';
import type { GoldenCompany, GoldenContent } from '@/api/types';
import { useLatestPosts } from '@/api/posts';
import { useVideos } from '@/api/videos';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AgendaBlock } from '@/components/AgendaBlock';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldHairline, NeonPulse } from '@/components/lux';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { entranceDelay, FadeInView, Floating, PressScale, SkeletonCards } from '@/components/motion';
import { PeopleBlock } from '@/components/PeopleBlock';
import { PortalCard } from '@/components/PortalCard';
import { HOME_POSTS_LIMIT, PostsBlock } from '@/components/PostsBlock';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ServiceCard } from '@/components/ServiceCard';
import { StateView } from '@/components/StateView';
import { VideoCard } from '@/components/VideoCard';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import type { IoniconName } from '@/lib/icons';
import { playVideo } from '@/lib/player';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

// V2: the hero carries the official emblem (mark only) — the full logo lives on the auth screens.
const clubEmblem = require('../../../assets/images/club-emblem.png');

// Card widths of the horizontal strips; the snap step is the width plus the strip gap.
const MINI_WIDTH = 124;
const MINI_LOGO = 72;
const VIDEO_WIDTH = 240;

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
        {home.isLoading ? (
          <SkeletonCards count={4} />
        ) : (
          <StateView loading={false} error={home.error} onRetry={() => void home.refetch()} />
        )}
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
      case 'guide':
        // M10: the neutral portal opens the neutral's guide; its first step opens the advisor.
        router.push('/guide' as Href);
        return;
      default:
        router.push({ pathname: '/advisor', params: { ctxType: 'portal', ctxId: portal.key, ctxTitle: portal.title, ctxNonce: nonce } });
    }
  };

  const greeting = status === 'signedIn' && me ? t('home.greeting', { name: me.name.split(' ')[0] }) : '';
  const featured = videos.data?.pages[0]?.featured ?? [];
  const teaser = services.data?.services.slice(0, 4) ?? [];

  return (
    <Screen aboveTabBar refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}>
      {/* Home order (owner, 2026-09-23, replacing his 2026-09-16 «رسائل الإدارة أول حاجة» rule):
          the logo and slogan first, then «رسائل الإدارة», then «أجندة النادي», then the portals.
          Both blocks render nothing while empty. */}
      <View style={styles.hero}>
        <FadeInView offset={12}>
          <Floating>
            <View style={styles.emblemRing}>
              <NeonPulse radius={radii.pill} />
              <Image source={clubEmblem} style={styles.emblem} resizeMode="contain" accessibilityLabel={t('common.clubName')} />
            </View>
          </Floating>
        </FadeInView>
        <FadeInView delay={90} offset={10}>
          <Text style={styles.eyebrow}>{content.hero.eyebrow}</Text>
        </FadeInView>
        <FadeInView delay={170} offset={10}>
          <Text style={styles.heroTitle}>{content.hero.title}</Text>
        </FadeInView>
        <FadeInView delay={250} offset={8}>
          <Text style={styles.heroSubtitle}>{greeting ? `${greeting} ${content.hero.subtitle}` : content.hero.subtitle}</Text>
        </FadeInView>
        <FadeInView delay={330} offset={0}>
          <GoldHairline style={styles.heroDivider} />
        </FadeInView>
      </View>

      <PostsBlock />

      <AgendaBlock />

      <View style={styles.portals}>
        {content.portals.map((portal, index) => (
          <FadeInView key={portal.key} delay={120 + entranceDelay(index, 80)}>
            <PortalCard portal={portal} onPress={() => openPortal(portal, String(Date.now()))} />
          </FadeInView>
        ))}
      </View>

      {/* «شخصية ومسيرة» (M11): the approved club figures, early on the home. Renders nothing while none are approved. */}
      <PeopleBlock />

      <FadeInView delay={220}>
        <SectionHeader title={content.golden.title} subtitle={content.golden.subtitle} cta={content.golden.cta} onPress={() => router.push('/golden')} />
        {golden.data ? <GoldenStrip content={golden.data} onPress={() => router.push('/golden')} /> : null}
      </FadeInView>

      <FadeInView delay={280}>
        <MembershipBlock
          block={content.membership}
          signedIn={status === 'signedIn'}
          membership={me?.membership ?? null}
          statusTexts={membershipContent.data?.statusTexts}
          onPress={() => router.push('/membership')}
        />
      </FadeInView>

      <FadeInView delay={320}>
        <SectionHeader title={content.services.title} subtitle={content.services.subtitle} cta={content.services.cta} onPress={() => router.push('/services')} />
        <View style={styles.list}>
          {teaser.map((service, index) => (
            <FadeInView key={service.key} delay={entranceDelay(index)}>
              <ServiceCard service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
            </FadeInView>
          ))}
        </View>
      </FadeInView>

      {featured.length ? (
        <FadeInView delay={360}>
          <SectionHeader title={content.videos.title} subtitle={content.videos.subtitle} cta={content.videos.cta} onPress={() => router.push('/videos')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            snapToInterval={VIDEO_WIDTH + spacing.sm}
            decelerationRate="fast"
          >
            {featured.slice(0, 6).map((video, index) => (
              <FadeInView key={video.id} delay={entranceDelay(index)}>
                <VideoCard video={video} width={VIDEO_WIDTH} onPress={() => playVideo(router, { url: video.url, title: video.title, poster: video.thumbnail })} />
              </FadeInView>
            ))}
          </ScrollView>
        </FadeInView>
      ) : null}

      <FadeInView delay={400}>
        <View style={styles.footerLinks}>
          <FooterLink icon="business-outline" label={t('nav.hq')} onPress={() => router.push('/hq')} />
          <FooterLink icon="information-circle-outline" label={t('nav.about')} onPress={() => router.push('/about')} />
        </View>
      </FadeInView>
    </Screen>
  );
}

function GoldenStrip({ content, onPress }: { content: GoldenContent; onPress: () => void }) {
  const companies = [content.umbrella, ...content.companies];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      snapToInterval={MINI_WIDTH + spacing.sm}
      decelerationRate="fast"
    >
      {companies.map((company, index) => (
        <FadeInView key={company.code} delay={entranceDelay(index)}>
          <GoldenMini company={company} onPress={onPress} />
        </FadeInView>
      ))}
    </ScrollView>
  );
}

function GoldenMini({ company, onPress }: { company: GoldenCompany; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityLabel={company.name}>
      <GlassCard golden radius={radii.lg} style={styles.mini}>
        {/* No Sheen here: a dozen minis would run a dozen loops; the golden GlassCard carries the premium read. */}
        <View style={styles.miniLogoBox}>
          <Image source={{ uri: company.logoUrl }} style={styles.miniLogo} resizeMode="contain" accessibilityLabel={company.name} />
        </View>
        <Text style={styles.miniName} numberOfLines={2}>
          {company.name}
        </Text>
        <Text style={styles.miniCode}>{company.code}</Text>
      </GlassCard>
    </PressScale>
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
    <GlassCard golden radius={radii.xl} style={styles.membership}>
      <View style={styles.membershipHeader}>
        <Ionicons name="ribbon" size={26} color={colors.gold} />
        <Text style={styles.membershipTitle}>{block.title}</Text>
      </View>
      {signedIn ? <MembershipStatusCard membership={membership} texts={statusTexts} title={block.title} /> : null}
      <Text style={styles.membershipText}>{active ? block.activeText : block.subtitle}</Text>
      <AppButton label={block.cta} variant={active ? 'outline' : 'primary'} icon={chevronForward()} onPress={onPress} />
    </GlassCard>
  );
}

function FooterLink({ icon, label, onPress }: { icon: IoniconName; label: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.md} wrapStyle={styles.footerLinkWrap} style={styles.footerLink}>
      <Ionicons name={icon} size={20} color={colors.gold} />
      <Text style={styles.footerLinkText}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  emblemRing: {
    width: 116,
    height: 116,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldFaint,
    marginBottom: spacing.xs,
  },
  emblem: { width: 84, height: 84 },
  heroDivider: { width: 72, marginTop: spacing.sm, alignSelf: 'center' },
  eyebrow: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.gold, letterSpacing: 1 },
  heroTitle: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 40, color: colors.textPrimary, textAlign: 'center' },
  heroSubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  portals: { gap: spacing.sm, marginTop: spacing.sm },
  list: { gap: spacing.sm, marginTop: spacing.sm },
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  mini: {
    width: MINI_WIDTH,
    gap: spacing.xs,
    padding: spacing.sm,
    alignItems: 'center',
  },
  miniLogoBox: {
    width: MINI_LOGO,
    height: MINI_LOGO,
    padding: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  miniLogo: { width: '100%', height: '100%' },
  miniName: { ...typography.caption, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: 'center', minHeight: 40 },
  miniCode: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 18, color: colors.gold },
  membership: {
    gap: spacing.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  membershipHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  membershipTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: colors.gold, textAlign: textStart },
  membershipText: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  footerLinks: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  footerLinkWrap: { flex: 1 },
  footerLink: {
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

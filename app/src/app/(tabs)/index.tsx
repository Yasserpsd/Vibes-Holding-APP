import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAgenda } from '@/api/agenda';
import { useHomeContent, useServices, type HomePortal, type HomeCta, type HomeSectionKey, type PortalKey } from '@/api/content';
import { usePartners, type Partner } from '@/api/partners';
import { usePeople } from '@/api/people';
import { useGolden, useProjectsList } from '@/api/queries';
import type { GoldenCompany, GoldenContent } from '@/api/types';
import { useLatestPosts } from '@/api/posts';
import { useVideos } from '@/api/videos';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AgendaBlock } from '@/components/AgendaBlock';
import { IntroVideoPopup } from '@/components/IntroVideo';
import { GlassCard, GoldGradient, GoldHairline, NeonPulse } from '@/components/lux';
import { entranceDelay, FadeInView, Floating, PressScale, SkeletonCards } from '@/components/motion';
import { PeopleBlock } from '@/components/PeopleBlock';
import { PersonaSwitchCard } from '@/components/PersonaSwitchCard';
import { ProjectsBankCarousel } from '@/components/ProjectsBankCarousel';
import { HOME_POSTS_LIMIT, PostsBlock } from '@/components/PostsBlock';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ServiceTile, serviceGridStyle, serviceTileWrapStyle } from '@/components/ServiceTile';
import { StateView } from '@/components/StateView';
import { VideoCard } from '@/components/VideoCard';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { iconFor, type IoniconName } from '@/lib/icons';
import { playVideo } from '@/lib/player';
import { markSeen } from '@/lib/seen';
import { formatNumber } from '@/lib/format';
import { GoldDust, GoldTicker } from '@/components/wow';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

// V2: the hero carries the official emblem (mark only) — the full logo lives on the auth screens.
const clubEmblem = require('../../../assets/images/club-emblem.png');

// Card widths of the horizontal strips; the snap step is the width plus the strip gap.
const MINI_WIDTH = 124;
const MINI_LOGO = 72;
const VIDEO_WIDTH = 240;

// M74: the default block order (an older server sends no personas map). New blocks render only when the server carries them.
// The membership block left the home page for good (owner, 2026-10-17); a server order naming it is skipped.
const DEFAULT_ORDER: HomeSectionKey[] = ['famous', 'posts', 'agenda', 'portals', 'golden', 'services', 'partners', 'videos', 'projectsBank', 'quickActions'];

export default function HomeScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const home = useHomeContent();
  const golden = useGolden();
  const services = useServices();
  const videos = useVideos();
  const partners = usePartners();
  // M85f ticker sources (the badges hook and the carousel share these cache entries).
  const projectsList = useProjectsList({ q: '', sort: 'latest' });
  const agenda = useAgenda();
  const people = usePeople();
  // Same query as <PostsBlock />: one cache entry, refetched with the rest on pull-to-refresh.
  const latestPosts = useLatestPosts(HOME_POSTS_LIMIT);
  const [refreshing, setRefreshing] = useState(false);
  // Tab screens keep the floating «اسأل المستشار» button above the tab bar.
  useAdvisorScreen({ type: 'screen', id: 'home', title: t('tabs.home') }, true);
  // M75: opening the home clears its +N badge.
  useFocusEffect(
    useCallback(() => {
      markSeen('home');
    }, []),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([home.refetch(), golden.refetch(), services.refetch(), videos.refetch(), partners.refetch(), latestPosts.refetch()]);
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

  // M85f: the live gold ticker — honest numbers from the queries this screen holds anyway.
  const projectsTotal = projectsList.data?.pages[0]?.total ?? 0;
  const goldenCount = golden.data ? golden.data.companies.length + 1 : 0;
  const peopleCount = people.data?.people.length ?? 0;
  const nextEvent = (agenda.data?.events ?? []).find((event) => !event.past);
  const tickerItems = [
    projectsTotal > 0 ? t('wow.tickerProjects', { count: formatNumber(projectsTotal) }) : null,
    nextEvent ? t('wow.tickerEvent', { title: nextEvent.title }) : null,
    goldenCount > 0 ? t('wow.tickerGolden', { count: formatNumber(goldenCount) }) : null,
    peopleCount > 0 ? t('wow.tickerPeople', { count: formatNumber(peopleCount) }) : null,
  ].filter((item): item is string => item !== null);

  // M74: the home follows the account's persona — a signed-in account without one reads the neutral variant.
  const signedIn = status === 'signedIn';
  const personaKey: PortalKey | 'guest' = signedIn ? (me?.persona || 'neutral') : 'guest';
  const variant = content.personas?.[personaKey];
  const heroSubtitle = variant?.heroSubtitle || content.hero.subtitle;
  // The server's order first, then any block it left out, so nothing silently disappears.
  const order: HomeSectionKey[] = [...(variant?.order ?? []), ...DEFAULT_ORDER.filter((key) => !(variant?.order ?? []).includes(key))];
  const ctaOf = (key: HomeSectionKey): HomeCta | null => variant?.ctas?.[key] ?? null;
  const pushRoute = (route: string) => router.push(route as Href);

  // M74 (owner): رائد الأعمال sees ALL the services up front, with the distinctive «+» to شركاء النجاح.
  const allServices = services.data?.services ?? [];
  const teaser = personaKey === 'entrepreneur' ? allServices : allServices.slice(0, 4);

  const sections: Partial<Record<HomeSectionKey, () => ReactElement | null>> = {
    famous: () => <PeopleBlock key="famous" block={content.famous} />,
    posts: () => <PostsBlock key="posts" />,
    agenda: () => <AgendaBlock key="agenda" ctaLabel={ctaOf('agenda')?.label} />,
    // M74 addition 3 (owner): the three gateway icons show for a GUEST only, side by side, compact.
    portals: () =>
      signedIn && me?.persona ? null : (
        <View key="portals" style={styles.portalsRow}>
          {content.portals.map((portal, index) => (
            <FadeInView key={portal.key} delay={120 + entranceDelay(index, 80)} style={styles.portalItem}>
              <PortalChip portal={portal} onPress={() => openPortal(portal, String(Date.now()))} />
            </FadeInView>
          ))}
        </View>
      ),
    quickActions: () =>
      signedIn ? (
        <FadeInView key="quickActions" delay={180}>
          <View style={styles.quickRow}>
            <QuickAction icon="card-outline" label={t('nav.card')} onPress={() => router.push('/card' as Href)} />
            <QuickAction icon="business-outline" label={t('account.menu.hq')} onPress={() => router.push('/hq')} />
            <QuickAction icon="gift-outline" label={t('account.menu.invite')} onPress={() => router.push('/invite' as Href)} />
            <QuickAction icon="chatbubbles-outline" label={t('account.menu.contact')} onPress={() => router.push('/contact' as Href)} />
          </View>
        </FadeInView>
      ) : null,
    // M84 (owner): the Projects Bank block with the auto-rotating images, «زي الموقع بالظبط».
    projectsBank: () =>
      content.projectsBank ? (
        <FadeInView key="projectsBank" delay={200}>
          <SectionHeader
            title={content.projectsBank.title}
            subtitle={content.projectsBank.subtitle}
            cta={ctaOf('projectsBank')?.label ?? content.projectsBank.cta}
            onPress={() => pushRoute(ctaOf('projectsBank')?.route ?? '/projects')}
          />
          <ProjectsBankCarousel />
        </FadeInView>
      ) : null,
    golden: () => (
      <FadeInView key="golden" delay={220}>
        <SectionHeader
          title={content.golden.title}
          subtitle={content.golden.subtitle}
          cta={ctaOf('golden')?.label ?? content.golden.cta}
          onPress={() => pushRoute(ctaOf('golden')?.route ?? '/golden')}
        />
        {golden.data ? <GoldenStrip content={golden.data} onPress={() => router.push('/golden')} /> : null}
      </FadeInView>
    ),
    services: () => (
      <FadeInView key="services" delay={320}>
        <SectionHeader
          title={content.services.title}
          subtitle={content.services.subtitle}
          cta={ctaOf('services')?.label ?? content.services.cta}
          onPress={() => pushRoute(ctaOf('services')?.route ?? '/services')}
        />
        {personaKey === 'entrepreneur' ? (
          <View style={styles.list}>
            <PartnersPlusCard onPress={() => pushRoute('/service/success-partners')} />
          </View>
        ) : null}
        {/* M85: the light 2-column tiles, on the home too. */}
        <View style={serviceGridStyle}>
          {teaser.map((service, index) => (
            <FadeInView key={service.key} delay={entranceDelay(index)} style={serviceTileWrapStyle}>
              <ServiceTile service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
            </FadeInView>
          ))}
        </View>
      </FadeInView>
    ),
    // M68 «شركاؤنا»: renders only when the server already carries the block and at least one partner is visible.
    partners: () =>
      content.partners && (partners.data?.partners.length ?? 0) > 0 ? (
        <FadeInView key="partners" delay={340}>
          <SectionHeader title={content.partners.title} subtitle={content.partners.subtitle} cta={content.partners.cta} onPress={() => router.push('/partners' as Href)} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            snapToInterval={MINI_WIDTH + spacing.sm}
            decelerationRate="fast"
          >
            {(partners.data?.partners ?? []).map((partner, index) => (
              <FadeInView key={partner.id} delay={entranceDelay(index)}>
                <PartnerMini partner={partner} onPress={() => router.push('/partners' as Href)} />
              </FadeInView>
            ))}
          </ScrollView>
        </FadeInView>
      ) : null,
    videos: () =>
      featured.length ? (
        <FadeInView key="videos" delay={360}>
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
      ) : null,
  };

  return (
    <Screen aboveTabBar refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}>
      {/* M84: the one-time «تعرف علينا أكتر» film popup — first open only. */}
      <IntroVideoPopup />
      {/* The hero leads for everyone; after it the blocks follow the persona's order (M74). */}
      <View style={styles.hero}>
        {/* M85f: golden dust drifting up behind the emblem. */}
        <GoldDust height={130} />
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
          <Text style={styles.heroSubtitle}>{greeting ? `${greeting} ${heroSubtitle}` : heroSubtitle}</Text>
        </FadeInView>
        <FadeInView delay={330} offset={0}>
          <GoldHairline style={styles.heroDivider} />
        </FadeInView>
      </View>

      {/* M85f: the live gold ticker — stock-exchange energy under the hero. */}
      {tickerItems.length > 0 ? (
        <FadeInView delay={360} offset={6}>
          <GoldTicker items={tickerItems} />
        </FadeInView>
      ) : null}

      {order.map((key) => sections[key]?.() ?? null)}

      {/* M74: the neutral's gentle «هل حددت وجهتك؟» card — switch the category from inside the app. */}
      {signedIn && me?.persona === 'neutral' ? (
        <FadeInView delay={380}>
          <PersonaSwitchCard />
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

/** M74 addition 3: a guest's gateway — one compact icon chip per persona, the three side by side. */
function PortalChip({ portal, onPress }: { portal: HomePortal; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={`${portal.title} — ${portal.subtitle}`}>
      <GlassCard golden radius={radii.lg} style={styles.portalChip}>
        <GoldGradient style={styles.portalChipIcon}>
          <Ionicons name={iconFor(portal.icon, 'grid-outline')} size={22} color={colors.goldInk} />
        </GoldGradient>
        <Text style={styles.portalChipTitle} numberOfLines={1}>
          {portal.title}
        </Text>
        <Text style={styles.portalChipSubtitle} numberOfLines={1}>
          {portal.subtitle}
        </Text>
      </GlassCard>
    </PressScale>
  );
}

/** M84 (owner): the shortcuts that lived deep in «حسابي», now icon tiles on the first page — icons gently alive. */
function QuickAction({ icon, label, onPress }: { icon: IoniconName; label: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} wrapStyle={styles.quickItem} accessibilityRole="button" accessibilityLabel={label}>
      <GlassCard radius={radii.lg} style={styles.quickCard}>
        <Floating amplitude={2} duration={2200}>
          <View style={styles.quickIcon}>
            <Ionicons name={icon} size={22} color={colors.gold} />
          </View>
        </Floating>
        <Text style={styles.quickLabel} numberOfLines={2}>
          {label}
        </Text>
      </GlassCard>
    </PressScale>
  );
}

/** M74 (owner): the VERY distinctive «+» of رائد الأعمال — it opens the شركاء النجاح gate. */
function PartnersPlusCard({ onPress }: { onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={t('home.partnersPlus')}>
      <GoldGradient style={styles.plusCard}>
        <View style={styles.plusBadge}>
          <Ionicons name="add" size={30} color={colors.gold} />
        </View>
        <View style={styles.plusTexts}>
          <Text style={styles.plusTitle}>{t('home.partnersPlus')}</Text>
          <Text style={styles.plusHint} numberOfLines={1}>
            {t('home.partnersPlusHint')}
          </Text>
        </View>
        <Ionicons name={chevronForward()} size={20} color={colors.goldInk} />
      </GoldGradient>
    </PressScale>
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

/** A partner on the home strip: the logo and the name; the card opens the partners page. */
function PartnerMini({ partner, onPress }: { partner: Partner; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityLabel={partner.name}>
      <GlassCard radius={radii.lg} style={styles.mini}>
        <View style={styles.miniLogoBox}>
          {partner.logoUrl ? (
            <Image source={{ uri: partner.logoUrl }} style={styles.miniLogo} resizeMode="contain" accessibilityLabel={partner.name} />
          ) : (
            <View style={styles.miniLogoFallback}>
              <Ionicons name="business-outline" size={28} color={colors.gold} />
            </View>
          )}
        </View>
        <Text style={styles.miniName} numberOfLines={2}>
          {partner.name}
        </Text>
      </GlassCard>
    </PressScale>
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
  // M85c: the hero got compact — the screen belongs to the content, not the emblem.
  hero: { alignItems: 'center', gap: 2, paddingTop: spacing.xs },
  emblemRing: {
    width: 88,
    height: 88,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldFaint,
    marginBottom: 2,
  },
  emblem: { width: 62, height: 62 },
  heroDivider: { width: 72, marginTop: spacing.xs, alignSelf: 'center' },
  eyebrow: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.gold, letterSpacing: 1 },
  heroTitle: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 34, color: colors.textPrimary, textAlign: 'center' },
  heroSubtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  // M74: the guest's three gateway chips, side by side and compact.
  portalsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  portalItem: { flex: 1 },
  portalChip: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.xs },
  portalChipIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGoldFaint,
  },
  portalChipTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.textPrimary, textAlign: 'center' },
  portalChipSubtitle: { ...typography.caption, fontSize: 10, lineHeight: 15, color: colors.textSecondary, textAlign: 'center' },
  // M84: the quick-action icon tiles.
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  quickItem: { flex: 1 },
  quickCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: 4 },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  quickLabel: { ...typography.caption, fontSize: 10, lineHeight: 15, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: 'center' },
  // M74: the entrepreneur's «+» to شركاء النجاح — deliberately unlike every other card.
  plusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.xl,
    boxShadow: shadows.glowGold,
  },
  plusBadge: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldInk,
  },
  plusTexts: { flex: 1, gap: 2 },
  plusTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.goldInk, textAlign: textStart },
  plusHint: { ...typography.caption, color: colors.goldInk, opacity: 0.8, textAlign: textStart },
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
  miniLogoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  miniName: { ...typography.caption, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: 'center', minHeight: 40 },
  miniCode: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 18, color: colors.gold },
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

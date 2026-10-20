import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useHomeContent, useServices, type HomeContent, type HomePortal, type HomeCta, type HomeSectionKey, type PortalKey } from '@/api/content';
import { useHq } from '@/api/hq';
import { usePartners, type Partner } from '@/api/partners';
import { useLatestPosts } from '@/api/posts';
import { useVideos } from '@/api/videos';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AgendaBlock } from '@/components/AgendaBlock';
import { ClubTourStrip } from '@/components/ClubTourStrip';
import { IntroVideoPopup } from '@/components/IntroVideo';
import { GlassCard, GoldGradient, GoldHairline } from '@/components/lux';
import { entranceDelay, FadeInView, Floating, PressScale, SkeletonCards } from '@/components/motion';
import { PeopleBlock } from '@/components/PeopleBlock';
import { PersonaSwitchCard } from '@/components/PersonaSwitchCard';
import { ProjectsBankCarousel } from '@/components/ProjectsBankCarousel';
import { HOME_POSTS_LIMIT, PostsBlock } from '@/components/PostsBlock';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { SlotBanner } from '@/components/SlotBanner';
import { GoldenOpportunity } from '@/components/GoldenOpportunity';
import { ServiceTile, serviceGridStyle, serviceTileWrapStyle } from '@/components/ServiceTile';
import { WalletCard } from '@/components/WalletCard';
import { StateView } from '@/components/StateView';
import { VideoCard } from '@/components/VideoCard';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { iconFor, type IoniconName } from '@/lib/icons';
import { playVideo } from '@/lib/player';
import { markSeen } from '@/lib/seen';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

// V2: the hero carries the official emblem (mark only) — the full logo lives on the auth screens.
const clubEmblem = require('../../../assets/images/club-emblem.png');

// Card widths of the horizontal strips; the snap step is the width plus the strip gap.
const MINI_WIDTH = 124;
const MINI_LOGO = 72;
const VIDEO_WIDTH = 240;

// M74: the default block order (an older server sends no personas map). New blocks render only when the server carries them.
// The membership block left the home page for good (owner, 2026-10-17), and the golden strip followed it
// (owner, 2026-10-18) — «جولة في النادي» stands in its place; a server order naming either is skipped.
const DEFAULT_ORDER: HomeSectionKey[] = ['famous', 'posts', 'agenda', 'portals', 'tour', 'services', 'partners', 'videos', 'projectsBank', 'quickActions'];

export default function HomeScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const home = useHomeContent();
  const services = useServices();
  const videos = useVideos();
  const partners = usePartners();
  // Same query as <PostsBlock />: one cache entry, refetched with the rest on pull-to-refresh.
  const latestPosts = useLatestPosts(HOME_POSTS_LIMIT);
  const [refreshing, setRefreshing] = useState(false);
  // M102: the entrepreneur's collapsed services grid.
  const [gridOpen, setGridOpen] = useState(false);
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
    await Promise.all([home.refetch(), services.refetch(), videos.refetch(), partners.refetch(), latestPosts.refetch()]);
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

  // M74: the home follows the account's persona — a signed-in account without one reads the neutral variant.
  const signedIn = status === 'signedIn';
  const personaKey: PortalKey | 'guest' = signedIn ? (me?.persona || 'neutral') : 'guest';
  const variant = content.personas?.[personaKey];
  const heroSubtitle = variant?.heroSubtitle || content.hero.subtitle;
  // The server's order first, then any block it left out, so nothing silently disappears —
  // M99: except the blocks the persona explicitly hides (the Projects Bank leaves the entrepreneur's home).
  const hidden = new Set(variant?.hide ?? []);
  const order: HomeSectionKey[] = [...(variant?.order ?? []), ...DEFAULT_ORDER.filter((key) => !(variant?.order ?? []).includes(key))].filter(
    (key) => !hidden.has(key),
  );
  const ctaOf = (key: HomeSectionKey): HomeCta | null => variant?.ctas?.[key] ?? null;
  const pushRoute = (route: string) => router.push(route as Href);

  // M74/M99: the persona's lead services open his grid, the rest follow; the entrepreneur keeps his «+»
  // and his full grid, and the guest browses EVERYTHING (M99a).
  const allServices = services.data?.services ?? [];
  const leadKeys = variant?.serviceKeys ?? [];
  const leadRank = (key: string): number => {
    const at = leadKeys.indexOf(key);
    return at === -1 ? leadKeys.length : at;
  };
  const orderedServices = leadKeys.length ? [...allServices].sort((a, b) => leadRank(a.key) - leadRank(b.key)) : allServices;
  // M102 (owner): the entrepreneur's home shows only HIS two doors — شركاء النجاح and نشر تطبيقه،
  // TWIN gold cards — and the rest of the grid waits behind a loud «اضغط للمزيد».
  const teaser =
    personaKey === 'entrepreneur'
      ? gridOpen
        ? orderedServices.filter((service) => service.key !== 'app-publish')
        : []
      : personaKey === 'guest'
        ? orderedServices
        : orderedServices.slice(0, 4);
  const gridCollapsible = personaKey === 'entrepreneur' && orderedServices.length > 1;

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
            icon="briefcase-outline"
            title={content.projectsBank.title}
            subtitle={content.projectsBank.subtitle}
            cta={ctaOf('projectsBank')?.label ?? content.projectsBank.cta}
            onPress={() => pushRoute(ctaOf('projectsBank')?.route ?? '/projects')}
          />
          <ProjectsBankCarousel />
        </FadeInView>
      ) : null,
    // M99a: the guest's first CONTENT block — مميزات العضوية, straight after the persona picker.
    membership: () =>
      !signedIn && content.membership ? (
        <FadeInView key="membership" delay={190}>
          <MembershipTeaserCard block={content.membership} onPress={() => pushRoute(ctaOf('membership')?.route ?? '/membership')} />
        </FadeInView>
      ) : null,
    // M99c: the investor's opening act — one golden opportunity, renewed on every app open.
    opportunity: () =>
      content.opportunity ? (
        <FadeInView key="opportunity" delay={170}>
          <GoldenOpportunity block={content.opportunity} />
        </FadeInView>
      ) : null,
    // M99c: the investor's wallet — his balance and unlocked projects at a glance.
    wallet: () =>
      signedIn && content.wallet ? (
        <FadeInView key="wallet" delay={220}>
          <WalletCard block={content.wallet} />
        </FadeInView>
      ) : null,
    // M74-8 (owner): the advisor as the neutral's companion — next-step suggestion chips, one tap to the conversation.
    advisor: () =>
      content.advisor ? (
        <FadeInView key="advisor" delay={210}>
          <AdvisorCompanionCard block={content.advisor} onChip={pushRoute} onOpen={() => router.push('/advisor' as Href)} />
        </FadeInView>
      ) : null,
    // M74-7 (owner): the podcast studio featured — the member's stage to introduce himself and his field.
    podcast: () =>
      content.podcast ? (
        <FadeInView key="podcast" delay={230}>
          <PodcastStageCard block={content.podcast} onPress={() => pushRoute(ctaOf('podcast')?.route ?? content.podcast?.route ?? '/service/studio')} />
        </FadeInView>
      ) : null,
    // M74-5: what the membership saves while he explores his direction.
    savings: () =>
      content.savings ? (
        <FadeInView key="savings" delay={250}>
          <SavingsCard block={content.savings} onPress={() => pushRoute(ctaOf('savings')?.route ?? '/membership')} />
        </FadeInView>
      ) : null,
    // Owner (2026-10-18): the golden strip left the home («ملهاش اي داعي» — it lives inside بنك المشاريع);
    // the REAL HQ photos stand in its spot.
    tour: () => <ClubTourStrip key="tour" />,
    services: () => (
      <FadeInView key="services" delay={320}>
        <SectionHeader
          icon="grid-outline"
          title={content.services.title}
          subtitle={content.services.subtitle}
          cta={ctaOf('services')?.label ?? content.services.cta}
          onPress={() => pushRoute(ctaOf('services')?.route ?? '/services')}
        />
        {personaKey === 'entrepreneur' ? (
          <View style={styles.list}>
            <GoldDoorCard icon="add" title={t('home.partnersPlus')} hint={t('home.partnersPlusHint')} onPress={() => pushRoute('/service/success-partners')} />
            {/* M102 (owner): the second door, gold exactly like the first — publish his app, no fees. */}
            <GoldDoorCard icon="phone-portrait-outline" title={t('home.appPublish')} hint={t('home.appPublishHint')} onPress={() => pushRoute('/service/app-publish')} />
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
        {/* M102: the rest of the entrepreneur's grid, behind one tap. */}
        {gridCollapsible ? (
          <PressScale onPress={() => setGridOpen((open) => !open)} glow glowRadius={radii.md} accessibilityRole="button" accessibilityLabel={t(gridOpen ? 'home.lessServices' : 'home.moreServices')}>
            <View style={styles.moreServices}>
              <Text style={styles.moreServicesText}>{t(gridOpen ? 'home.lessServices' : 'home.moreServices')}</Text>
              <Ionicons name={gridOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.goldInk} />
            </View>
          </PressScale>
        ) : null}
      </FadeInView>
    ),
    // M68 «شركاؤنا»: renders only when the server already carries the block and at least one partner is visible.
    partners: () =>
      content.partners && (partners.data?.partners.length ?? 0) > 0 ? (
        <FadeInView key="partners" delay={340}>
          <SectionHeader icon="pricetags-outline" title={content.partners.title} subtitle={content.partners.subtitle} cta={content.partners.cta} onPress={() => router.push('/partners' as Href)} />
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
          <SectionHeader icon="play-circle-outline" title={content.videos.title} subtitle={content.videos.subtitle} cta={content.videos.cta} onPress={() => router.push('/videos')} />
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
        {/* Perf (owner, 2026-10-19): the dust and neon-pulse loops left the home — they ran forever
            alongside every other animation and dragged weaker phones. The floating emblem stays. */}
        <FadeInView offset={12}>
          <Floating>
            <View style={styles.emblemRing}>
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

      {/* M102 (owner, third ask): the image at the very top is the CLUB HQ photo, never the podcast
          banner — the first HQ-gallery photo leads; the home.banner slot only fills an empty gallery. */}
      <HqBanner />

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

/** M102: the home's top image — the real HQ, opening the HQ screen; the banner slot is the fallback. */
function HqBanner() {
  const router = useRouter();
  const photo = useHq().data?.photos?.[0] ?? null;
  if (!photo) return <SlotBanner slot="home.banner" />;
  return (
    <FadeInView delay={140}>
      <PressScale onPress={() => router.push('/hq')} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={t('nav.hq')}>
        <Image source={{ uri: photo }} style={styles.hqBanner} resizeMode="cover" resizeMethod="resize" accessibilityLabel={t('nav.hq')} />
      </PressScale>
    </FadeInView>
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

/** M74-8: the advisor-as-companion card — the neutral's central guide; every chip is a suggested next step. */
function AdvisorCompanionCard({ block, onChip, onOpen }: { block: NonNullable<HomeContent['advisor']>; onChip: (route: string) => void; onOpen: () => void }) {
  return (
    <GlassCard golden radius={radii.xl} style={styles.advisorCard}>
      <View style={styles.advisorHead}>
        <Floating amplitude={2} duration={2400}>
          <GoldGradient style={styles.advisorIcon}>
            <Ionicons name="sparkles" size={22} color={colors.goldInk} />
          </GoldGradient>
        </Floating>
        <View style={styles.advisorTexts}>
          <Text style={styles.advisorTitle}>{block.title}</Text>
          <Text style={styles.advisorSubtitle}>{block.subtitle}</Text>
        </View>
      </View>
      <View style={styles.advisorChips}>
        {block.chips.map((chip) => (
          <PressScale key={chip.label} onPress={() => onChip(chip.route)} glow glowRadius={radii.pill} accessibilityRole="button" accessibilityLabel={chip.label} style={styles.advisorChip}>
            <Text style={styles.advisorChipText}>{chip.label}</Text>
          </PressScale>
        ))}
      </View>
      <PressScale onPress={onOpen} glow glowRadius={radii.md} accessibilityRole="button" accessibilityLabel={block.cta}>
        <GoldGradient style={styles.advisorCta}>
          <Ionicons name="chatbubbles" size={18} color={colors.goldInk} />
          <Text style={styles.advisorCtaText}>{block.cta}</Text>
        </GoldGradient>
      </PressScale>
    </GlassCard>
  );
}

/** M74-7: the featured podcast card — the studio as the member's stage. */
function PodcastStageCard({ block, onPress }: { block: NonNullable<HomeContent['podcast']>; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={block.cta}>
      <GlassCard golden radius={radii.xl} style={styles.podcastCard}>
        <Floating amplitude={2} duration={2600}>
          <GoldGradient style={styles.podcastIcon}>
            <Ionicons name="mic" size={26} color={colors.goldInk} />
          </GoldGradient>
        </Floating>
        <View style={styles.podcastTexts}>
          <Text style={styles.podcastTitle}>{block.title}</Text>
          <Text style={styles.podcastSubtitle}>{block.subtitle}</Text>
          <View style={styles.podcastCtaRow}>
            <Text style={styles.podcastCta}>{block.cta}</Text>
            <Ionicons name={chevronForward()} size={14} color={colors.gold} />
          </View>
        </View>
      </GlassCard>
    </PressScale>
  );
}

/** M74-5: what the membership saves while he explores — golden bullets, one quiet CTA to the membership screen. */
function SavingsCard({ block, onPress }: { block: NonNullable<HomeContent['savings']>; onPress: () => void }) {
  return (
    <GlassCard radius={radii.xl} style={styles.savingsCard}>
      <Text style={styles.savingsTitle}>{block.title}</Text>
      <Text style={styles.savingsSubtitle}>{block.subtitle}</Text>
      <View style={styles.savingsList}>
        {block.items.map((item) => (
          <View key={item} style={styles.savingsRow}>
            <Ionicons name="diamond" size={12} color={colors.gold} />
            <Text style={styles.savingsItem}>{item}</Text>
          </View>
        ))}
      </View>
      <PressScale onPress={onPress} glow glowRadius={radii.md} accessibilityRole="button" accessibilityLabel={block.cta}>
        <View style={styles.savingsCta}>
          <Text style={styles.savingsCtaText}>{block.cta}</Text>
          <Ionicons name={chevronForward()} size={16} color={colors.gold} />
        </View>
      </PressScale>
    </GlassCard>
  );
}

/** M99a: the guest's «مميزات العضوية» card — his first content block, one tap to the full copy. */
function MembershipTeaserCard({ block, onPress }: { block: HomeContent['membership']; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={block.cta}>
      <GlassCard golden radius={radii.xl} style={styles.membershipCard}>
        <Floating amplitude={2} duration={2600}>
          <GoldGradient style={styles.membershipIcon}>
            <Ionicons name="star" size={24} color={colors.goldInk} />
          </GoldGradient>
        </Floating>
        <View style={styles.membershipTexts}>
          <Text style={styles.membershipTitle}>{block.title}</Text>
          <Text style={styles.membershipSubtitle}>{block.subtitle}</Text>
          <View style={styles.membershipCtaRow}>
            <Text style={styles.membershipCta}>{block.cta}</Text>
            <Ionicons name={chevronForward()} size={14} color={colors.gold} />
          </View>
        </View>
      </GlassCard>
    </PressScale>
  );
}

/** M74 + M102 (owner): the entrepreneur's gold doors — شركاء النجاح and نشر تطبيقه, twins by design. */
function GoldDoorCard({ icon, title, hint, onPress }: { icon: IoniconName; title: string; hint: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={title}>
      <GoldGradient style={styles.plusCard}>
        <View style={styles.plusBadge}>
          <Ionicons name={icon} size={icon === 'add' ? 30 : 24} color={colors.gold} />
        </View>
        <View style={styles.plusTexts}>
          <Text style={styles.plusTitle}>{title}</Text>
          <Text style={styles.plusHint} numberOfLines={1}>
            {hint}
          </Text>
        </View>
        <Ionicons name={chevronForward()} size={20} color={colors.goldInk} />
      </GoldGradient>
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
  // M102: the HQ photo crowning the home.
  hqBanner: {
    width: '100%',
    height: 150,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surfaceElevated,
    marginTop: spacing.sm,
    boxShadow: shadows.lift,
  },
  // M102 (owner): «اضغط للمزيد» must CATCH the eye — a full gold bar, not a quiet outline.
  moreServices: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 4,
    borderRadius: radii.md,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGold,
    marginTop: spacing.sm,
  },
  moreServicesText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.goldInk },
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
  // Reserved two-line height: a one-line label keeps its tile as tall as the rest of the row.
  quickLabel: { ...typography.caption, fontSize: 10, lineHeight: 15, minHeight: 30, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: 'center' },
  // M74-8: the advisor companion card.
  advisorCard: { gap: spacing.sm, padding: spacing.md, marginTop: spacing.sm },
  advisorHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  advisorIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGoldFaint,
  },
  advisorTexts: { flex: 1, gap: 2 },
  advisorTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  advisorSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  advisorChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  advisorChip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
  },
  advisorChipText: { ...typography.caption, fontFamily: fonts.medium, color: colors.textPrimary },
  advisorCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    boxShadow: shadows.glowGoldFaint,
  },
  advisorCtaText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.goldInk },
  // M74-7: the podcast stage card.
  podcastCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.sm },
  podcastIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGold,
  },
  podcastTexts: { flex: 1, gap: 2 },
  podcastTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.textPrimary, textAlign: textStart },
  podcastSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  podcastCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  podcastCta: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, color: colors.gold },
  // M74-5: the savings card.
  savingsCard: { gap: spacing.xs, padding: spacing.md, marginTop: spacing.sm },
  savingsTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  savingsSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  savingsList: { gap: spacing.xs, marginTop: 2 },
  savingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  savingsItem: { ...typography.body, fontSize: 13, lineHeight: 21, color: colors.textPrimary, flex: 1, textAlign: textStart },
  savingsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    marginTop: spacing.xs,
  },
  savingsCtaText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 22, color: colors.gold },
  // M99a: the guest's membership card.
  membershipCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.sm },
  membershipIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGold,
  },
  membershipTexts: { flex: 1, gap: 2 },
  membershipTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.textPrimary, textAlign: textStart },
  membershipSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  membershipCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  membershipCta: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, color: colors.gold },
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

import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { Image, Share, StyleSheet, Text, View } from 'react-native';

import { usePartners, type Partner } from '@/api/partners';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldGradient, NeonPulse } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M68 «شركاؤنا»: the partners program. Every partner card is server content the owner manages from
 * the dashboard; a subscribed member sees his own permanent promo code and uses it with EVERY
 * partner for the members' discount.
 */
export default function PartnersScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { data, isLoading, error, refetch } = usePartners();
  useAdvisorScreen({ type: 'screen', id: 'partners', title: data?.title ?? t('nav.partners') });

  if (!data) {
    return (
      <Screen title={t('nav.partners')}>
        <Stack.Screen options={{ title: t('nav.partners') }} />
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const sharePromo = (code: string) => {
    void Share.share({ message: t('partners.shareMessage', { code }) }).catch(() => undefined);
  };

  return (
    <Screen title={data.title} subtitle={data.intro} watermark>
      <Stack.Screen options={{ title: data.title }} />

      <FadeInView delay={entranceDelay(0)}>
        {data.promo ? (
          <PromoCard code={data.promo.code} title={data.codeTitle} hint={data.codeHint} onShare={sharePromo} />
        ) : (
          <GlassCard style={styles.gate}>
            <Notice tone="warning" text={data.membersOnlyText} />
            {status === 'signedIn' ? (
              /* M120 (owner): the lock answers with the subscribe popup — price and pay in one tap. */
              <AppButton label={t('partners.activate')} icon="ribbon-outline" onPress={showMembershipGate} />
            ) : (
              <AppButton label={t('card.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
            )}
          </GlassCard>
        )}
      </FadeInView>

      {data.partners.length === 0 ? (
        <FadeInView delay={entranceDelay(1)}>
          <Text style={styles.empty}>{t('partners.empty')}</Text>
        </FadeInView>
      ) : (
        data.partners.map((partner, index) => (
          <FadeInView key={partner.id} delay={entranceDelay(index + 1)}>
            <PartnerCard partner={partner} />
          </FadeInView>
        ))
      )}
    </Screen>
  );
}

/** The member's own code: gold on black, LTR and selectable, with a share button for his notes. */
function PromoCard({ code, title, hint, onShare }: { code: string; title: string; hint: string; onShare: (code: string) => void }) {
  return (
    <View style={styles.promo}>
      <NeonPulse radius={radii.lg} intensity="strong" />
      <View style={styles.promoInner}>
        <Text style={styles.promoTitle}>{title}</Text>
        <Text style={styles.promoCode} selectable>
          {code}
        </Text>
        <Text style={styles.promoHint}>{hint}</Text>
        <AppButton label={t('partners.share')} variant="outline" icon="share-social-outline" onPress={() => onShare(code)} />
      </View>
    </View>
  );
}

/** M123: a headline partner wears a gold ribbon across the card's top (server-driven wording). */
function PartnerCard({ partner }: { partner: Partner }) {
  return (
    <GlassCard golden={!!partner.ribbon} style={styles.partner}>
      {partner.ribbon ? (
        <GoldGradient style={styles.ribbon}>
          <Ionicons name="diamond" size={12} color={colors.black} />
          <Text style={styles.ribbonText} numberOfLines={1}>
            {partner.ribbon}
          </Text>
        </GoldGradient>
      ) : null}
      <View style={styles.partnerHead}>
        <View style={styles.logoBox}>
          {partner.logoUrl ? (
            <Image source={{ uri: partner.logoUrl }} style={styles.logo} resizeMode="contain" accessibilityLabel={partner.name} />
          ) : (
            <Ionicons name="business-outline" size={28} color={colors.gold} />
          )}
        </View>
        <View style={styles.partnerText}>
          <Text style={styles.partnerName}>{partner.name}</Text>
          {partner.discount ? (
            <View style={styles.discountPill}>
              <Text style={styles.discountText} numberOfLines={1}>
                {partner.discount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {partner.description ? <Text style={styles.partnerDetail}>{partner.description}</Text> : null}
      <AppButton label={t('partners.visit')} icon="cart-outline" onPress={() => void openLink(partner.url)} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  gate: { gap: spacing.md, padding: spacing.md },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },

  // The promo code slab: the same black-and-gold language as the membership card.
  promo: { borderRadius: radii.lg, borderWidth: 2, borderColor: colors.gold, backgroundColor: colors.black, padding: 5 },
  promoInner: {
    borderRadius: radii.lg - 5,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: '#0B0A08',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  promoTitle: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  promoCode: {
    fontFamily: fonts.bold,
    fontSize: 36,
    lineHeight: 48,
    color: colors.goldLight,
    writingDirection: 'ltr',
    letterSpacing: 8,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  promoHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },

  partner: { gap: spacing.sm, padding: spacing.md },
  // The ribbon bleeds past the card padding so the gold band runs edge to edge under the rounded corners.
  ribbon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  ribbonText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, color: colors.black },
  partnerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
    overflow: 'hidden',
  },
  logo: { width: '100%', height: '100%' },
  partnerText: { flex: 1, gap: 4 },
  partnerName: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  discountPill: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.goldSoft },
  discountText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.gold },
  partnerDetail: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
});

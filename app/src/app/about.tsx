import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';

import { useAboutContent, type AboutSection } from '@/api/content';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, Floating, PressScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { SlotBanner } from '@/components/SlotBanner';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import type { IoniconName } from '@/lib/icons';
import { openLink } from '@/lib/openLink';
import { openWhatsApp } from '@/lib/whatsapp';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/** «عنّا»: the club, its operator, Vibes Ventures and the ecosystem. All copy comes from the server. */
export default function AboutScreen() {
  const { data, isLoading, error, refetch } = useAboutContent();
  useAdvisorScreen({ type: 'screen', id: 'about', title: t('about.title') });

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FadeInView offset={12} style={styles.hero}>
        {/* Server-driven logo (the owner edits it from the dashboard), floating in its golden halo;
            the bundled official logo is only the fallback while no URL is configured. */}
        <Floating>
          <View style={styles.logoHalo}>
            <Image
              source={data.logoUrl ? { uri: data.logoUrl } : require('../../assets/images/club-logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel={t('common.clubName')}
            />
          </View>
        </Floating>
        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.intro}>{data.intro}</Text>
      </FadeInView>

      {/* M81 extension: the owner's about banner — shows only when he fills the slot. */}
      <SlotBanner slot="about.banner" />

      {data.sections.map((section, index) => (
        <FadeInView key={section.key} delay={entranceDelay(index + 1, 80)}>
          <Section section={section} />
        </FadeInView>
      ))}

      <SectionHeader title={data.ecosystem.title} subtitle={data.ecosystem.intro} />
      <GlassCard style={styles.card}>
        {data.ecosystem.companies.map((company, index) => (
          <PressScale key={company.url} onPress={() => void openLink(company.url)} accessibilityRole="link" accessibilityLabel={company.name} style={[styles.row, index > 0 && styles.rowBorder]}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{company.name}</Text>
              <Text style={styles.rowHint}>{company.role}</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.gold} />
          </PressScale>
        ))}
      </GlassCard>

      <SectionHeader title={data.contact.title} />
      <GlassCard style={styles.card}>
        <ContactRow icon="logo-whatsapp" label={t('about.management')} value={data.contact.management} onPress={() => void openWhatsApp(data.contact.management, t('about.managementGreeting'))} />
        <ContactRow icon="mic-outline" label={t('about.studio')} value={data.contact.studio} onPress={() => void openWhatsApp(data.contact.studio, t('about.studioGreeting'))} border />
        <ContactRow icon="mail-outline" label={t('about.email')} value={data.contact.email} onPress={() => void Linking.openURL(`mailto:${data.contact.email}`)} border />
        {data.contact.websites.map((site) => (
          <ContactRow key={site.url} icon="globe-outline" label={site.label} value={site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} onPress={() => void openLink(site.url)} border />
        ))}
      </GlassCard>

      <View style={styles.legal}>
        <Text style={styles.legalText}>{data.legal.operator}</Text>
        <Text style={styles.legalText}>{t('about.legal', { cr: data.legal.cr, vat: data.legal.vat })}</Text>
        <Text style={styles.legalText}>{data.legal.address}</Text>
        <Text style={styles.legalText}>{data.legal.trademark}</Text>
      </View>
    </Screen>
  );
}

function Section({ section }: { section: AboutSection }) {
  return (
    <GlassCard style={styles.section}>
      <View style={styles.sectionHeader}>
        {section.logoUrl ? (
          <View style={styles.sectionLogoBox}>
            <Image source={{ uri: section.logoUrl }} style={styles.sectionLogo} resizeMode="contain" accessibilityLabel={section.title} />
          </View>
        ) : null}
        <Text style={styles.sectionTitle}>{section.title}</Text>
      </View>
      {section.paragraphs.map((paragraph, index) => (
        <Text key={index} style={styles.paragraph}>
          {paragraph}
        </Text>
      ))}
      {section.bullets.map((bullet) => (
        <View key={bullet} style={styles.bullet}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.gold} />
          <Text style={styles.bulletText}>{bullet}</Text>
        </View>
      ))}
      {section.url && section.urlLabel ? <AppButton label={section.urlLabel} variant="outline" icon="open-outline" onPress={() => void openLink(section.url ?? '')} /> : null}
    </GlassCard>
  );
}

function ContactRow({ icon, label, value, onPress, border = false }: { icon: IoniconName; label: string; value: string; onPress: () => void; border?: boolean }) {
  return (
    <PressScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.row, border && styles.rowBorder]}>
      <Ionicons name={icon} size={20} color={colors.gold} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={[styles.rowHint, styles.latin]}>{value}</Text>
      </View>
      <Ionicons name={chevronForward()} size={16} color={colors.textMuted} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs },
  // A quiet golden disc lifts the mark off the black — the screen's one hero glow.
  logoHalo: {
    width: 128,
    height: 128,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
    backgroundColor: colors.goldFaint,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    boxShadow: shadows.glowGold,
  },
  logo: { width: 96, height: 96 },
  title: { ...typography.title, color: colors.gold, textAlign: 'center' },
  intro: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  section: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionLogoBox: { width: 44, height: 44, padding: 4, borderRadius: radii.md, backgroundColor: colors.white },
  sectionLogo: { width: '100%', height: '100%' },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart, flex: 1 },
  paragraph: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletText: { ...typography.body, color: colors.textSecondary, textAlign: textStart, flex: 1 },
  card: { paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.body, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: textStart },
  rowHint: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  latin: { writingDirection: 'ltr' },
  legal: { gap: 2, marginTop: spacing.sm },
  legalText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

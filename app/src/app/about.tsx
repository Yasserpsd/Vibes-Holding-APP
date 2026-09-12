import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAboutContent, type AboutSection } from '@/api/content';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import type { IoniconName } from '@/lib/icons';
import { openLink } from '@/lib/openLink';
import { openWhatsApp } from '@/lib/whatsapp';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** «عنّا»: the club, its operator, فايبز القابضة and the ecosystem. All copy comes from the server. */
export default function AboutScreen() {
  const { data, isLoading, error, refetch } = useAboutContent();

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Image source={{ uri: data.logoUrl }} style={styles.logo} resizeMode="contain" accessibilityLabel="نادي المستثمرين" />
        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.intro}>{data.intro}</Text>
      </View>

      {data.sections.map((section) => (
        <Section key={section.key} section={section} />
      ))}

      <SectionHeader title={data.ecosystem.title} subtitle={data.ecosystem.intro} />
      <View style={styles.card}>
        {data.ecosystem.companies.map((company, index) => (
          <Pressable key={company.url} onPress={() => void openLink(company.url)} accessibilityRole="link" style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.pressed]}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{company.name}</Text>
              <Text style={styles.rowHint}>{company.role}</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.gold} />
          </Pressable>
        ))}
      </View>

      <SectionHeader title={data.contact.title} />
      <View style={styles.card}>
        <ContactRow icon="logo-whatsapp" label="إدارة النادي" value={data.contact.management} onPress={() => void openWhatsApp(data.contact.management, 'السلام عليكم، أتواصل معكم من تطبيق نادي المستثمرين.')} />
        <ContactRow icon="mic-outline" label="استديو بودكاست الملتقى" value={data.contact.studio} onPress={() => void openWhatsApp(data.contact.studio, 'السلام عليكم، أرغب في الاستفسار عن حجز الاستديو.')} border />
        <ContactRow icon="mail-outline" label="البريد الإلكتروني" value={data.contact.email} onPress={() => void Linking.openURL(`mailto:${data.contact.email}`)} border />
        {data.contact.websites.map((site) => (
          <ContactRow key={site.url} icon="globe-outline" label={site.label} value={site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} onPress={() => void openLink(site.url)} border />
        ))}
      </View>

      <View style={styles.legal}>
        <Text style={styles.legalText}>{data.legal.operator}</Text>
        <Text style={styles.legalText}>{`سجل تجاري ${data.legal.cr} · الرقم الضريبي ${data.legal.vat}`}</Text>
        <Text style={styles.legalText}>{data.legal.address}</Text>
        <Text style={styles.legalText}>{data.legal.trademark}</Text>
      </View>
    </Screen>
  );
}

function Section({ section }: { section: AboutSection }) {
  return (
    <View style={styles.section}>
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
    </View>
  );
}

function ContactRow({ icon, label, value, onPress, border = false }: { icon: IoniconName; label: string; value: string; onPress: () => void; border?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, border && styles.rowBorder, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.gold} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={[styles.rowHint, styles.latin]}>{value}</Text>
      </View>
      <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs },
  logo: { width: 96, height: 96, marginBottom: spacing.xs },
  title: { ...typography.title, color: colors.gold, textAlign: 'center' },
  intro: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  section: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionLogoBox: { width: 44, height: 44, padding: 4, borderRadius: radii.md, backgroundColor: colors.white },
  sectionLogo: { width: '100%', height: '100%' },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: 'right', flex: 1 },
  paragraph: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletText: { ...typography.body, color: colors.textSecondary, textAlign: 'right', flex: 1 },
  card: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.body, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: 'right' },
  rowHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  latin: { writingDirection: 'ltr' },
  pressed: { opacity: 0.75 },
  legal: { gap: 2, marginTop: spacing.sm },
  legalText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});

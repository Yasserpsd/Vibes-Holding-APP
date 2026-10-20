import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { usePerson } from '@/api/people';
import { useAuth } from '@/auth/AuthProvider';
import { LockedNotice } from '@/components/LockedNotice';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { PersonAvatar } from '@/components/PeopleBlock';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

/** M11: one club figure's public page — photo, bio, journey milestones and links. */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useAuth();
  const person = usePerson(typeof id === 'string' ? id : undefined);
  const data = person.data?.person;
  // M109g: the full spotlight is a membership feature — the refusal shows the velvet rope, not an error.
  const memberGate = person.error instanceof ApiError && person.error.code === 'members_only' ? person.error.message : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.person') }} />
      {!data ? (
        memberGate ? (
          <LockedNotice text={memberGate} guest={status !== 'signedIn'} />
        ) : (
          <StateView loading={person.isLoading} error={person.error} onRetry={() => void person.refetch()} />
        )
      ) : (
        <>
          <FadeInView style={styles.head} offset={12}>
            <View style={styles.avatarRing}>
              <PersonAvatar person={data} size={104} />
            </View>
            <Text style={styles.name}>{data.name}</Text>
            {data.title || data.company ? <Text style={styles.title}>{[data.title, data.company].filter(Boolean).join(' · ')}</Text> : null}
            {/* M73: the spotlight facts under the name — field/experience and the city. */}
            {data.specialty || data.city ? (
              <View style={styles.facts}>
                {data.specialty ? <Fact icon="briefcase-outline" text={data.specialty} /> : null}
                {data.city ? <Fact icon="location-outline" text={data.city} /> : null}
              </View>
            ) : null}
          </FadeInView>

          <FadeInView delay={120}>
            <Text style={styles.bio}>{data.bio}</Text>
          </FadeInView>

          {data.milestones.length > 0 ? (
            <FadeInView delay={180}>
              <GlassCard style={styles.card}>
                <Text style={styles.sectionTitle}>{t('people.milestonesTitle')}</Text>
                {data.milestones.map((milestone, index) => (
                  <FadeInView key={`${index}-${milestone}`} delay={220 + entranceDelay(index, 60)} style={styles.milestone}>
                    <View style={styles.rail}>
                      <View style={[styles.dot, index === 0 && styles.dotActive]} />
                      {index < data.milestones.length - 1 ? <View style={styles.railLine} /> : null}
                    </View>
                    <Text style={styles.milestoneText}>{milestone}</Text>
                  </FadeInView>
                ))}
              </GlassCard>
            </FadeInView>
          ) : null}

          {/* M73: the spotlight sections, in the owner's order. */}
          <Points title={t('people.achievements')} icon="trophy-outline" items={data.achievements ?? []} delay={220} />
          <Points title={t('people.benefit')} icon="hand-left-outline" items={data.benefit ?? []} delay={240} />
          {data.seeking ? (
            <FadeInView delay={250}>
              <GlassCard style={styles.card}>
                <Text style={styles.sectionTitle}>{t('people.seeking')}</Text>
                <Text style={styles.sectionBody}>{data.seeking}</Text>
              </GlassCard>
            </FadeInView>
          ) : null}

          {data.phone || data.email || data.links.length > 0 ? (
            <FadeInView delay={260}>
              <GlassCard style={styles.card}>
                <Text style={styles.sectionTitle}>{t('people.contact')}</Text>
                {data.phone ? (
                  <PressScale style={styles.link} onPress={() => void openLink(`https://wa.me/${(data.phone ?? '').replace(/\D/g, '')}`)} accessibilityRole="link">
                    <Ionicons name="logo-whatsapp" size={18} color={colors.gold} />
                    <Text style={styles.linkText} numberOfLines={1}>{`${t('people.contactWhatsapp')} — ${'‎'}${data.phone}`}</Text>
                  </PressScale>
                ) : null}
                {data.email ? (
                  <PressScale style={styles.link} onPress={() => void openLink(`mailto:${data.email}`)} accessibilityRole="link">
                    <Ionicons name="mail-outline" size={18} color={colors.gold} />
                    <Text style={styles.linkText} numberOfLines={1}>{data.email}</Text>
                  </PressScale>
                ) : null}
                {data.links.map((link) => (
                  <PressScale key={link.url} style={styles.link} onPress={() => void openLink(link.url)} accessibilityRole="link">
                    <Ionicons name="link-outline" size={18} color={colors.gold} />
                    <Text style={styles.linkText} numberOfLines={1}>
                      {link.label || link.url}
                    </Text>
                  </PressScale>
                ))}
              </GlassCard>
            </FadeInView>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Fact({ icon, text }: { icon: 'briefcase-outline' | 'location-outline'; text: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={14} color={colors.goldDark} />
      <Text style={styles.factText} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

/** A spotlight list section (achievements, member benefit); renders nothing while empty. */
function Points({ title, icon, items, delay }: { title: string; icon: 'trophy-outline' | 'hand-left-outline'; items: string[]; delay: number }) {
  if (items.length === 0) return null;
  return (
    <FadeInView delay={delay}>
      <GlassCard style={styles.card}>
        <View style={styles.sectionHead}>
          <Ionicons name={icon} size={18} color={colors.gold} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {items.map((item) => (
          <View key={item} style={styles.point}>
            <View style={styles.bullet} />
            <Text style={styles.pointText}>{item}</Text>
          </View>
        ))}
      </GlassCard>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: spacing.sm },
  avatarRing: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    padding: 3,
    boxShadow: shadows.glowGold,
  },
  name: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  title: { ...typography.body, color: colors.gold, textAlign: 'center' },
  bio: { ...typography.body, color: colors.textSecondary, textAlign: textStart, lineHeight: 26 },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  // The journey reads as one golden thread: a lit rail connects the milestone dots.
  milestone: { flexDirection: 'row', gap: spacing.sm },
  rail: { width: 12, alignItems: 'center' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    marginTop: 7,
  },
  dotActive: { backgroundColor: colors.gold, borderColor: colors.goldLight, boxShadow: shadows.glowGoldFaint },
  railLine: { flex: 1, width: 2, borderRadius: 1, backgroundColor: colors.borderGoldSoft, marginTop: 2, marginBottom: -spacing.sm },
  milestoneText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  linkText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  // M73: the facts row under the name and the spotlight list sections.
  facts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xs },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '90%' },
  factText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionBody: { ...typography.body, color: colors.textSecondary, textAlign: textStart, lineHeight: 24 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold, marginTop: 9 },
  pointText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart, lineHeight: 24 },
});

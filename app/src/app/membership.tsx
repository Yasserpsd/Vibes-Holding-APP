import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useMembershipContent, type MembershipGroup, type MembershipItem, type NeutralReason } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { ClampText } from '@/components/ClampText';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { PaperCard } from '@/components/paper';
import { Screen } from '@/components/Screen';
import { SlotBanner } from '@/components/SlotBanner';
import { StateView } from '@/components/StateView';
import { StorePurchaseCard } from '@/components/StorePurchaseCard';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { openWhatsApp } from '@/lib/whatsapp';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** Membership benefits as the owner wrote them (server content), grouped; lines can open a screen or WhatsApp. */
export default function MembershipScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useMembershipContent();
  useAdvisorScreen({ type: 'screen', id: 'membership', title: data?.title ?? t('nav.membership') });

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const open = (item: MembershipItem) => {
    if (!item.link) return;
    if (item.link.type === 'route') {
      router.push(item.link.path as Href);
      return;
    }
    const sender = me ? `\n${t('request.senderName', { name: me.name })}${me.phone ? ` · ${t('request.senderPhone', { phone: me.phone })}` : ''}` : '';
    void openWhatsApp(item.link.phone, `${item.link.message}${sender}\n${t('request.fromApp')}`);
  };

  return (
    <Screen title={data.title} subtitle={data.subtitle} watermark>
      {/* M81 extension: the owner's membership banner — shows only when he fills the slot. */}
      <SlotBanner slot="membership.banner" />
      <FadeInView delay={entranceDelay(0)}>
        <PaperCard>
          <ClampText text={data.intro} />
        </PaperCard>
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <MembershipStatusCard
          membership={status === 'signedIn' ? (me?.membership ?? null) : null}
          texts={data.statusTexts}
          activationNote={data.activationNote}
          title={data.title}
        />
      </FadeInView>
      {status === 'signedIn' ? (
        <FadeInView delay={entranceDelay(2)}>
          <StorePurchaseCard title={data.title} />
        </FadeInView>
      ) : null}
      {status === 'guest' ? (
        <FadeInView delay={entranceDelay(2)} style={styles.guestActions}>
          {/* M78 (owner): «اختيار مباشر انه يدخل يسجل ويدفع» — registration flows straight back here, where the payment lives. */}
          <AppButton label={t('membership.registerAndPay')} icon="person-add-outline" onPress={() => router.push('/auth/register')} />
          <AppButton label={t('auth.login.title')} variant="outline" icon="log-in-outline" onPress={() => router.push('/auth/login')} />
        </FadeInView>
      ) : null}

      {/* M99d (owner): the neutral reads HIS page — the 10 reasons; every other persona keeps the groups. */}
      {status === 'signedIn' && me?.persona === 'neutral' && data.neutralReasons ? (
        <>
          <FadeInView delay={entranceDelay(3)}>
            <PaperCard style={styles.reasonsHead}>
              <Text style={styles.reasonsTitle}>{data.neutralReasons.title}</Text>
              <ClampText text={data.neutralReasons.intro} />
            </PaperCard>
          </FadeInView>
          {data.neutralReasons.items.map((reason, index) => (
            <FadeInView key={reason.title} delay={entranceDelay(index + 4)}>
              <ReasonCard index={index + 1} reason={reason} />
            </FadeInView>
          ))}
        </>
      ) : (
        data.groups.map((group, index) => (
          <FadeInView key={group.key} delay={entranceDelay(index + 3)}>
            <GroupCard group={group} onOpen={open} />
          </FadeInView>
        ))
      )}
    </Screen>
  );
}

/** Icons pass: the membership's weight in numbers — its benefit lines, the services, the bank's projects. */
/** M99d: one of the neutral's ten reasons — a numbered golden badge, the title, its gold pills, the text. */
function ReasonCard({ index, reason }: { index: number; reason: NeutralReason }) {
  return (
    <PaperCard style={styles.reason}>
      <View style={styles.reasonHeader}>
        <View style={styles.reasonNumber}>
          <Text style={styles.reasonNumberText}>{index}</Text>
        </View>
        <Text style={styles.reasonTitle}>{reason.title}</Text>
      </View>
      {reason.badges?.length ? (
        <View style={styles.reasonBadges}>
          {reason.badges.map((badge) => (
            <View key={badge} style={styles.reasonBadge}>
              <Text style={styles.reasonBadgeText} numberOfLines={1}>
                {badge}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <ClampText text={reason.text} style={styles.reasonText} />
    </PaperCard>
  );
}

function GroupCard({ group, onOpen }: { group: MembershipGroup; onOpen: (item: MembershipItem) => void }) {
  return (
    <PaperCard style={styles.group}>
      <View style={styles.groupHeader}>
        <View style={styles.iconBox}>
          <Ionicons name={iconFor(group.icon, 'checkmark-circle-outline')} size={22} color={colors.paperGold} />
        </View>
        <Text style={styles.groupTitle}>{group.title}</Text>
        {group.comingSoon ? (
          <View style={styles.soon}>
            <Text style={styles.soonText} numberOfLines={1}>{t('membership.soon')}</Text>
          </View>
        ) : null}
      </View>
      {group.items.map((item, index) => (
        <PressScale
          key={item.text}
          onPress={item.link ? () => onOpen(item) : undefined}
          disabled={!item.link}
          accessibilityRole={item.link ? 'button' : 'none'}
          style={[styles.item, index > 0 && styles.itemBorder]}
        >
          <Ionicons name={group.comingSoon ? 'time-outline' : 'checkmark-circle'} size={18} color={group.comingSoon ? colors.paperMuted : colors.paperGold} />
          <Text style={[styles.itemText, group.comingSoon && styles.itemSoon]}>{item.text}</Text>
          {item.link ? <Ionicons name={item.link.type === 'whatsapp' ? 'logo-whatsapp' : chevronForward()} size={16} color={colors.paperGold} /> : null}
        </PressScale>
      ))}
    </PaperCard>
  );
}

const styles = themedStyles(() => ({
  guestActions: { gap: spacing.sm },
  group: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 0,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.paperBorder,
  },
  groupTitle: { ...typography.subtitle, color: colors.paperGold, textAlign: textStart, flex: 1 },
  soon: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.paperBorder, backgroundColor: colors.paper },
  soonText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.paperGold },
  // M99d: the neutral's 10-reason page.
  reasonsHead: { gap: spacing.xs },
  reasonsTitle: { ...typography.subtitle, color: colors.paperGold, textAlign: textStart },
  reason: { gap: spacing.sm, padding: spacing.md },
  reasonHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reasonNumber: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  reasonNumberText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.goldInk },
  reasonTitle: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 24, color: colors.paperInk, textAlign: textStart, flex: 1 },
  reasonBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  reasonBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.paperBorder,
    backgroundColor: colors.paper,
  },
  reasonBadgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.paperGold },
  reasonText: { fontSize: 14, lineHeight: 24 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.paperBorder },
  itemText: { ...typography.body, color: colors.paperInk, textAlign: textStart, flex: 1 },
  itemSoon: { color: colors.paperInkSoft },
}));

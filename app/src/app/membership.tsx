import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useMembershipContent, type MembershipGroup, type MembershipItem } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { StorePurchaseCard } from '@/components/StorePurchaseCard';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { openWhatsApp } from '@/lib/whatsapp';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

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
      <FadeInView delay={entranceDelay(0)}>
        <Text style={styles.intro}>{data.intro}</Text>
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

      {data.groups.map((group, index) => (
        <FadeInView key={group.key} delay={entranceDelay(index + 3)}>
          <GroupCard group={group} onOpen={open} />
        </FadeInView>
      ))}
    </Screen>
  );
}

function GroupCard({ group, onOpen }: { group: MembershipGroup; onOpen: (item: MembershipItem) => void }) {
  return (
    <GlassCard style={styles.group}>
      <View style={styles.groupHeader}>
        <View style={styles.iconBox}>
          <Ionicons name={iconFor(group.icon, 'checkmark-circle-outline')} size={22} color={colors.gold} />
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
          <Ionicons name={group.comingSoon ? 'time-outline' : 'checkmark-circle'} size={18} color={group.comingSoon ? colors.textMuted : colors.gold} />
          <Text style={[styles.itemText, group.comingSoon && styles.itemSoon]}>{item.text}</Text>
          {item.link ? <Ionicons name={item.link.type === 'whatsapp' ? 'logo-whatsapp' : chevronForward()} size={16} color={colors.goldLight} /> : null}
        </PressScale>
      ))}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  guestActions: { gap: spacing.sm },
  intro: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  group: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    boxShadow: shadows.glowGoldFaint,
  },
  groupTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart, flex: 1 },
  soon: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.goldFaint },
  soonText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemText: { ...typography.body, color: colors.textPrimary, textAlign: textStart, flex: 1 },
  itemSoon: { color: colors.textSecondary },
});

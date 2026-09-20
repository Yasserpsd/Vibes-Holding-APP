import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMembershipContent, type MembershipGroup, type MembershipItem } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { StorePurchaseCard } from '@/components/StorePurchaseCard';
import { iconFor } from '@/lib/icons';
import { openWhatsApp } from '@/lib/whatsapp';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** Membership benefits as the owner wrote them (server content), grouped; lines can open a screen or WhatsApp. */
export default function MembershipScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useMembershipContent();
  useAdvisorScreen({ type: 'screen', id: 'membership', title: data?.title ?? 'العضوية' });

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
    const sender = me ? `\nالاسم: ${me.name}${me.phone ? ` · الجوال: ${me.phone}` : ''}` : '';
    void openWhatsApp(item.link.phone, `${item.link.message}${sender}\n(طلب من تطبيق نادي المستثمرين)`);
  };

  return (
    <Screen title={data.title} subtitle={data.subtitle}>
      <Text style={styles.intro}>{data.intro}</Text>
      <MembershipStatusCard
        membership={status === 'signedIn' ? (me?.membership ?? null) : null}
        texts={data.statusTexts}
        activationNote={data.activationNote}
        title={data.title}
      />
      {status === 'signedIn' ? <StorePurchaseCard title={data.title} /> : null}
      {status === 'guest' ? <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/auth/login')} /> : null}

      {data.groups.map((group) => (
        <GroupCard key={group.key} group={group} onOpen={open} />
      ))}
    </Screen>
  );
}

function GroupCard({ group, onOpen }: { group: MembershipGroup; onOpen: (item: MembershipItem) => void }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <View style={styles.iconBox}>
          <Ionicons name={iconFor(group.icon, 'checkmark-circle-outline')} size={22} color={colors.gold} />
        </View>
        <Text style={styles.groupTitle}>{group.title}</Text>
        {group.comingSoon ? (
          <View style={styles.soon}>
            <Text style={styles.soonText}>قريبًا</Text>
          </View>
        ) : null}
      </View>
      {group.items.map((item, index) => (
        <Pressable
          key={item.text}
          onPress={item.link ? () => onOpen(item) : undefined}
          disabled={!item.link}
          accessibilityRole={item.link ? 'button' : undefined}
          style={({ pressed }) => [styles.item, index > 0 && styles.itemBorder, pressed && item.link ? styles.pressed : null]}
        >
          <Ionicons name={group.comingSoon ? 'time-outline' : 'checkmark-circle'} size={18} color={group.comingSoon ? colors.textMuted : colors.gold} />
          <Text style={[styles.itemText, group.comingSoon && styles.itemSoon]}>{item.text}</Text>
          {item.link ? <Ionicons name={item.link.type === 'whatsapp' ? 'logo-whatsapp' : 'chevron-back'} size={16} color={colors.goldLight} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { ...typography.body, color: colors.textSecondary, textAlign: 'right' },
  group: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
  groupTitle: { ...typography.subtitle, color: colors.gold, textAlign: 'right', flex: 1 },
  soon: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.goldDark },
  soonText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemText: { ...typography.body, color: colors.textPrimary, textAlign: 'right', flex: 1 },
  itemSoon: { color: colors.textSecondary },
  pressed: { opacity: 0.7 },
});

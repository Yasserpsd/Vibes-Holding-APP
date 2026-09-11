import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authApi, useAuthConfig, useMembershipContent, type Me } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { hasSecureStorage } from '@/auth/storage';
import { AppButton } from '@/components/AppButton';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { Notice } from '@/components/Notice';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { Screen } from '@/components/Screen';
import { env } from '@/config/env';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export default function AccountScreen() {
  const router = useRouter();
  const { status, me, signOut, refresh } = useAuth();
  const { data: config } = useAuthConfig();
  const { data: content } = useMembershipContent();
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.gold} size="large" />
      </SafeAreaView>
    );
  }

  if (status === 'guest') {
    return (
      <PlaceholderScreen
        title="حسابي"
        description="سجّل الدخول للوصول إلى عضويتك وملفك الشخصي. يمكنك تصفّح بنك المشاريع والمشاريع الذهبية بدون تسجيل."
      >
        <View style={styles.actions}>
          <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/auth/login')} />
          {config?.registrationOpen === false ? null : (
            <AppButton label="إنشاء حساب" variant="outline" icon="person-add-outline" onPress={() => router.push('/auth/register')} />
          )}
          <AppButton label="مزايا العضوية" variant="outline" icon="ribbon-outline" onPress={() => router.push('/membership')} />
        </View>
      </PlaceholderScreen>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const confirmDelete = async (password: string) => {
    if (!password) {
      setDeleteError('اكتب كلمة المرور للتأكيد');
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await authApi.deleteMe(password);
      setDeleting(false);
      await signOut();
    } catch (cause) {
      setDeleteError(errorMessage(cause));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} />}>
      {me ? <ProfileHeader me={me} /> : <Notice tone="warning" text="تعذّر تحميل بياناتك الآن. اسحب للأسفل لإعادة المحاولة." />}
      <MembershipStatusCard membership={me?.membership ?? null} texts={content?.statusTexts} activationNote={content?.activationNote} />
      {!hasSecureStorage() ? <Notice tone="warning" text="هذه النسخة لا تحفظ الجلسة بعد إغلاق التطبيق؛ النسخة القادمة تحفظها." /> : null}

      <View style={styles.menu}>
        <MenuRow icon="ribbon-outline" label="العضوية ومزاياها" onPress={() => router.push('/membership')} />
        <MenuRow icon="create-outline" label="تعديل الملف الشخصي" onPress={() => router.push('/profile-edit')} />
        <MenuRow icon="log-out-outline" label="تسجيل الخروج" onPress={() => void signOut()} />
        <MenuRow icon="trash-outline" label="حذف الحساب" danger onPress={() => setDeleting(true)} />
      </View>

      <PasswordPrompt
        visible={deleting}
        title="حذف الحساب"
        message="سيُحذف حسابك وبياناتك الشخصية ومحادثاتك نهائيًا من النادي والتطبيق. أدخل كلمة المرور للتأكيد."
        confirmLabel="حذف الحساب نهائيًا"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={(password) => void confirmDelete(password)}
        onCancel={() => {
          setDeleting(false);
          setDeleteError(null);
        }}
      />

      <Text style={styles.footer}>{env.isProduction ? `الإصدار ${env.appVersion}` : `نسخة تجريبية · الإصدار ${env.appVersion}`}</Text>
    </Screen>
  );
}

function ProfileHeader({ me }: { me: Me }) {
  const initial = me.name.trim().charAt(0) || '؟';
  return (
    <View style={styles.header}>
      {me.avatarUrl ? (
        <Image source={{ uri: me.avatarUrl }} style={styles.avatar} accessibilityLabel={me.name} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}
      <View style={styles.headerText}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{me.name}</Text>
          {me.isAdmin ? (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>إدارة</Text>
            </View>
          ) : null}
        </View>
        {me.personaLabel ? <Text style={styles.meta}>{me.personaLabel}</Text> : null}
        {me.jobTitle ? <Text style={styles.meta}>{me.jobTitle}</Text> : null}
        <Text style={styles.contact}>{me.email}</Text>
        <Text style={styles.contact}>{me.phone}</Text>
      </View>
    </View>
  );
}

type MenuRowProps = { icon: IoniconName; label: string; onPress: () => void; danger?: boolean };

function MenuRow({ icon, label, onPress, danger = false }: MenuRowProps) {
  const color = danger ? colors.danger : colors.gold;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
  actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.goldDark },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
  avatarInitial: { ...typography.title, color: colors.gold },
  headerText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.subtitle, color: colors.textPrimary, textAlign: 'right' },
  adminBadge: { paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.gold },
  adminBadgeText: { ...typography.caption, color: colors.goldLight, fontSize: 11 },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  contact: { ...typography.caption, color: colors.textMuted, textAlign: 'right', writingDirection: 'ltr' },
  menu: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  rowLabel: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: 'right' },
  footer: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

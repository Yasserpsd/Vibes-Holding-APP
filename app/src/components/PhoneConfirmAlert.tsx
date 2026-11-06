import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn } from '@/components/motion';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M203 (owner, 2026-11-06): any account whose number is not confirmed sees this, open session or not, on every launch
 * until it is confirmed. «لاحقًا» closes it for this launch only: a hard wall would lock out a member with no WhatsApp,
 * and the sign-in code asks again anyway. The server decides through `phoneConfirmDue` (switch on, reviewers excluded).
 */
export function PhoneConfirmAlert() {
  const { status, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [later, setLater] = useState(false);
  const blocked = pathname.startsWith('/auth') || pathname.startsWith('/profile-edit') || pathname.startsWith('/phone-confirm');
  if (status !== 'signedIn' || !me?.phoneConfirmDue || later || blocked || (me.profileMissing ?? []).length > 0) return null;

  const confirm = () => {
    setLater(true);
    router.push('/phone-confirm' as Href);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setLater(true)}>
      <View style={styles.backdrop}>
        <PopIn style={styles.wrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <View style={styles.ring}>
              <Ionicons name="shield-checkmark-outline" size={32} color={colors.gold} />
            </View>
            <Text style={styles.title}>{t('phoneAlert.title')}</Text>
            <Text style={styles.text}>{t('phoneAlert.text')}</Text>
            <AppButton label={t('phoneAlert.cta')} icon="logo-whatsapp" onPress={confirm} />
            <AppButton label={t('phoneAlert.later')} variant="outline" onPress={() => setLater(true)} />
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.6)' },
  wrap: { width: '100%', maxWidth: 380 },
  card: { padding: spacing.lg, gap: spacing.sm, alignItems: 'stretch' },
  ring: { alignSelf: 'center' },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: 'center' },
  text: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
}));

import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorMessage } from '@/api/client';
import { sendGoldenInterest, useGoldenOffer } from '@/api/queries';
import type { OfferBlock } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * A golden company's offer page, native in-app (PROJECT_BRIEF §5.1): the blocks the server pulled
 * from the company's web /offer/ page, with the call to action kept inside the app («سجّل اهتمامك»
 * mails the management; the floating advisor button is there as on every screen).
 */
export default function GoldenOfferScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const query = useGoldenOffer(code);
  const offer = query.data;
  // The advisor reads this as the golden screen, titled by the company, so its golden starters fit here too.
  useAdvisorScreen({ type: 'screen', id: 'golden', title: offer?.company.name ?? t('nav.goldenOffer') });
  const clearance = useAskAdvisorClearance();
  const [asking, setAsking] = useState(false);

  if (!offer) {
    return (
      <View style={styles.screen}>
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: offer.company.name }} />
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
        <FadeInView style={styles.hero} offset={12}>
          <View style={styles.logoBox}>
            <Image source={{ uri: offer.company.logoUrl }} style={styles.logo} resizeMode="contain" accessibilityLabel={offer.company.name} />
          </View>
          <View style={styles.heroTexts}>
            <Text style={styles.heroName}>{offer.company.name}</Text>
            {offer.company.tagline ? <Text style={styles.heroTagline}>{offer.company.tagline}</Text> : null}
          </View>
        </FadeInView>

        {offer.blocks.length === 0 ? (
          <View style={styles.pendingBox}>
            <Text style={styles.pendingText}>{t('offer.pending')}</Text>
          </View>
        ) : (
          offer.blocks.map((block, index) => (
            <FadeInView key={index} delay={entranceDelay(Math.min(index, 8), 40)}>
              <Block block={block} />
            </FadeInView>
          ))
        )}

        <AppButton label={t('offer.interestCta')} icon="hand-right-outline" onPress={() => setAsking(true)} />
        <Text style={styles.disclaimer}>{offer.disclaimer}</Text>
      </ScrollView>
      <InterestSheet visible={asking} code={offer.company.code} companyName={offer.company.name} onClose={() => setAsking(false)} />
    </View>
  );
}

function Block({ block }: { block: OfferBlock }) {
  switch (block.type) {
    case 'heading':
      return <Text style={[styles.heading, block.level === 1 && styles.heading1, block.level === 3 && styles.heading3]}>{block.text}</Text>;
    case 'bullet':
      return (
        <View style={styles.bulletRow}>
          <View style={styles.bulletDot} />
          <Text style={styles.bulletText}>{block.text}</Text>
        </View>
      );
    case 'image':
      return <Image source={{ uri: block.url }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors />;
    case 'text':
    default:
      return <Text style={styles.paragraph}>{block.text}</Text>;
  }
}

type SheetProps = { visible: boolean; code: string; companyName: string; onClose: () => void };

/** The offer's call to action: the request goes to the management by mail, the member never leaves the app. */
function InterestSheet({ visible, code, companyName, onClose }: SheetProps) {
  const insets = useSafeAreaInsets();
  const { status, me } = useAuth();
  const signedIn = status === 'signedIn' && me !== null;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setSent(false);
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    if (!signedIn && !phone.trim()) {
      setError(t('offer.phoneRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendGoldenInterest(code, { name: name.trim(), phone: phone.trim(), note: note.trim() });
      setSent(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t('common.close')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          {sent ? (
            <>
              <Text style={styles.sheetTitle}>{t('offer.sentTitle')}</Text>
              <Text style={styles.sheetText}>{t('offer.sentText')}</Text>
              <AppButton label={t('common.close')} icon="checkmark-outline" onPress={close} />
            </>
          ) : (
            <>
              <Text style={styles.sheetTitle}>{t('offer.interestTitle', { company: companyName })}</Text>
              <Text style={styles.sheetText}>{signedIn ? t('offer.interestTextMember') : t('offer.interestTextGuest')}</Text>
              {!signedIn ? (
                <>
                  <FormField label={t('offer.name')} value={name} onChangeText={setName} autoComplete="name" />
                  <FormField label={t('offer.phone')} value={phone} onChangeText={setPhone} latin keyboardType="phone-pad" autoComplete="tel" />
                </>
              ) : null}
              <FormField label={t('offer.note')} value={note} onChangeText={setNote} multiline />
              {error ? <Notice tone="warning" text={error} /> : null}
              {busy ? <ActivityIndicator color={colors.gold} /> : <AppButton label={t('offer.send')} icon="paper-plane-outline" onPress={() => void submit()} />}
              <AppButton label={t('common.cancel')} variant="outline" onPress={close} />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  logoBox: { width: 72, height: 72, padding: spacing.xs, borderRadius: radii.md, backgroundColor: colors.white },
  logo: { width: '100%', height: '100%' },
  heroTexts: { flex: 1, gap: 2 },
  heroName: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  heroTagline: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  heading: { fontFamily: fonts.semiBold, fontSize: 20, lineHeight: 30, color: colors.goldLight, textAlign: textStart, marginTop: spacing.sm },
  heading1: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 36, color: colors.gold },
  heading3: { fontSize: 17, lineHeight: 26, color: colors.textPrimary },
  paragraph: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.xs },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold, marginTop: 9 },
  bulletText: { ...typography.body, flex: 1, color: colors.textSecondary, textAlign: textStart },
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  pendingBox: { padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pendingText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  disclaimer: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  sheet: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.xs },
  sheetTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  sheetText: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
});

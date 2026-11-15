import { useSyncExternalStore } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/lux';
import { PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { usePopupHold } from '@/lib/popupGate';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * Emulator review 2026-11-15 (item 18): the language, theme and sign-out questions opened as the system's plain
 * white dialog inside the dark app — system font, the title on the left in Arabic, and no answer to the Android
 * back key. This is the app's own question dialog: the same golden card and motion as its other popups, colours
 * from the tokens (light and dark), centred text and full-width answers (nothing to mirror between Arabic and
 * English), closed by the back key and by a tap outside.
 *
 * `showAppDialog(...)` can be called from anywhere (a plain function, like Alert.alert); `<AppDialogHost />` draws
 * it and is mounted once for the whole launch (beside the admin popup host).
 */
export type AppDialogAction = {
  label: string;
  onPress?: () => void;
  /** `cancel` is the quiet way out — it is also what the Android back key and a tap outside do. */
  style?: 'default' | 'cancel' | 'destructive';
};

export type AppDialogOptions = { title: string; message?: string; actions: AppDialogAction[] };

let current: AppDialogOptions | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showAppDialog(options: AppDialogOptions): void {
  // No host on screen (it should never happen): the question is still asked, through the system dialog.
  if (listeners.size === 0) {
    Alert.alert(
      options.title,
      options.message,
      options.actions.map((action) => ({ text: action.label, onPress: action.onPress, style: action.style })),
    );
    return;
  }
  current = options;
  notify();
}

function closeDialog(dialog: AppDialogOptions): void {
  if (current !== dialog) return;
  current = null;
  notify();
}

/** Mounted once, in a component that lives for the whole launch. */
export function AppDialogHost() {
  const dialog = useSyncExternalStore(subscribe, () => current);
  // While a question is up no automatic popup opens on top of it.
  usePopupHold(dialog !== null);
  if (!dialog) return null;

  const choose = (action: AppDialogAction) => {
    closeDialog(dialog);
    action.onPress?.();
  };
  // The back key and a tap outside take the quiet way out.
  const cancel = () => {
    const quiet = dialog.actions.find((action) => action.style === 'cancel');
    closeDialog(dialog);
    quiet?.onPress?.();
  };

  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <PopIn style={styles.wrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">
              {dialog.title}
            </Text>
            {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
            <View style={styles.actions}>
              {dialog.actions.map((action, index) => (
                <DialogButton key={`${index}-${action.label}`} action={action} onPress={() => choose(action)} />
              ))}
            </View>
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

function DialogButton({ action, onPress }: { action: AppDialogAction; onPress: () => void }) {
  const kind = action.style ?? 'default';
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      style={[styles.button, kind === 'destructive' && styles.buttonDanger, kind === 'cancel' && styles.buttonCancel]}
    >
      <Text style={[styles.buttonText, kind === 'destructive' && styles.buttonTextDanger, kind === 'cancel' && styles.buttonTextCancel]} numberOfLines={2}>
        {action.label}
      </Text>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.overlay },
  wrap: { width: '100%', maxWidth: 380, maxHeight: '86%' },
  card: { padding: spacing.lg, gap: spacing.sm, alignItems: 'stretch', flexShrink: 1 },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: 'center' },
  message: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  // An answer: a lit golden outline, 48 pt tall.
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  buttonText: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 23, color: colors.goldText, textAlign: 'center' },
  // The answer that cannot be taken back (sign out): the danger colour, no fill.
  buttonDanger: { borderColor: colors.danger, backgroundColor: 'transparent' },
  buttonTextDanger: { color: colors.danger },
  // The quiet way out: words only.
  buttonCancel: { borderColor: 'transparent', backgroundColor: 'transparent' },
  buttonTextCancel: { fontFamily: fonts.medium, color: colors.textMuted },
}));

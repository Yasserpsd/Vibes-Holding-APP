import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { t } from '@/i18n';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
};

/** Asks for the account password before a sensitive action (account deletion). */
export function PasswordPrompt({ visible, ...sheet }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={sheet.onCancel}>
      {/* The sheet is mounted only while the modal shows, so every opening starts with an empty field. */}
      <PromptSheet {...sheet} />
    </Modal>
  );
}

function PromptSheet({ title, message, confirmLabel, busy = false, error, onConfirm, onCancel }: Omit<Props, 'visible'>) {
  const [password, setPassword] = useState('');
  const confirm = () => {
    if (!busy) onConfirm(password);
  };
  return (
    // The sheet moves above the keyboard so the confirm button stays reachable while typing.
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <FormField
            label={t('common.password')}
            latin
            secureTextEntry
            autoCapitalize="none"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={confirm}
            value={password}
            onChangeText={setPassword}
            error={error ?? null}
            editable={!busy}
          />
          <View style={styles.actions}>
            <AppButton label={busy ? t('common.working') : confirmLabel} onPress={confirm} style={styles.danger} />
            <AppButton label={t('common.cancel')} variant="outline" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.lg },
  sheet: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: 'right' },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'right' },
  actions: { gap: spacing.sm },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
});

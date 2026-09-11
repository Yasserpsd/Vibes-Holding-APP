import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
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
export function PasswordPrompt({ visible, title, message, confirmLabel, busy = false, error, onConfirm, onCancel }: Props) {
  const [password, setPassword] = useState('');

  // A fresh prompt every time it opens: nothing typed earlier survives a cancel.
  useEffect(() => {
    if (visible) setPassword('');
  }, [visible]);

  const confirm = () => {
    if (!busy) onConfirm(password);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* The sheet moves above the keyboard so the confirm button stays reachable while typing. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
            <FormField
              label="كلمة المرور"
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
              <AppButton label={busy ? 'جارٍ التنفيذ…' : confirmLabel} onPress={confirm} style={styles.danger} />
              <AppButton label="إلغاء" variant="outline" onPress={onCancel} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
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

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import type { IoniconName } from '@/lib/icons';
import { themedStyles } from '@/theme/styles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** M241: a second proof offered under the password (account deletion: the member's Apple / Google account). */
export type PromptAlternative = {
  label: string;
  icon: IoniconName;
  onPress: () => void;
  /** Its own request is in flight: the button spins and the password side waits. */
  loading?: boolean;
  /** Its own failure, shown under the button. */
  error?: string | null;
};

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
  alternative?: PromptAlternative | null;
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

function PromptSheet({ title, message, confirmLabel, busy = false, error, onConfirm, onCancel, alternative }: Omit<Props, 'visible'>) {
  const [password, setPassword] = useState('');
  // One request at a time: while either proof is on its way, the other one waits.
  const waiting = busy || Boolean(alternative?.loading);
  const confirm = () => {
    if (!waiting) onConfirm(password);
  };
  return (
    // The sheet moves above the keyboard so the confirm button stays reachable while typing.
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={styles.backdrop} onPress={waiting ? undefined : onCancel}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <FormField
            label={t('common.password')}
            latin
            secureTextEntry
            autoCapitalize="none"
            // With a second proof on offer the keyboard waits for a tap on the field, so both ways stay in view.
            autoFocus={!alternative}
            returnKeyType="done"
            onSubmitEditing={confirm}
            value={password}
            onChangeText={setPassword}
            error={error ?? null}
            editable={!waiting}
          />
          <View style={styles.actions}>
            <AppButton label={busy ? t('common.working') : confirmLabel} onPress={confirm} style={styles.danger} disabled={Boolean(alternative?.loading)} />
            {alternative ? (
              <>
                <AppButton label={alternative.label} icon={alternative.icon} variant="outline" loading={Boolean(alternative.loading)} disabled={busy} onPress={alternative.onPress} />
                {alternative.error ? <Text style={styles.alternativeError}>{alternative.error}</Text> : null}
              </>
            ) : null}
            <AppButton label={t('common.cancel')} variant="outline" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = themedStyles(() => ({
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
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  message: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  actions: { gap: spacing.sm },
  alternativeError: { ...typography.caption, color: colors.danger, textAlign: textStart },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
}));

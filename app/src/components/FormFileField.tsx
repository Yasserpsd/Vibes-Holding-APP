import Ionicons from '@expo/vector-icons/Ionicons';
import { requireOptionalNativeModule } from 'expo';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { uploadFormFile } from '@/api/forms';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { usePaper } from '@/components/paper';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M193 (owner, 2026-11-03): a form's attachment — the Success Partners pitch deck. The member picks one
 * file, it goes straight to the club's private storage, and the field's answer is its link. The document
 * picker is native (in the store binaries since M151); a binary without it shows a quiet note instead.
 */
const picker = requireOptionalNativeModule('ExpoDocumentPicker')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-document-picker') as typeof import('expo-document-picker'))
  : null;

/** The types the server accepts (server/src/forms/files.ts), by extension for pickers that send no type. */
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
const MAX_BYTES = 25 * 1024 * 1024;

type Props = {
  formKey: string;
  label: string;
  signedIn: boolean;
  value: string;
  onChange: (value: string) => void;
  onBusy: (busy: boolean) => void;
};

export function FormFileField({ formKey, label, signedIn, value, onChange, onBusy }: Props) {
  const paper = usePaper();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async () => {
    if (!picker || busy) return;
    setProblem(null);
    try {
      const result = await picker.getDocumentAsync({ type: [...new Set(Object.values(TYPES))], copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const fileName = (asset.name || 'file').trim().slice(0, 120);
      const extension = (fileName.split('.').pop() ?? '').toLowerCase();
      const mimeType = asset.mimeType && Object.values(TYPES).includes(asset.mimeType) ? asset.mimeType : TYPES[extension];
      if (!mimeType) {
        setProblem(t('form.file.failed'));
        return;
      }
      if ((asset.size ?? 0) > MAX_BYTES) {
        setProblem(t('form.file.tooBig'));
        return;
      }
      setBusy(true);
      onBusy(true);
      const link = await uploadFormFile(formKey, { uri: asset.uri, name: fileName, size: asset.size ?? 1, mimeType });
      setName(fileName);
      onChange(link);
    } catch (cause) {
      setProblem(cause instanceof Error && 'code' in cause && cause.message ? cause.message : t('form.file.failed'));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const labelStyle = [styles.label, paper && styles.paperLabel];
  if (!picker || !signedIn) {
    return (
      <View style={styles.box}>
        <Text style={labelStyle}>{label}</Text>
        <Notice tone="info" text={t(signedIn ? 'form.file.unavailable' : 'form.file.signIn')} />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={labelStyle}>{label}</Text>
      {value ? (
        <View style={[styles.chosen, paper && styles.paperChosen]}>
          <Ionicons name="document-attach-outline" size={22} color={paper ? colors.paperGold : colors.gold} />
          <Text style={[styles.fileName, paper && styles.paperFileName]} numberOfLines={1}>
            {name || t('deck.title')}
          </Text>
        </View>
      ) : null}
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={paper ? colors.paperGold : colors.gold} />
          <Text style={labelStyle}>{t('form.file.uploading')}</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <AppButton label={value ? t('form.file.replace') : t('form.file.pick')} variant="outline" icon="attach" onPress={() => void pick()} />
          {value ? (
            <AppButton
              label={t('form.file.remove')}
              variant="outline"
              icon="trash-outline"
              onPress={() => {
                setName('');
                onChange('');
              }}
            />
          ) : null}
        </View>
      )}
      {problem ? <Notice tone="warning" text={problem} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  paperLabel: { color: colors.paperInkSoft },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  paperChosen: { backgroundColor: colors.paperCard, borderColor: colors.paperGold },
  fileName: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  paperFileName: { color: colors.paperInk },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { gap: spacing.sm },
});

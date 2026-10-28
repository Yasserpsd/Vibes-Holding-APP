import Ionicons from '@expo/vector-icons/Ionicons';
import { requireOptionalNativeModule } from 'expo';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { colors, radii } from '@/theme/tokens';

/** M151: the file size the advisor accepts (the server and the hub enforce the same cap). */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;

/** A PDF the member picked and has not sent yet. */
export type PendingFile = { uri: string; name: string; size: number };

/**
 * M151 «المستشار يقرأ ملفك»: a document picker for ONE PDF. expo-document-picker is a NATIVE
 * module: binaries built before it hide the button entirely (requireOptionalNativeModule), so OTA
 * updates stay safe on the 1.1.0 binary; the button appears from the next build on.
 */
const picker = requireOptionalNativeModule('ExpoDocumentPicker')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-document-picker') as typeof import('expo-document-picker'))
  : null;

export function fileInputAvailable(): boolean {
  return picker !== null;
}

/** Human size: «2.4 MB» / «640 KB». */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type Props = { onFile: (file: PendingFile) => void; disabled: boolean };

export function FileButton({ onFile, disabled }: Props) {
  const [picking, setPicking] = useState(false);
  if (!picker) return null;
  const mod = picker;

  const pick = async () => {
    if (picking || disabled) return;
    setPicking(true);
    try {
      const result = await mod.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const name = (asset.name || 'file.pdf').trim();
      const isPdf = asset.mimeType === 'application/pdf' || /\.pdf$/i.test(name);
      if (!isPdf) {
        Alert.alert(t('advisor.file.title'), t('advisor.file.onlyPdf'));
        return;
      }
      const size = asset.size ?? 0;
      if (size > FILE_MAX_BYTES) {
        Alert.alert(t('advisor.file.title'), t('advisor.file.tooBig'));
        return;
      }
      onFile({ uri: asset.uri, name: name.slice(0, 120), size });
    } catch {
      Alert.alert(t('advisor.file.title'), t('advisor.file.failed'));
    } finally {
      setPicking(false);
    }
  };

  return (
    <PressScale
      onPress={() => void pick()}
      glowRadius={radii.pill}
      style={[styles.button, (disabled || picking) && styles.buttonMuted]}
      accessibilityRole="button"
      accessibilityLabel={t('advisor.file.attach')}
      accessibilityState={{ busy: picking }}
    >
      <Ionicons name={picking ? 'hourglass-outline' : 'attach'} size={22} color={colors.gold} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonMuted: { opacity: 0.6 },
});

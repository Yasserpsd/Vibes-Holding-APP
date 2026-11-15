import Ionicons from '@expo/vector-icons/Ionicons';
import { requireOptionalNativeModule } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { UploadCancelledError, uploadFormFile } from '@/api/forms';
import { AppButton } from '@/components/AppButton';
import { RequiredMark } from '@/components/form/FormParts';
import { Notice } from '@/components/Notice';
import { usePaper } from '@/components/paper';
import { t, tOptional } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
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
  /** M241: a required attachment wears the red star after its label. */
  required?: boolean;
  signedIn: boolean;
  value: string;
  onChange: (value: string) => void;
  onBusy: (busy: boolean) => void;
};

export function FormFileField({ formKey, label, required = false, signedIn, value, onChange, onBusy }: Props) {
  const paper = usePaper();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // M241: how much of the file has gone up (0 to 1); stays 0 on a binary that reports no progress.
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  // M241: the upload in flight. Cancelling (or leaving the form) aborts it; a late answer of a cancelled run is ignored.
  const run = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      run.current?.abort();
      run.current = null;
    },
    [],
  );

  const pick = async () => {
    if (!picker || busy) return;
    setProblem(null);
    let controller: AbortController | null = null;
    try {
      const result = await picker.getDocumentAsync({ type: [...new Set(Object.values(TYPES))], copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const fileName = (asset.name || 'file').trim().slice(0, 120);
      const extension = (fileName.split('.').pop() ?? '').toLowerCase();
      const mimeType = asset.mimeType && Object.values(TYPES).includes(asset.mimeType) ? asset.mimeType : TYPES[extension];
      if (!mimeType) {
        setProblem(tOptional('form.file.badType') ?? t('form.file.failed'));
        return;
      }
      if ((asset.size ?? 0) > MAX_BYTES) {
        setProblem(t('form.file.tooBig'));
        return;
      }
      const current = new AbortController();
      controller = current;
      run.current = current;
      setProgress(0);
      setBusy(true);
      onBusy(true);
      const link = await uploadFormFile(
        formKey,
        { uri: asset.uri, name: fileName, size: asset.size ?? 1, mimeType },
        {
          signal: current.signal,
          onProgress: (fraction) => {
            if (run.current === current) setProgress(fraction);
          },
        },
      );
      if (run.current !== current) return;
      setName(fileName);
      onChange(link);
    } catch (cause) {
      // A cancelled upload is the member's own choice: no warning for it.
      if ((controller && run.current !== controller) || cause instanceof UploadCancelledError) return;
      setProblem(cause instanceof Error && 'code' in cause && cause.message ? cause.message : t('form.file.failed'));
    } finally {
      if (controller && run.current === controller) {
        run.current = null;
        setBusy(false);
        onBusy(false);
      }
    }
  };

  const cancel = () => {
    const controller = run.current;
    if (!controller) return;
    // The field is free again at once, even on a binary whose upload cannot be stopped half-way.
    run.current = null;
    controller.abort();
    setBusy(false);
    onBusy(false);
    setProgress(0);
  };

  const labelStyle = [styles.label, paper && styles.paperLabel];
  const percent = Math.round(progress * 100);
  // The accepted types and the size cap, said before the member picks anything («form.file.hint» arrives with the strings pass).
  const limits = tOptional('form.file.hint');
  if (!picker || !signedIn) {
    return (
      <View style={styles.box}>
        <Text style={labelStyle}>
          {label}
          {required ? <RequiredMark /> : null}
        </Text>
        <Notice tone="info" text={t(signedIn ? 'form.file.unavailable' : 'form.file.signIn')} />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={labelStyle}>
        {label}
        {required ? <RequiredMark /> : null}
      </Text>
      {limits && !value ? <Text style={[styles.hint, paper && styles.paperHint]}>{limits}</Text> : null}
      {value ? (
        <View style={[styles.chosen, paper && styles.paperChosen]}>
          <Ionicons name="document-attach-outline" size={22} color={paper ? colors.paperGold : colors.gold} />
          <Text style={[styles.fileName, paper && styles.paperFileName]} numberOfLines={1}>
            {name || t('deck.title')}
          </Text>
        </View>
      ) : null}
      {busy ? (
        // M241: the upload says how far it is and can be stopped.
        <View style={styles.actions}>
          <View style={styles.busy}>
            <ActivityIndicator color={paper ? colors.paperGold : colors.gold} />
            <Text style={labelStyle}>{percent > 0 ? `${t('form.file.uploading')} ${percent}%` : t('form.file.uploading')}</Text>
          </View>
          {percent > 0 ? (
            <View style={[styles.track, paper && styles.paperTrack]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
              <View style={[styles.trackFill, paper && styles.paperTrackFill, { width: `${percent}%` }]} />
            </View>
          ) : null}
          <AppButton label={t('common.cancel')} variant="outline" icon="close-outline" onPress={cancel} />
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

const styles = themedStyles(() => ({
  box: { gap: spacing.sm },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  paperLabel: { color: colors.paperInkSoft },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  paperHint: { color: colors.paperMuted },
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
  // M241: the upload's progress bar (fills from the start edge in both directions).
  track: { height: 6, borderRadius: radii.pill, backgroundColor: colors.border, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: radii.pill, backgroundColor: colors.gold },
  paperTrack: { backgroundColor: colors.paperBorder },
  paperTrackFill: { backgroundColor: colors.paperGold },
  actions: { gap: spacing.sm },
}));

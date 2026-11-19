import { View } from 'react-native';

import { ApiError, errorMessage } from '@/api/client';
import { FixButton, type FieldFix } from '@/components/form/FormParts';
import { Notice } from '@/components/Notice';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { spacing } from '@/theme/tokens';

/** A refusal that is not about one field: its sentence and its code (the code decides which buttons can end it). */
export type Failure = { message: string; code: string };

export function failureOf(error: unknown): Failure {
  return { message: errorMessage(error), code: error instanceof ApiError ? error.code : 'unexpected' };
}

/** Refusals that pass by themselves: the connection, a busy server, a slow gateway. The same request can be sent again. */
const RETRYABLE = new Set(['network', 'http_error', 'bad_response', 'internal', 'unexpected', 'hub_unreachable', 'hub_error', 'gateway', 'store_unavailable', 'phone_proof_busy', 'pb_unreachable', 'social_keys']);

type Props = {
  failure: Failure | null;
  /** Sends the same request again; shown as «إعادة المحاولة» when the refusal is one that passes by itself. */
  onRetry?: () => void;
  /** The buttons that end this refusal for good (sign in instead, continue without the invite code…). */
  actions?: (FieldFix | null | undefined | false)[];
};

/**
 * M253 (owner, 2026-11-19: «أي خطأ يحصل يظهر زرار فوري يحل المشكلة»): the refusal by a form's button — the exact
 * sentence, then the buttons that end it, then the management's WhatsApp line. A refusal about a field never
 * comes here: it sits under its field (useFormErrors.fromServer).
 */
export function FormFailure({ failure, onRetry, actions }: Props) {
  if (!failure) return null;
  const buttons: FieldFix[] = [
    ...(actions ?? []).filter((action): action is FieldFix => Boolean(action)),
    ...(onRetry && RETRYABLE.has(failure.code) ? [{ label: t('common.retry'), icon: 'refresh' as const, onPress: onRetry }] : []),
  ];
  return (
    <View style={styles.box}>
      <Notice tone="warning" text={failure.message} />
      {buttons.length ? (
        <View style={styles.buttons}>
          {buttons.map((button) => (
            <FixButton key={button.label} fix={button} />
          ))}
        </View>
      ) : null}
      <SupportLink problem={failure.message} />
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { gap: spacing.xs },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));

import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';

import { useAffiliate, affiliateApi, type AffiliateOverview } from '@/api/affiliate';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { SarText } from '@/components/SarText';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { formatSar } from '@/lib/format';
import { ibanIssue, isLatinName, normalizeIban } from '@/lib/validation';
import { themedStyles } from '@/theme/styles';
import { colors, typography } from '@/theme/tokens';

/**
 * M184 «سحب الأرباح»: the affiliate confirms his bank details (prefilled from the application)
 * and submits; the administration is mailed, transfers by hand, and marks the request paid in the
 * dashboard. The amount is always the full available balance.
 */
export default function AffiliatePayoutScreen() {
  const { status } = useAuth();
  const overview = useAffiliate(status === 'signedIn');
  const data = overview.data;

  // A guest, or an account that is not an approved affiliate (an old link), is sent to the programme page, which explains where it stands.
  if (status === 'guest' || (data && (data.status !== 'approved' || !data.balance))) return <Redirect href={'/affiliate' as Href} />;

  return (
    <Screen title={t('affiliate.payoutTitle')} subtitle={t('affiliate.payoutSubtitle')}>
      <Stack.Screen options={{ title: t('nav.affiliate') }} />
      {!data ? <StateView loading={overview.isLoading || status === 'loading'} error={overview.error} onRetry={() => void overview.refetch()} /> : <PayoutForm data={data} />}
    </Screen>
  );
}

type Field = 'bankName' | 'accountName' | 'iban';
const ORDER: Field[] = ['bankName', 'accountName', 'iban'];

/** Mounted only once the overview is loaded, so the bank fields start prefilled. */
function PayoutForm({ data }: { data: AffiliateOverview }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const application = data.application;
  const [bankName, setBankName] = useState(application?.bankName ?? '');
  const [accountName, setAccountName] = useState(application?.accountName ?? '');
  const [iban, setIban] = useState(application?.iban ?? '');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useFormErrors<Field>();

  // The same checks as the application (M195): the bank wants the account in English and a real Saudi IBAN.
  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    if (bankName.trim().length < 2) next.bankName = t('form.error.bank');
    if (!isLatinName(accountName)) next.accountName = t('form.error.latin');
    const ibanProblem = ibanIssue(iban);
    if (ibanProblem) next.iban = t(`form.error.iban.${ibanProblem}`);
    return next;
  };

  const submit = async () => {
    if (busy) return;
    setSubmitError(null);
    if (form.fail(validate(), ORDER)) return;
    setBusy(true);
    try {
      await affiliateApi.requestPayout({ bankName: bankName.trim(), accountName: accountName.trim(), iban: normalizeIban(iban) });
      await queryClient.invalidateQueries({ queryKey: ['affiliate'] });
      if (router.canGoBack()) router.back();
      else router.replace('/affiliate' as Href);
    } catch (cause) {
      // M253: a field the server refused turns red with the server's sentence; anything else sits by the button.
      if (!form.fromServer(cause, ORDER).length) setSubmitError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FadeInView delay={entranceDelay(0)}>
        <SarText style={styles.amount}>{t('affiliate.payoutAmount', { amount: formatSar(data.balance?.available ?? 0) })}</SarText>
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <FormField
          label={t('affiliate.bankName')}
          value={bankName}
          onChangeText={(value) => {
            setBankName(value);
            form.clear('bankName');
          }}
          error={form.errors.bankName}
          maxLength={80}
        />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        {/* Owner (2026-11-02): the bank account is English (name + IBAN). */}
        <FormField
          label={t('affiliate.accountName')}
          hint={t('affiliate.accountNameHint')}
          value={accountName}
          onChangeText={(value) => {
            setAccountName(value);
            form.clear('accountName');
          }}
          error={form.errors.accountName}
          latin
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={120}
        />
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <FormField
          label={t('affiliate.iban')}
          hint={t('affiliate.ibanHint')}
          placeholder={t('affiliate.ibanPlaceholder')}
          value={iban}
          onChangeText={(value) => {
            setIban(value);
            form.clear('iban');
          }}
          error={form.errors.iban}
          latin
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={40}
        />
      </FadeInView>

      {submitError ? <Notice tone="warning" text={submitError} support /> : null}
      <Notice tone="info" text={t('affiliate.payoutNote')} />
      <AppButton label={t('affiliate.payoutSubmit')} icon="send-outline" loading={busy} onPress={() => void submit()} />
    </>
  );
}

const styles = themedStyles(() => ({
  amount: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
}));

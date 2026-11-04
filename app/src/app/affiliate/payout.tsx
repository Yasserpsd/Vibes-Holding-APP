import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';


import { useAffiliate, affiliateApi, type AffiliateOverview } from '@/api/affiliate';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { SarText } from '@/components/SarText';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
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

  return (
    <Screen title={t('affiliate.payoutTitle')} subtitle={t('affiliate.payoutSubtitle')}>
      <Stack.Screen options={{ title: t('nav.affiliate') }} />
      {!data || data.status !== 'approved' || !data.balance ? (
        <StateView loading={overview.isLoading} error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <PayoutForm data={data} />
      )}
    </Screen>
  );
}

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

  const submit = async () => {
    if (!bankName.trim() || !accountName.trim() || !iban.trim()) {
      setSubmitError(t('affiliate.incomplete'));
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await affiliateApi.requestPayout({ bankName: bankName.trim(), accountName: accountName.trim(), iban: iban.trim() });
      await queryClient.invalidateQueries({ queryKey: ['affiliate'] });
      router.back();
    } catch (cause) {
      setSubmitError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FadeInView delay={entranceDelay(0)}>
        <SarText style={styles.amount}>{t('affiliate.payoutAmount', { amount: formatNumber(data.balance?.available ?? 0) })}</SarText>
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <FormField label={t('affiliate.bankName')} value={bankName} onChangeText={setBankName} maxLength={80} />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
        {/* Owner (2026-11-02): the bank account is English (name + IBAN). */}
        <FormField label={t('affiliate.accountName')} hint={t('affiliate.accountNameHint')} value={accountName} onChangeText={setAccountName} latin autoCapitalize="words" autoCorrect={false} maxLength={120} />
      </FadeInView>
      <FadeInView delay={entranceDelay(3)}>
        <FormField
          label={t('affiliate.iban')}
          hint={t('affiliate.ibanHint')}
          value={iban}
          onChangeText={setIban}
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

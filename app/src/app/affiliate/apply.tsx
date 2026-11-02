import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAffiliate, affiliateApi, type AffiliateEntityType, type AffiliateOverview } from '@/api/affiliate';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * M184: the application form (owner, 2026-11-02: full details — bank, IBAN, address, and
 * «كيف تعرّفت على نادي المستثمرين؟» from a dashboard-editable list). Submitting mails the
 * agreement; the administration's dashboard approval alone activates the affiliate.
 */
export default function AffiliateApplyScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const overview = useAffiliate(status === 'signedIn');

  if (status !== 'signedIn') {
    return (
      <Screen title={t('affiliate.applyTitle')}>
        <Stack.Screen options={{ title: t('nav.affiliate') }} />
        <Notice tone="warning" text={t('affiliate.guest')} />
        <AppButton label={t('affiliate.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen title={t('affiliate.applyTitle')} subtitle={t('affiliate.applySubtitle')}>
      <Stack.Screen options={{ title: t('nav.affiliate') }} />
      {!overview.data ? (
        <StateView loading={overview.isLoading} error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <ApplyForm data={overview.data} />
      )}
    </Screen>
  );
}

/** Mounted only once the overview is loaded, so a re-application starts prefilled. */
function ApplyForm({ data }: { data: AffiliateOverview }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const application = data.application;
  // Owner, 2026-11-02: the applicant must say whether he applies as a person or a company.
  const [entityType, setEntityType] = useState<AffiliateEntityType | null>(application?.entityType ?? (me?.memberType || null));
  const [bankName, setBankName] = useState(application?.bankName ?? '');
  const [accountName, setAccountName] = useState(application?.accountName ?? '');
  const [iban, setIban] = useState(application?.iban ?? '');
  const [city, setCity] = useState(application?.city ?? '');
  const [address, setAddress] = useState(application?.address ?? '');
  const [heardFrom, setHeardFrom] = useState<string | null>(application?.heardFrom || null);
  const [heardFromNote, setHeardFromNote] = useState(application?.heardFromNote ?? '');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async () => {
    if (!entityType || !bankName.trim() || !accountName.trim() || !iban.trim() || !city.trim() || !address.trim() || !heardFrom) {
      setSubmitError(t('affiliate.incomplete'));
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await affiliateApi.apply({
        entityType,
        bankName: bankName.trim(),
        accountName: accountName.trim(),
        iban: iban.trim(),
        city: city.trim(),
        address: address.trim(),
        heardFrom,
        heardFromNote: heardFromNote.trim(),
      });
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
        <Text style={styles.heardLabel}>{t('affiliate.entityType')}</Text>
        <View style={styles.chips}>
          <Chip label={t('affiliate.individual')} selected={entityType === 'individual'} dimmed={entityType === 'company'} onPress={() => setEntityType('individual')} />
          <Chip label={t('affiliate.company')} selected={entityType === 'company'} dimmed={entityType === 'individual'} onPress={() => setEntityType('company')} />
        </View>
      </FadeInView>
      <FadeInView delay={entranceDelay(0)}>
        <FormField label={t('affiliate.bankName')} value={bankName} onChangeText={setBankName} maxLength={80} />
      </FadeInView>
      <FadeInView delay={entranceDelay(1)}>
        <FormField label={t('affiliate.accountName')} hint={t('affiliate.accountNameHint')} value={accountName} onChangeText={setAccountName} maxLength={120} />
      </FadeInView>
      <FadeInView delay={entranceDelay(2)}>
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
      <FadeInView delay={entranceDelay(3)}>
        <FormField label={t('affiliate.city')} value={city} onChangeText={setCity} maxLength={60} />
      </FadeInView>
      <FadeInView delay={entranceDelay(4)}>
        <FormField label={t('affiliate.address')} value={address} onChangeText={setAddress} multiline maxLength={240} />
      </FadeInView>

      <FadeInView delay={entranceDelay(5)}>
        <Text style={styles.heardLabel}>{t('affiliate.heardFrom')}</Text>
        <View style={styles.chips}>
          {data.heardOptions.map((option) => (
            <Chip key={option} label={option} selected={heardFrom === option} dimmed={heardFrom !== null && heardFrom !== option} onPress={() => setHeardFrom(option)} />
          ))}
        </View>
      </FadeInView>
      {heardFrom === 'أخرى' || heardFrom === 'Other' ? (
        <FormField label={t('affiliate.heardFromNote')} value={heardFromNote} onChangeText={setHeardFromNote} maxLength={200} />
      ) : null}

      {submitError ? <Notice tone="warning" text={submitError} /> : null}
      <Notice tone="info" text={t('affiliate.applyNote')} />
      <AppButton label={t('affiliate.submit')} icon="send-outline" loading={busy} onPress={() => void submit()} />
    </>
  );
}

const styles = StyleSheet.create({
  heardLabel: { ...typography.body, color: colors.textPrimary, textAlign: textStart, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

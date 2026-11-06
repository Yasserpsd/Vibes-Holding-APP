import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import type { ScrollView } from 'react-native';

import { useAffiliate, affiliateApi, type AffiliateEntityType, type AffiliateOverview } from '@/api/affiliate';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { ChipRow, ErrorSummary, FieldGroup } from '@/components/form/FormParts';
import { FormCard } from '@/components/form/FormTheme';
import { useFormErrors } from '@/components/form/useFormErrors';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { OptionPicker } from '@/components/OptionPicker';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { addressIssue, ibanIssue, isLatinName, normalizeIban } from '@/lib/validation';

/**
 * M184: the application form (owner, 2026-11-02: full details — bank, IBAN, address, and
 * «كيف عرفت عن نادي المستثمرين؟» from a dashboard-editable list). Submitting mails the
 * agreement; the administration's dashboard approval alone activates the affiliate.
 * M195 (owner, 2026-11-04): the club identity (navy + gold, dark tone on this black screen), real
 * checks (IBAN mod-97, English account name, a city from a list, a real address) with red errors
 * under the field, a red summary on top and an automatic scroll to the first error; the source
 * options and every text follow the app's language.
 */
export default function AffiliateApplyScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const overview = useAffiliate(status === 'signedIn');
  const scrollRef = useRef<ScrollView | null>(null);

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
    <Screen title={t('affiliate.applyTitle')} subtitle={t('affiliate.applySubtitle')} scrollRef={scrollRef}>
      <Stack.Screen options={{ title: t('nav.affiliate') }} />
      {!overview.data ? (
        <StateView loading={overview.isLoading} error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <ApplyForm data={overview.data} scrollRef={scrollRef} />
      )}
    </Screen>
  );
}

type Field = 'entityType' | 'bankName' | 'accountName' | 'iban' | 'city' | 'cityOther' | 'address' | 'heardFrom';
const ORDER: Field[] = ['entityType', 'bankName', 'accountName', 'iban', 'city', 'cityOther', 'address', 'heardFrom'];

/** Mounted only once the overview is loaded, so a re-application starts prefilled. */
function ApplyForm({ data, scrollRef }: { data: AffiliateOverview; scrollRef: React.RefObject<ScrollView | null> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const application = data.application;
  // Owner, 2026-11-02: the applicant must say whether he applies as a person or a company.
  const [entityType, setEntityType] = useState<AffiliateEntityType | null>(application?.entityType ?? (me?.memberType || null));
  const [bankName, setBankName] = useState(application?.bankName ?? '');
  const [accountName, setAccountName] = useState(application?.accountName ?? '');
  const [iban, setIban] = useState(application?.iban ?? '');
  const [city, setCity] = useState<string | null>(application?.cityKey ?? null);
  const [cityOther, setCityOther] = useState(application?.cityKey === 'other' ? (application.city ?? '') : '');
  const [address, setAddress] = useState(application?.address ?? '');
  const [heardFrom, setHeardFrom] = useState<string | null>(application?.heardFrom || null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useFormErrors<Field>(scrollRef);

  // An older server sends the Arabic strings only; the app then shows them as they are.
  const heardChoices = data.heardChoices ?? data.heardOptions.map((option) => ({ value: option, label: option }));
  const cities = data.cities ?? [];

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    if (!entityType) next.entityType = t('form.error.memberType');
    if (bankName.trim().length < 2) next.bankName = t('form.error.bank');
    if (!isLatinName(accountName)) next.accountName = t('form.error.latin');
    const ibanProblem = ibanIssue(iban);
    if (ibanProblem) next.iban = t(`form.error.iban.${ibanProblem}`);
    if (cities.length && !city) next.city = t('form.error.city');
    if (cities.length && city === 'other' && !/^[؀-ۿA-Za-z][؀-ۿA-Za-z\s'’-]{2,}$/.test(cityOther.trim())) next.cityOther = t('form.error.cityOther');
    const addressProblem = addressIssue(address, [me?.name ?? '', accountName, bankName]);
    if (addressProblem) next.address = t(`form.error.address.${addressProblem}`);
    if (!heardFrom) next.heardFrom = t('form.error.heardFrom');
    return next;
  };

  const submit = async () => {
    if (busy) return;
    setSubmitError(null);
    if (form.fail(validate(), ORDER) || !entityType) return;
    setBusy(true);
    try {
      await affiliateApi.apply({
        entityType,
        bankName: bankName.trim(),
        accountName: accountName.trim(),
        iban: normalizeIban(iban),
        city: cities.length ? (city ?? '') : cityOther.trim(),
        cityOther: city === 'other' ? cityOther.trim() : '',
        address: address.trim(),
        heardFrom: heardFrom ?? '',
        heardFromNote: '',
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
    <FormCard tone="light">
      <ErrorSummary count={form.count} />

      <FieldGroup label={t('affiliate.entityType')} error={form.errors.entityType} anchorRef={form.anchor('entityType')}>
        <ChipRow>
          <Chip
            label={t('affiliate.individual')}
            selected={entityType === 'individual'}
            onPress={() => {
              setEntityType('individual');
              form.clear('entityType');
            }}
          />
          <Chip
            label={t('affiliate.company')}
            selected={entityType === 'company'}
            onPress={() => {
              setEntityType('company');
              form.clear('entityType');
            }}
          />
        </ChipRow>
      </FieldGroup>

      <FormField
        label={t('affiliate.bankName')}
        value={bankName}
        onChangeText={(value) => {
          setBankName(value);
          form.clear('bankName');
        }}
        error={form.errors.bankName}
        anchorRef={form.anchor('bankName')}
        maxLength={80}
      />
      {/* Owner (2026-11-02): the bank account is English; every other field takes Arabic freely. */}
      <FormField
        label={t('affiliate.accountName')}
        hint={t('affiliate.accountNameHint')}
        value={accountName}
        onChangeText={(value) => {
          setAccountName(value);
          form.clear('accountName');
        }}
        error={form.errors.accountName}
        anchorRef={form.anchor('accountName')}
        latin
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={120}
      />
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
        anchorRef={form.anchor('iban')}
        latin
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={34}
      />

      {cities.length ? (
        <OptionPicker
          label={t('affiliate.city')}
          options={cities}
          selected={city}
          onSelect={(value) => {
            setCity(value);
            form.clear('city');
          }}
          placeholder={t('affiliate.cityPlaceholder')}
          error={form.errors.city}
          anchorRef={form.anchor('city')}
        />
      ) : (
        <FormField
          label={t('affiliate.city')}
          value={cityOther}
          onChangeText={(value) => {
            setCityOther(value);
            form.clear('cityOther');
          }}
          error={form.errors.cityOther}
          anchorRef={form.anchor('cityOther')}
          maxLength={60}
        />
      )}
      {cities.length && city === 'other' ? (
        <FormField
          label={t('affiliate.cityOther')}
          value={cityOther}
          onChangeText={(value) => {
            setCityOther(value);
            form.clear('cityOther');
          }}
          error={form.errors.cityOther}
          anchorRef={form.anchor('cityOther')}
          maxLength={60}
        />
      ) : null}

      <FormField
        label={t('affiliate.address')}
        hint={t('affiliate.addressHint')}
        value={address}
        onChangeText={(value) => {
          setAddress(value);
          form.clear('address');
        }}
        error={form.errors.address}
        anchorRef={form.anchor('address')}
        multiline
        maxLength={240}
      />

      <FieldGroup label={t('affiliate.heardFrom')} error={form.errors.heardFrom} anchorRef={form.anchor('heardFrom')}>
        <ChipRow>
          {heardChoices.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={heardFrom === option.value}
              onPress={() => {
                setHeardFrom(option.value);
                form.clear('heardFrom');
              }}
            />
          ))}
        </ChipRow>
      </FieldGroup>

      {submitError ? <Notice tone="warning" text={submitError} support /> : null}
      <Notice tone="info" text={t('affiliate.applyNote')} />
      <AppButton label={t('affiliate.submit')} icon="send-outline" loading={busy} onPress={() => void submit()} />
    </FormCard>
  );
}

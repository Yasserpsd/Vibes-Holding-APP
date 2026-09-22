import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { reportServiceRequest, useService, type Service, type ServiceAction, type ServiceField } from '@/api/content';
import { amountLabel, paymentsApi } from '@/api/payments';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen, useAskAdvisor } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { FormField } from '@/components/FormField';
import { LockedNotice } from '@/components/LockedNotice';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openCheckout, paymentReturnUrl } from '@/lib/checkout';
import { iconFor } from '@/lib/icons';
import { openLink } from '@/lib/openLink';
import { composeRequest, openWhatsApp } from '@/lib/whatsapp';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** One service: what it is, what it costs, and the action (in-app payment, WhatsApp handover, web form, advisor, HQ, Projects Bank). */
export default function ServiceScreen() {
  const { key, answers: answersParam } = useLocalSearchParams<{ key: string; answers?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useService(key);
  // A retry from the payment screen brings the previous answers back through the `answers` param.
  const [answers, setAnswers] = useState<Record<string, string>>(() => parseAnswers(answersParam));
  const [handedOver, setHandedOver] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const openAdvisor = useAskAdvisor();
  const advisorContext = data ? ({ type: 'service', id: data.service.key, title: data.service.title } as const) : null;
  useAdvisorScreen(advisorContext);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { service, lockedText } = data;
  const askAdvisor = (prompt?: string) => openAdvisor({ type: 'service', id: service.key, title: service.title }, prompt);

  const handOver = async (action: Extract<ServiceAction, { type: 'whatsapp' }>) => {
    // The management hears about the request right away, even if WhatsApp is closed without sending.
    reportServiceRequest(service.key, answers);
    const lines = action.fields.map((field) => ({ label: field.label, value: answers[field.key] ?? '' }));
    const text = composeRequest(action.message, lines, me ? { name: me.name, phone: me.phone } : null);
    setHandedOver(await openWhatsApp(action.phone, text));
  };

  // The server creates the gateway intention; the checkout opens in the in-app browser; the status is polled from the server.
  const pay = async () => {
    const action = service.action;
    if (action?.type === 'paymob') {
      const missing = action.fields.find((field) => !(answers[field.key] ?? '').trim());
      if (missing) {
        setPayError(t('service.missingField', { field: missing.label }));
        return;
      }
    }
    setPaying(true);
    setPayError(null);
    try {
      const { payment } = await paymentsApi.start(service.key, answers);
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      await openCheckout(payment.checkoutUrl, paymentReturnUrl(payment.id));
      router.navigate({ pathname: '/payment/[id]', params: { id: payment.id } });
    } catch (cause) {
      setPayError(errorMessage(cause));
    } finally {
      setPaying(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Ionicons name={iconFor(service.icon)} size={28} color={colors.gold} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{service.title}</Text>
          {service.priceLabel || service.memberLabel ? (
            <View style={styles.labels}>
              {service.priceLabel ? <Text style={styles.price}>{service.priceLabel}</Text> : null}
              {service.memberLabel ? <Text style={styles.member}>{service.memberLabel}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
      <Text style={styles.summary}>{service.summary}</Text>
      {service.detail
        ? service.detail.split('\n').map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))
        : null}

      {service.locked || !service.action ? (
        <LockedNotice text={lockedText} guest={status !== 'signedIn'} />
      ) : (
        <ActionPanel
          action={service.action}
          price={service.price}
          signedIn={status === 'signedIn'}
          paying={paying}
          answers={answers}
          onAnswer={(field, value) => setAnswers((current) => ({ ...current, [field]: value }))}
          onWhatsApp={(action) => void handOver(action)}
          onPay={() => void pay()}
          onLogin={() => router.push('/auth/login')}
          onAdvisor={askAdvisor}
          onHq={() => router.push('/hq')}
          onProjects={() => router.push('/projects')}
        />
      )}
      {payError ? <Notice tone="warning" text={payError} /> : null}
      {handedOver ? <Notice tone="info" text={t('service.handedOver')} /> : null}

      {service.infoUrl ? <AppButton label={t('service.infoOnSite')} variant="outline" icon="open-outline" onPress={() => void openLink(service.infoUrl ?? '')} /> : null}
    </Screen>
  );
}

type ActionPanelProps = {
  action: ServiceAction;
  price: Service['price'];
  signedIn: boolean;
  paying: boolean;
  answers: Record<string, string>;
  onAnswer: (field: string, value: string) => void;
  onWhatsApp: (action: Extract<ServiceAction, { type: 'whatsapp' }>) => void;
  onPay: () => void;
  onLogin: () => void;
  onAdvisor: (prompt?: string) => void;
  onHq: () => void;
  onProjects: () => void;
};

function ActionPanel({ action, price, signedIn, paying, answers, onAnswer, onWhatsApp, onPay, onLogin, onAdvisor, onHq, onProjects }: ActionPanelProps) {
  switch (action.type) {
    case 'whatsapp':
      return (
        <View style={styles.panel}>
          {action.fields.length ? <Text style={styles.panelTitle}>{t('service.requestDetails')}</Text> : null}
          {action.fields.map((field) => (
            <FieldInput key={field.key} field={field} value={answers[field.key] ?? ''} onChange={(value) => onAnswer(field.key, value)} />
          ))}
          <AppButton label={t('service.sendWhatsApp')} icon="logo-whatsapp" onPress={() => onWhatsApp(action)} />
        </View>
      );
    case 'paymob':
      return (
        <View style={styles.panel}>
          {action.fields.length ? <Text style={styles.panelTitle}>{t('service.requestDetails')}</Text> : null}
          {action.fields.map((field) => (
            <FieldInput key={field.key} field={field} value={answers[field.key] ?? ''} onChange={(value) => onAnswer(field.key, value)} />
          ))}
          {price ? (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>{t('service.amount')}</Text>
              <Text style={styles.priceValue}>{amountLabel(price)}</Text>
              {price.memberPrice ? <Text style={styles.priceNote}>{t('service.memberPrice')}</Text> : null}
            </View>
          ) : null}
          {!signedIn ? (
            <>
              <Text style={styles.payHint}>{t('service.signInToPay')}</Text>
              <AppButton label={t('service.signInButton')} icon="log-in-outline" onPress={onLogin} />
            </>
          ) : paying ? (
            <ActivityIndicator color={colors.gold} />
          ) : (
            <AppButton label={t('service.payNow')} icon="card-outline" onPress={onPay} />
          )}
          <Text style={styles.payHint}>{t('service.payHint')}</Text>
        </View>
      );
    case 'link':
      return <AppButton label={action.label} icon="open-outline" onPress={() => void openLink(action.url)} />;
    case 'advisor':
      return <AppButton label={t('advisor.ask')} icon="sparkles-outline" onPress={() => onAdvisor(action.prompt)} />;
    case 'hq':
      return <AppButton label={t('service.bookHq')} icon="business-outline" onPress={onHq} />;
    case 'projects':
      return <AppButton label={t('service.openProjects')} icon="briefcase-outline" onPress={onProjects} />;
    default:
      return null;
  }
}

function parseAnswers(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function FieldInput({ field, value, onChange }: { field: ServiceField; value: string; onChange: (value: string) => void }) {
  if (field.options?.length) {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{field.label}</Text>
        <View style={styles.chips}>
          {field.options.map((option) => (
            <Chip key={option} label={option} selected={value === option} onPress={() => onChange(value === option ? '' : option)} />
          ))}
        </View>
      </View>
    );
  }
  return <FormField label={field.label} value={value} onChangeText={onChange} placeholder={field.placeholder} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  headerText: { flex: 1, gap: 4 },
  title: { ...typography.title, color: colors.gold, textAlign: textStart },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  price: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.textPrimary },
  member: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.goldLight },
  summary: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  paragraph: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  panel: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  panelTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  priceLabel: { ...typography.caption, color: colors.textSecondary },
  priceValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.gold },
  priceNote: { ...typography.caption, color: colors.goldLight },
  payHint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});

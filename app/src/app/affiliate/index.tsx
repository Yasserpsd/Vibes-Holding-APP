import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { useAffiliate, affiliateApi, type AffiliatePayout, type AffiliateReferral } from '@/api/affiliate';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { SarText } from '@/components/SarText';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate, formatNumber } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';

// Left-to-right mark: keeps the Latin code and link readable inside Arabic lines (Android RTL).
const LRM = '‎';

/**
 * M184: «برنامج ممثلي النادي» — every signed-in account may apply (full form), the agreement
 * arrives by e-mail and is accepted here, and ONLY the administration's dashboard approval
 * activates the affiliate. Approved: the panel shows the personal link, every referral with its
 * paid state («عضو غير دافع» until the server confirms the payment), the balance and «سحب الأرباح».
 */
export default function AffiliateScreen() {
  const { me, status } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const overview = useAffiliate(status === 'signedIn');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (status !== 'signedIn' || !me) {
    return (
      <Screen title={t('affiliate.title')}>
        <Stack.Screen options={{ title: t('nav.affiliate') }} />
        <Notice tone="warning" text={t('affiliate.guest')} />
        <AppButton label={t('affiliate.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  const data = overview.data;

  const acceptAgreement = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await affiliateApi.acceptAgreement();
      await queryClient.invalidateQueries({ queryKey: ['affiliate'] });
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!data?.shareText) return;
    try {
      await Share.share({ message: data.shareText });
    } catch {
      // The member closed the share sheet or the system refused it; nothing to do.
    }
  };

  return (
    <Screen title={t('affiliate.title')} subtitle={t('affiliate.subtitle')}>
      <Stack.Screen options={{ title: t('nav.affiliate') }} />

      {!data ? (
        <StateView loading={overview.isLoading} error={overview.error} onRetry={() => void overview.refetch()} />
      ) : data.status === 'approved' && data.balance ? (
        <>
          {/* ——— The affiliate panel ——— */}
          <FadeInView delay={entranceDelay(0)}>
            <GlassCard radius={radii.lg} style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>{t('affiliate.available')}</Text>
              <SarText style={styles.balanceValue}>{`${formatNumber(data.balance.available)} ريال`}</SarText>
              <View style={styles.balanceRow}>
                <BalanceCell label={t('affiliate.paidCount')} value={formatNumber(data.balance.paid)} />
                <BalanceCell label={t('affiliate.unpaidCount')} value={formatNumber(data.balance.unpaid)} />
                <BalanceCell label={t('affiliate.withdrawn')} value={formatNumber(data.balance.withdrawn)} />
              </View>
              <SarText style={styles.commissionNote}>{t('affiliate.commissionNote', { amount: formatNumber(data.balance.commission) })}</SarText>
            </GlassCard>
          </FadeInView>

          <FadeInView delay={entranceDelay(1)}>
            <View style={styles.linkBox}>
              <Text style={styles.linkLabel}>{t('affiliate.linkLabel')}</Text>
              {data.link ? <Text style={styles.link}>{`${LRM}${data.link}`}</Text> : null}
              <Text style={styles.codeLine}>{`${t('affiliate.codeLabel')}: ${LRM}${data.code ?? ''}`}</Text>
            </View>
          </FadeInView>

          <FadeInView delay={entranceDelay(2)}>
            <AppButton label={t('affiliate.share')} icon="share-social-outline" onPress={() => void share()} />
          </FadeInView>

          <FadeInView delay={entranceDelay(3)}>
            <AppButton
              label={t('affiliate.payout')}
              icon="cash-outline"
              variant="outline"
              disabled={data.balance.available <= 0 || (data.payouts ?? []).some((payout) => payout.status === 'requested')}
              onPress={() => router.push('/affiliate/payout')}
            />
          </FadeInView>
          {(data.payouts ?? []).some((payout) => payout.status === 'requested') ? (
            <Notice tone="info" text={t('affiliate.payoutOpen')} />
          ) : null}

          {(data.payouts ?? []).length > 0 ? (
            <FadeInView delay={entranceDelay(4)}>
              <Text style={styles.sectionTitle}>{t('affiliate.payoutsTitle')}</Text>
              {(data.payouts ?? []).map((payout) => (
                <PayoutRow key={payout.id} payout={payout} />
              ))}
            </FadeInView>
          ) : null}

          <FadeInView delay={entranceDelay(5)}>
            <View style={styles.listHead}>
              <Text style={styles.sectionTitle}>{t('affiliate.referralsTitle')}</Text>
              <Text style={styles.sectionHint}>{t('affiliate.referralsHint')}</Text>
            </View>
          </FadeInView>
          {(data.referrals ?? []).length === 0 ? (
            <StateView empty emptyText={t('affiliate.noReferrals')} />
          ) : (
            (data.referrals ?? []).map((person, index) => (
              <FadeInView key={`${person.at}-${index}`} delay={entranceDelay(index + 6)}>
                <ReferralRow person={person} />
              </FadeInView>
            ))
          )}
        </>
      ) : data.status === 'agreement' ? (
        <>
          {/* ——— The agreement step: mailed, read here, accepted here ——— */}
          <Notice tone="info" text={t('affiliate.agreementSent')} />
          <FadeInView delay={entranceDelay(1)}>
            <GlassCard radius={radii.md} style={styles.agreementCard}>
              <Text style={styles.agreementText}>{data.agreementText}</Text>
            </GlassCard>
          </FadeInView>
          {actionError ? <Notice tone="warning" text={actionError} /> : null}
          <AppButton label={t('affiliate.accept')} icon="checkmark-circle-outline" loading={busy} onPress={() => void acceptAgreement()} />
          <AppButton label={t('affiliate.editApplication')} variant="ghost" onPress={() => router.push('/affiliate/apply')} />
        </>
      ) : data.status === 'pending' ? (
        <Notice tone="info" text={t('affiliate.pending')} />
      ) : (
        <>
          {/* ——— Not applied yet (or rejected): the pitch and the application door ——— */}
          {data.status === 'rejected' ? (
            <Notice
              tone="warning"
              text={data.application?.adminNote ? `${t('affiliate.rejected')}\n${t('affiliate.adminNote')}: ${data.application.adminNote}` : t('affiliate.rejected')}
            />
          ) : null}
          <FadeInView delay={entranceDelay(0)}>
            <Text style={styles.intro}>{data.introText}</Text>
          </FadeInView>
          <FadeInView delay={entranceDelay(1)}>
            <AppButton label={t(data.status === 'rejected' ? 'affiliate.reapply' : 'affiliate.apply')} icon="megaphone-outline" onPress={() => router.push('/affiliate/apply')} />
          </FadeInView>
          <FadeInView delay={entranceDelay(2)}>
            <GlassCard radius={radii.md} style={styles.agreementCard}>
              <Text style={styles.agreementTitle}>{t('affiliate.agreementTitle')}</Text>
              <Text style={styles.agreementText}>{data.agreementText}</Text>
            </GlassCard>
          </FadeInView>
        </>
      )}
    </Screen>
  );
}

function BalanceCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellValue}>{value}</Text>
      <Text style={styles.cellLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function ReferralRow({ person }: { person: AffiliateReferral }) {
  return (
    <GlassCard radius={radii.md} style={styles.row}>
      <Ionicons name={person.paid ? 'ribbon-outline' : 'time-outline'} size={20} color={person.paid ? colors.gold : colors.textMuted} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.rowState}>{formatArabicDate(person.at)}</Text>
      </View>
      <View style={[styles.pill, person.paid ? styles.pillPaid : styles.pillUnpaid]}>
        <Text style={[styles.pillText, person.paid ? styles.pillTextPaid : null]} numberOfLines={1}>
          {t(person.paid ? 'affiliate.paidMember' : 'affiliate.unpaidMember')}
        </Text>
      </View>
    </GlassCard>
  );
}

function PayoutRow({ payout }: { payout: AffiliatePayout }) {
  const stateKey = payout.status === 'paid' ? 'affiliate.payoutPaid' : payout.status === 'rejected' ? 'affiliate.payoutRejected' : 'affiliate.payoutRequested';
  return (
    <GlassCard radius={radii.md} style={styles.row}>
      <Ionicons name="cash-outline" size={20} color={payout.status === 'paid' ? colors.gold : colors.textMuted} />
      <View style={styles.rowText}>
        <SarText style={styles.rowName}>{`${formatNumber(payout.amount)} ريال`}</SarText>
        <Text style={styles.rowState}>{`${t(stateKey)} · ${formatArabicDate(payout.requestedAt)}`}</Text>
        {payout.adminNote ? <Text style={styles.rowState}>{payout.adminNote}</Text> : null}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  intro: { ...typography.body, color: colors.textSecondary, textAlign: textStart, lineHeight: 26 },
  balanceCard: { padding: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  balanceLabel: { ...typography.caption, color: colors.textSecondary },
  balanceValue: { ...typography.title, color: colors.gold, fontVariant: ['tabular-nums'] },
  balanceRow: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.xs },
  cell: { flex: 1, alignItems: 'center', gap: 2 },
  cellValue: { ...typography.subtitle, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  cellLabel: { ...typography.caption, color: colors.textMuted },
  commissionNote: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  linkBox: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  linkLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  link: { ...typography.body, color: colors.gold, textAlign: 'center' },
  codeLine: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart, marginTop: spacing.md },
  sectionHint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  listHead: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  rowState: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  pill: { borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 4, borderWidth: 1 },
  pillPaid: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  pillUnpaid: { borderColor: colors.border, backgroundColor: 'transparent' },
  pillText: { ...typography.caption, color: colors.textMuted },
  pillTextPaid: { color: colors.gold },
  agreementCard: { padding: spacing.md, gap: spacing.sm },
  agreementTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  agreementText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart, lineHeight: 22 },
});

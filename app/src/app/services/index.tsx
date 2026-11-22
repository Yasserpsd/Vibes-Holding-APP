import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { useServices, type ServiceGroupKey } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { FeaturedProgramCard } from '@/components/FeaturedProgramCard';
import { LockedNotice } from '@/components/LockedNotice';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ServiceTile, serviceGridStyle, serviceTileWrapStyle } from '@/components/ServiceTile';
import { StateView } from '@/components/StateView';
import { WalletCard } from '@/components/WalletCard';
import { t } from '@/i18n';
import { formatServiceCount } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { colors, spacing } from '@/theme/tokens';

// Icons pass (owner's priority 1): each group's own golden badge on its header.
const GROUP_ICONS: Record<ServiceGroupKey, IoniconName> = {
  entrepreneur: 'rocket-outline',
  member: 'ribbon-outline',
  discount: 'pricetags-outline',
};

/** Every service, grouped; member-only ones are dimmed until the annual membership is active. */
export default function ServicesScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useServices();
  const [refreshing, setRefreshing] = useState(false);
  useAdvisorScreen({ type: 'screen', id: 'services', title: data?.title ?? t('nav.services') });

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  // Owner (2026-11-22: «في خدمات النادي اول حاجه تظهر بشكل مميز جدا شركاء النجاح… للمحايدين و رواد الأعمال فقط»):
  // the flagship programme opens the page as its own gold card for the neutral and the entrepreneur (a signed-in
  // account without a category reads as neutral, as on the home) and leaves their grid; the investor's and the
  // guest's page stay as they were.
  const persona = status === 'signedIn' ? me?.persona || 'neutral' : 'guest';
  const flagship = persona === 'neutral' || persona === 'entrepreneur' ? (data.services.find((service) => service.key === 'success-partners') ?? null) : null;
  const listed = flagship ? data.services.filter((service) => service.key !== flagship.key) : data.services;

  // V2: one running order across the whole page, so headers and cards cascade in as a single wave.
  let order = 0;

  return (
    <Screen
      title={data.title}
      subtitle={data.intro}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}
    >
      {/* LockedNotice animates its own entrance — wrapping it again would stall the lock's pop. */}
      {!data.isMember ? <LockedNotice text={data.lockedText} guest={status !== 'signedIn'} /> : null}
      {/* M144 (owner): «رصيد بنك المشاريع» inside the services — balance, open a project, or renew. */}
      {status === 'signedIn' ? (
        <FadeInView delay={entranceDelay(order++)}>
          <WalletCard />
        </FadeInView>
      ) : null}
      {flagship ? (
        <FadeInView delay={entranceDelay(order++)}>
          <FeaturedProgramCard service={flagship} onPress={() => router.push({ pathname: '/service/[key]', params: { key: flagship.key } })} />
        </FadeInView>
      ) : null}
      {data.services.length === 0 ? <StateView empty emptyText={t('common.noResults')} /> : null}
      {data.groups.map((group) => {
        const items = listed.filter((service) => service.group === group.key);
        if (!items.length) return null;
        return (
          <View key={group.key} style={styles.section}>
            <FadeInView delay={entranceDelay(order++)}>
              <SectionHeader title={group.title} icon={GROUP_ICONS[group.key] ?? 'grid-outline'} subtitle={formatServiceCount(items.length)} />
            </FadeInView>
            {/* M85 (owner, from the reference app): a compact 2-column grid of light tiles instead of full-width rows. */}
            <View style={serviceGridStyle}>
              {items.map((service) => (
                <FadeInView key={service.key} delay={entranceDelay(order++)} style={serviceTileWrapStyle}>
                  <ServiceTile service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
                </FadeInView>
              ))}
            </View>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
});

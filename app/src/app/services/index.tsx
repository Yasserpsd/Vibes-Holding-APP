import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useServices, type ServiceGroupKey } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { LockedNotice } from '@/components/LockedNotice';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ServiceTile, serviceGridStyle, serviceTileWrapStyle } from '@/components/ServiceTile';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { formatServiceCount } from '@/lib/format';
import type { IoniconName } from '@/lib/icons';
import { spacing } from '@/theme/tokens';

// Icons pass (owner's priority 1): each group's own golden badge on its header.
const GROUP_ICONS: Record<ServiceGroupKey, IoniconName> = {
  entrepreneur: 'rocket-outline',
  member: 'ribbon-outline',
  discount: 'pricetags-outline',
};

/** Every service, grouped; member-only ones are dimmed until the annual membership is active. */
export default function ServicesScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { data, isLoading, error, refetch } = useServices();
  useAdvisorScreen({ type: 'screen', id: 'services', title: data?.title ?? t('nav.services') });

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  // V2: one running order across the whole page, so headers and cards cascade in as a single wave.
  let order = 0;

  return (
    <Screen title={data.title} subtitle={data.intro}>
      {/* LockedNotice animates its own entrance — wrapping it again would stall the lock's pop. */}
      {!data.isMember ? <LockedNotice text={data.lockedText} guest={status !== 'signedIn'} /> : null}
      {data.groups.map((group) => {
        const items = data.services.filter((service) => service.group === group.key);
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

/** Icons pass: the services in numbers — how many, how many are members-only, and the total member saving. */
const styles = StyleSheet.create({
  section: { gap: spacing.sm },
});

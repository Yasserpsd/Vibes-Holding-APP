import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useServices } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { LockedNotice } from '@/components/LockedNotice';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { ServiceCard } from '@/components/ServiceCard';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

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
              <SectionHeader title={group.title} />
            </FadeInView>
            {items.map((service) => (
              <FadeInView key={service.key} delay={entranceDelay(order++)}>
                <ServiceCard service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
              </FadeInView>
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
});

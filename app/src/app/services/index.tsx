import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useServices } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { LockedNotice } from '@/components/LockedNotice';
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

  return (
    <Screen title={data.title} subtitle={data.intro}>
      {!data.isMember ? <LockedNotice text={data.lockedText} guest={status !== 'signedIn'} /> : null}
      {data.groups.map((group) => {
        const items = data.services.filter((service) => service.group === group.key);
        if (!items.length) return null;
        return (
          <View key={group.key} style={styles.section}>
            <SectionHeader title={group.title} />
            {items.map((service) => (
              <ServiceCard key={service.key} service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
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

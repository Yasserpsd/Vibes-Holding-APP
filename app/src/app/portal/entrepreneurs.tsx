import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useHomeContent, useServices, type Service } from '@/api/content';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { ServiceCard } from '@/components/ServiceCard';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** «بوابة رواد الأعمال»: the three services the owner picked, in the order the server lists them. */
export default function EntrepreneursScreen() {
  const router = useRouter();
  const home = useHomeContent();
  const services = useServices();
  // The floating «اسأل المستشار» button carries the portal as the context.
  useAdvisorScreen(home.data ? { type: 'portal', id: 'entrepreneur', title: home.data.entrepreneurs.title } : null);

  if (!home.data || !services.data) {
    return (
      <Screen>
        <StateView
          loading={home.isLoading || services.isLoading}
          error={home.error ?? services.error}
          onRetry={() => {
            void home.refetch();
            void services.refetch();
          }}
        />
      </Screen>
    );
  }

  const { title, intro, serviceKeys } = home.data.entrepreneurs;
  const list = services.data.services;
  const picks = serviceKeys.map((key) => list.find((service) => service.key === key)).filter((service): service is Service => Boolean(service));

  return (
    <Screen title={title} subtitle={intro}>
      <View style={styles.list}>
        {picks.map((service) => (
          <ServiceCard key={service.key} service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
        ))}
      </View>
      <AppButton label={t('portal.allServices')} variant="outline" icon="grid-outline" onPress={() => router.push('/services')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});

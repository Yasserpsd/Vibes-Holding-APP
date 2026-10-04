import { useRouter } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';

import { useHomeContent, useServices, type Service } from '@/api/content';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GoldGradient } from '@/components/lux';
import { entranceDelay, FadeInView, Floating } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { ServiceCard } from '@/components/ServiceCard';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { colors, radii, spacing } from '@/theme/tokens';

const emblem = require('../../../assets/images/club-emblem.png');

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
      {/* V2: a golden-washed banner crowns the portal — the floating emblem, no extra words. */}
      <FadeInView offset={12}>
        <GoldGradient variant="goldWash" style={styles.banner}>
          <Floating>
            <Image source={emblem} style={styles.bannerEmblem} resizeMode="contain" />
          </Floating>
        </GoldGradient>
      </FadeInView>
      <View style={styles.list}>
        {picks.map((service, index) => (
          <FadeInView key={service.key} delay={120 + entranceDelay(index, 110)}>
            <ServiceCard service={service} onPress={() => router.push({ pathname: '/service/[key]', params: { key: service.key } })} />
          </FadeInView>
        ))}
      </View>
      <FadeInView delay={120 + entranceDelay(picks.length, 110)}>
        <AppButton label={t('portal.allServices')} variant="outline" icon="grid-outline" onPress={() => router.push('/services')} />
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    overflow: 'hidden',
  },
  bannerEmblem: { width: 96, height: 96 },
  list: { gap: spacing.sm },
});

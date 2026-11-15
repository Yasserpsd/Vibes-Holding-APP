import { showAppDialog } from '@/components/AppDialog';

import { getLang, t } from './index';
import { switchLanguage } from './direction';

/** The language names stay in their own language, so a member who cannot read the current one still finds his. */
export function chooseLanguage(): void {
  const mark = (name: string, current: boolean) => (current ? `${name} (${t('lang.current')})` : name);
  // The app's own dialog (themed, closed by the Android back key), not the system's white one.
  showAppDialog({
    title: t('lang.title'),
    message: t('lang.message'),
    actions: [
      { label: mark(t('lang.arabic'), getLang() === 'ar'), onPress: () => void switchLanguage('ar') },
      { label: mark(t('lang.english'), getLang() === 'en'), onPress: () => void switchLanguage('en') },
      { label: t('lang.cancel'), style: 'cancel' },
    ],
  });
}

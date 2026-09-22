import { Alert } from 'react-native';

import { getLang, t } from './index';
import { switchLanguage } from './direction';

/** The language names stay in their own language, so a member who cannot read the current one still finds his. */
export function chooseLanguage(): void {
  const mark = (name: string, current: boolean) => (current ? `${name} (${t('lang.current')})` : name);
  Alert.alert(t('lang.title'), t('lang.message'), [
    { text: mark(t('lang.arabic'), getLang() === 'ar'), onPress: () => void switchLanguage('ar') },
    { text: mark(t('lang.english'), getLang() === 'en'), onPress: () => void switchLanguage('en') },
    { text: t('lang.cancel'), style: 'cancel' },
  ]);
}

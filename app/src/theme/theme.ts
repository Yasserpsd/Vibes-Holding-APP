import { Alert } from 'react-native';

import { t } from '@/i18n';
import { restart } from '@/i18n/direction';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { applyTheme, getThemeName, type ThemeName } from '@/theme/tokens';

/**
 * M196 (owner, 2026-11-04): the member picks light or dark in «حسابي»; the choice lives on the device
 * (not on the account — a phone is held one way) and is applied behind the splash before any screen
 * draws. Switching restarts the app, exactly like the language switch (every StyleSheet is built once).
 */
const THEME_KEY = 'investorsclub.theme';

const isThemeName = (value: string | null): value is ThemeName => value === 'dark' || value === 'light';

/** Reads the saved choice and fills the token objects. Dark when nothing is saved. */
export async function loadTheme(): Promise<ThemeName> {
  let saved: string | null = null;
  try {
    saved = await loadSetting(THEME_KEY);
  } catch {
    // Unreadable store: the dark default stands.
  }
  const name: ThemeName = isThemeName(saved) ? saved : 'dark';
  applyTheme(name);
  return name;
}

/** Saves the choice and restarts into it. */
export async function switchTheme(next: ThemeName): Promise<void> {
  if (next === getThemeName()) return;
  await saveSetting(THEME_KEY, next);
  await restart();
}

/** The «المظهر» row in «حسابي»: light or dark, the current one marked. */
export function chooseTheme(): void {
  const current = getThemeName();
  const mark = (name: string, active: boolean) => (active ? `${name} (${t('theme.current')})` : name);
  Alert.alert(t('theme.title'), t('theme.message'), [
    { text: mark(t('theme.light'), current === 'light'), onPress: () => void switchTheme('light') },
    { text: mark(t('theme.dark'), current === 'dark'), onPress: () => void switchTheme('dark') },
    { text: t('theme.cancel'), style: 'cancel' },
  ]);
}

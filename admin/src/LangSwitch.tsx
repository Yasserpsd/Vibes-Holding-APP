import { isEn, setLang } from './i18n';

/** Names the other language in its own script, as the app does. The choice is remembered on this browser. */
export function LangSwitch({ className = 'link' }: { className?: string }) {
  return (
    <button className={className} type="button" onClick={() => setLang(isEn ? 'ar' : 'en')}>
      {isEn ? 'العربية' : 'English'}
    </button>
  );
}

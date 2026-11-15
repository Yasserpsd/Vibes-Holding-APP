import { I18nManager } from 'react-native';

import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { reloadApp } from '@/lib/reloadApp';

import { getLang, saveLang, type Lang } from './index';

/*
 * The layout direction is native and fixed for a launch: Arabic runs right-to-left, English
 * left-to-right. `syncDirection()` settles it behind the splash screen, before any screen mounts,
 * so the direction of every launch is the one of the language loaded by `initI18n()`.
 *
 * `I18nManager.isRTL` is NOT that direction: it is a constant captured when the JavaScript bundle
 * starts, and on a binary built with expo-localization `forcesRTL` it reads `true` at every cold
 * start, English or not (seen on the emulator, 2026-09-22: left-to-right screen, `isRTL` true, every
 * chevron pointing the Arabic way). Everything below is read at render time from the language.
 */

/** Whether this launch runs right-to-left. Call it while rendering, never at module scope. */
export function isRTL(): boolean {
  return getLang() === 'ar';
}

/**
 * Where a line of text starts. A Text reads `left` and `right` relative to the layout direction:
 * `left` is the start edge (the right side in Arabic), `right` is the end edge. Seen on the emulator
 * (RN 0.86): `textAlign: 'right'` drew Arabic titles and labels on the LEFT of a right-to-left screen.
 */
export const textStart = 'left' as const;
/** The far edge of a line of text (times, amounts): see `textStart`. */
export const textEnd = 'right' as const;

const ARABIC_LETTER = /[\u0600-\u06FF]/u;

/**
 * M177 (owner: «في الأخبار حاجات جاية من الشمال لليمين مع إني فاتح عربي»): a Text with no alignment follows its
 * FIRST character, so a headline opening with a number, a quote or a Latin name drew from the left.
 *
 * Rule since 2026-11-16 (members: «الكلام حادف شمال بطريقة غريبة»): content text ALWAYS starts at the screen's
 * start edge — the right in Arabic, the left in English — and only its reading order follows its own letters.
 * A Latin name on an Arabic screen sits on the right and reads left to right. (The review pass of 2026-11-15
 * sent Latin-only text to the far edge instead; that version was never published to members.)
 *
 * The style is half of it. iOS obeys `writingDirection`; Android drops it and reads the direction from the
 * string itself, so content text also passes through `markParagraphs()` below.
 */
export function textDir(text: string | null | undefined): { textAlign: typeof textStart; writingDirection: 'rtl' | 'ltr' } {
  return { textAlign: textStart, writingDirection: ARABIC_LETTER.test(text ?? '') ? 'rtl' : 'ltr' };
}

// Invisible Unicode direction marks. A mark is a «strong» letter with no glyph: it is what Android's text layout
// reads to pick a paragraph's direction and the side it starts from. An isolate keeps a run of the other script
// reading in its own order, full stop included, inside a paragraph of the screen's direction.
// Written as code points on purpose: these characters are invisible, and a source file must not hide them.
const RIGHT_TO_LEFT_MARK = String.fromCharCode(0x200f);
const LEFT_TO_RIGHT_MARK = String.fromCharCode(0x200e);
const LEFT_TO_RIGHT_ISOLATE = String.fromCharCode(0x2066);
const RIGHT_TO_LEFT_ISOLATE = String.fromCharCode(0x2067);
const POP_ISOLATE = String.fromCharCode(0x2069);
/** The marks, embeddings and isolates a line may already open with (U+200E, U+200F, U+202A, U+202B, U+2066, U+2067). */
const OPENING_MARKS = [0x200e, 0x200f, 0x202a, 0x202b, 0x2066, 0x2067];
const alreadyMarked = (line: string): boolean => OPENING_MARKS.includes(line.charCodeAt(0));

/**
 * Text written by the server, the management, the advisor or a member, ready to be drawn: every paragraph
 * (line) gets an invisible direction mark in front, so each line starts at the screen's start edge and reads
 * in the order of its own letters — on Android too, where one Text takes ONE alignment from its first strong
 * letter and gives each line its own direction (a bullet opening with «ROI» sat on the left among Arabic ones).
 *
 * - A line that reads the screen's way (Arabic on the Arabic screen): the mark alone.
 * - A line that reads the other way (no Arabic letter on the Arabic screen, or Arabic on the English one): the
 *   same mark, then the line inside an isolate of its own direction.
 * - Empty lines and lines that already open with a mark are left as they are; no input gives ''.
 *
 * ONLY for the string handed to a <Text> as its children. Never for a value that is sent, saved, compared,
 * parsed (markdown, headings, bullets) or put in a TextInput. Call it while rendering.
 */
export function markParagraphs(text: string | null | undefined): string {
  if (!text) return '';
  const rtl = isRTL();
  const mark = rtl ? RIGHT_TO_LEFT_MARK : LEFT_TO_RIGHT_MARK;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim() || alreadyMarked(line)) return line;
      const arabic = ARABIC_LETTER.test(line);
      if (arabic === rtl) return mark + line;
      return mark + (arabic ? RIGHT_TO_LEFT_ISOLATE : LEFT_TO_RIGHT_ISOLATE) + line + POP_ISOLATE;
    })
    .join('\n');
}

/** A TextInput reads `left` and `right` as the physical sides, so its start follows the language. */
export function inputStart(): 'left' | 'right' {
  return isRTL() ? 'right' : 'left';
}

/** The «open this row» chevron points away from the text. */
export function chevronForward(): 'chevron-back' | 'chevron-forward' {
  return isRTL() ? 'chevron-back' : 'chevron-forward';
}

/** The arrow of a «from, to» pair follows the reading direction. */
export function arrowForward(): 'arrow-back' | 'arrow-forward' {
  return isRTL() ? 'arrow-back' : 'arrow-forward';
}

const ATTEMPT_KEY = 'investorsclub.lang.restart';

/** Restarts the app (language, theme, direction). The reload page looks like the opening screen: see lib/reloadApp.ts. */
export async function restart(): Promise<void> {
  await reloadApp();
}

/**
 * Makes the native direction follow the language loaded by `initI18n()`. Runs behind the splash
 * screen. A binary that forces its own direction (runtime 1.0.0) reports the wrong constant at every
 * start, so one language gets one restart only; the views mounted after this call take the direction
 * set here either way.
 */
export async function syncDirection(): Promise<void> {
  const lang = getLang();
  const wantRTL = lang === 'ar';
  if (I18nManager.isRTL === wantRTL) {
    // Only when an earlier launch left the mark: a delete on EVERY launch cost a secure-store call and a rewrite of
    // the mirror file behind the splash.
    if ((await loadSetting(ATTEMPT_KEY)) !== null) await saveSetting(ATTEMPT_KEY, null);
    return;
  }
  I18nManager.allowRTL(wantRTL);
  I18nManager.forceRTL(wantRTL);
  if ((await loadSetting(ATTEMPT_KEY)) === lang) return;
  await saveSetting(ATTEMPT_KEY, lang);
  await restart();
}

/** The member's choice in «حسابي»: saved, then the app restarts in the new language and direction. */
export async function switchLanguage(next: Lang): Promise<void> {
  if (next === getLang()) return;
  await saveLang(next);
  await saveSetting(ATTEMPT_KEY, null);
  I18nManager.allowRTL(next === 'ar');
  I18nManager.forceRTL(next === 'ar');
  await restart();
}

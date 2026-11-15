import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { SarText } from '@/components/SarText';
import { markParagraphs, textDir, textStart } from '@/i18n/direction';
import { colors, fonts } from '@/theme/tokens';

/**
 * M95 (owner): «تدي تدرجات لون كده في الكلام المهم» — the figures inside body text light up,
 * so amounts, percentages and counts read at a glance instead of drowning in gray prose.
 * One top-level capture group: String.split then returns [text, match, text, match…].
 */
const FIGURE =
  '(?:[0-9٠-٩][0-9٠-٩.,،٬]*)\\s*(?:٪|%|مليون|مليار|ألف|آلاف|ريال(?:ات|ًا|اً|ا)?|دولار|سنوات|سنة|أشهر|شهر|أيام|يوم|عام|أعوام|فرع|فروع|موظف|عميل|مستخدم)?|٪|%';
// A written date is ONE figure («1 نوفمبر 2026», "1 November 2026", "November 1, 2026"): without this the day
// and the year lit up bold while the month between them stayed regular.
const AR_MONTH = 'يناير|فبراير|مارس|أبريل|ابريل|إبريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر';
const EN_MONTH = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE = `[0-9٠-٩]{1,2}\\s+(?:${AR_MONTH}|${EN_MONTH})\\s+[0-9٠-٩]{4}|(?:${EN_MONTH})\\s+[0-9]{1,2},?\\s+[0-9]{4}`;
const IMPORTANT = new RegExp(`(${DATE}|${FIGURE})`, 'gu');

/**
 * A line that starts at the page's start edge like its neighbours and still reads in the order of its own
 * letters: a Latin company name on an Arabic page sits on the right, written left to right.
 */
export function ownDirection(text: string | null | undefined): { textAlign: typeof textStart; writingDirection: 'rtl' | 'ltr' } {
  return { textAlign: textStart, writingDirection: textDir(text).writingDirection };
}

/** A number, its optional percent sign, then a hyphen-like mark and another number: «5-10», «7%-8%». */
const RANGE_DASH = /([0-9٠-٩][0-9٠-٩.,٫٬]*[%٪]?)[ \t]?[-‐‑‒][ \t]?(?=[0-9٠-٩])/gu;

/**
 * CLAUDE.md copy rule: a numeric range never keeps a hyphen-minus between its two numbers. In a right-to-left
 * line a hyphen-minus glues both numbers into ONE left-to-right run («7%-8%» reads 7 on the left), while the
 * en dash is a neutral that takes the line's direction and puts the first value on the right. Founder text
 * and the advisor's table carry both writings, so every figure line is normalized here. Dates and other
 * chains of three numbers («2026-11-15») are left alone.
 */
export function rangeDashes(text: string): string {
  if (!/[0-9٠-٩][%٪]?[ \t]?[-‐‑‒][ \t]?[0-9٠-٩]/u.test(text)) return text;
  return text.replace(RANGE_DASH, (match: string, left: string, offset: number, whole: string) => {
    const after = whole.slice(offset + match.length);
    const before = whole.slice(0, offset);
    if (/^[0-9٠-٩.,٫٬]*[-‐‑‒][ \t]?[0-9٠-٩]/u.test(after) || /[0-9٠-٩][-‐‑‒][ \t]?$/u.test(before)) return match;
    return `${left}–`;
  });
}

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Color of the lit figures; gold by default, a section tone where one exists. */
  tone?: string;
  numberOfLines?: number;
};

export function Highlight({ text, style, tone = colors.goldLightText, numberOfLines }: Props) {
  // Founder- and owner-written text: every line carries its direction mark (i18n/direction.ts), put in before the
  // split so it stays the first character of its line, outside the lit figures.
  const parts = markParagraphs(rangeDashes(text)).split(IMPORTANT);
  // The lit span is a SarText so «290 ريال» shows the riyal symbol; it inherits the body's fontSize.
  const fontSize = (StyleSheet.flatten(style) as TextStyle | undefined)?.fontSize;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <SarText key={index} style={{ fontFamily: fonts.semiBold, color: tone, fontSize }}>
            {part}
          </SarText>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

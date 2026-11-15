import { Image, PixelRatio, StyleSheet, Text, useWindowDimensions, type TextProps } from 'react-native';

import { getLang } from '@/i18n';

/**
 * Owner (2026-11-02, with the symbol's picture: «الريال نستعيض عنها بالعلامة دي»): every price shows
 * the official Saudi riyal symbol (U+20C0) instead of the word «ريال»/SAR. Device fonts on older
 * phones have no glyph for it, so the official vector ships as a white tinted PNG and `tintColor`
 * paints it in the text's own color — OTA-safe, no native module, no font change.
 *
 * Drop-in Text: a string child has every «ريال» or SAR swapped for the inline symbol, sized from
 * the flattened style's fontSize and tinted with its color; non-string children pass through.
 */
const SYMBOL = require('../../assets/images/sar-symbol.png');
/** The asset's width/height (458×512), so the inline image keeps the symbol's proportions. */
const RATIO = 458 / 512;
// The suffixed forms (ريالًا/ريالاً/ريالات) are swallowed whole so no tanween or alef trails the symbol.
const WORD = /(ريال(?:ات|ًا|اً|ا)?|ر\.س|SAR)/;
// The two invisible direction marks, built from their code points so no invisible character sits in this file.
const RLM = String.fromCharCode(0x200f);
const LRM = String.fromCharCode(0x200e);
const span = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
// Characters with a direction of their own: Latin (with accents), Hebrew and Arabic LETTERS and the two marks
// above. Digits (Latin or Arabic-Indic), spaces, commas and dots have none.
const STRONG = new RegExp(`[A-Za-z${span(0x00c0, 0x024f)}${span(0x05d0, 0x05ea)}${span(0x0620, 0x064a)}${span(0x066e, 0x06d3)}${span(0x06fa, 0x06ff)}${span(0x0750, 0x077f)}${LRM}${RLM}]`);

/** The cap React Native's Text applies app-wide (app/patches/react-native+0.86.3.patch, `maxFontSizeMultiplier = 1.3`). */
const FONT_SCALE_CAP = 1.3;

/**
 * The scale this text is really drawn with. The digits grow with the phone's font size setting, the inline symbol
 * is an image sized in plain points: without this it stayed small and raised beside enlarged digits (emulator,
 * font size 200%, 2026-11-16). Same rules as the Text itself: nothing when the call site turns scaling off, its
 * own `maxFontSizeMultiplier` when it sets one (0 means «no maximum» in React Native), the app-wide cap otherwise.
 */
function drawnFontScale(system: number, allowFontScaling: boolean | undefined, maxFontSizeMultiplier: number | null | undefined): number {
  if (allowFontScaling === false || !(system > 0)) return 1;
  if (maxFontSizeMultiplier === 0) return system;
  return Math.min(system, typeof maxFontSizeMultiplier === 'number' && maxFontSizeMultiplier >= 1 ? maxFontSizeMultiplier : FONT_SCALE_CAP);
}

export function SarText({ children, style, ...rest }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  // The hook re-renders the price when the member changes the font size in the phone's settings.
  const { fontScale } = useWindowDimensions();
  const scale = drawnFontScale(fontScale ?? PixelRatio.getFontScale(), rest.allowFontScaling, rest.maxFontSizeMultiplier);
  const height = Math.round(((flat.fontSize ?? 14) as number) * scale * 0.82);
  let nodes = children;
  if (typeof children === 'string' && WORD.test(children)) {
    const parts = children.split(WORD);
    /*
     * Review 2026-11-15 (emulator: the symbol sat ON the last digit of «30,000», «15,000», «1,500»): a price that
     * is ONLY a number and the symbol has no letter to give the line a direction. Android then lays the glyphs
     * out by the screen's direction (right-to-left in Arabic) but React Native measures where the inline symbol
     * goes with a left-to-right default (TextLayoutManager.kt, «TODO: Handle text direction»), so the symbol was
     * drawn at the far end of the number instead of in the gap kept for it. One invisible direction mark in front
     * settles both on the app's own direction — at every font size, struck through or not. Text that already
     * carries a letter or a mark (a label, the LRM some screens add) is left exactly as it is.
     */
    const anchor = parts.some((part) => !WORD.test(part) && STRONG.test(part)) ? '' : getLang() === 'ar' ? RLM : LRM;
    nodes = parts.map((part, index) =>
      WORD.test(part) ? (
        <Image
          key={index}
          source={SYMBOL}
          style={{ width: Math.round(height * RATIO), height, tintColor: flat.color }}
          resizeMode="contain"
          accessibilityLabel={getLang() === 'en' ? 'SAR' : part}
        />
      ) : index === 0 ? (
        `${anchor}${part}`
      ) : (
        part
      ),
    );
  }
  return (
    <Text style={style} {...rest}>
      {nodes}
    </Text>
  );
}

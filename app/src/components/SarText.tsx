import { Image, StyleSheet, Text, type TextProps } from 'react-native';

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
// Longest forms first so «ريالًا» never leaves its tanween behind the symbol.
const WORD = /(ريالات|ريالًا|ريالاً|ريالا|ريال|ر\.س|SAR)/;

export function SarText({ children, style, ...rest }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const height = Math.round(((flat.fontSize ?? 14) as number) * 0.82);
  const nodes =
    typeof children === 'string' && WORD.test(children)
      ? children.split(WORD).map((part, index) =>
          WORD.test(part) ? (
            <Image
              key={index}
              source={SYMBOL}
              style={{ width: Math.round(height * RATIO), height, tintColor: flat.color }}
              resizeMode="contain"
              accessibilityLabel={part}
            />
          ) : (
            part
          ),
        )
      : children;
  return (
    <Text style={style} {...rest}>
      {nodes}
    </Text>
  );
}

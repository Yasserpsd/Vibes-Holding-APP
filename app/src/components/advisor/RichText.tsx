import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { openLink } from '@/lib/openLink';
import { colors, fonts } from '@/theme/tokens';

// The hub's replies use light markdown: **bold** and plain links. Headings are already stripped server-side.
const TOKEN = /(\*\*[^*\n]+\*\*|https?:\/\/[^\s<>()[\]«»"']+)/g;
const TRAILING_PUNCTUATION = /[.,،;:!?]+$/;

type Props = { text: string; style: StyleProp<TextStyle>; linkColor?: string };

export function RichText({ text, style, linkColor = colors.goldLight }: Props) {
  const parts = text.split(TOKEN);
  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (!part) return null;
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={index} style={styles.bold}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (/^https?:\/\//i.test(part)) {
          const tail = TRAILING_PUNCTUATION.exec(part)?.[0] ?? '';
          const url = tail ? part.slice(0, -tail.length) : part;
          return (
            <Text key={index}>
              <Text style={[styles.link, { color: linkColor }]} onPress={() => void openLink(url)}>
                {url}
              </Text>
              {tail}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  bold: { fontFamily: fonts.semiBold },
  link: { textDecorationLine: 'underline' },
});

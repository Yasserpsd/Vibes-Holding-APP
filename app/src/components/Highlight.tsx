import { Text, type StyleProp, type TextStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

/**
 * M95 (owner): «تدي تدرجات لون كده في الكلام المهم» — the figures inside body text light up,
 * so amounts, percentages and counts read at a glance instead of drowning in gray prose.
 * One top-level capture group: String.split then returns [text, match, text, match…].
 */
const IMPORTANT =
  /((?:[0-9٠-٩][0-9٠-٩.,،٬]*)\s*(?:٪|%|مليون|مليار|ألف|آلاف|ريال|دولار|سنوات|سنة|أشهر|شهر|أيام|يوم|عام|أعوام|فرع|فروع|موظف|عميل|مستخدم)?|٪|%)/gu;

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Color of the lit figures; gold by default, a section tone where one exists. */
  tone?: string;
  numberOfLines?: number;
};

export function Highlight({ text, style, tone = colors.goldLight, numberOfLines }: Props) {
  const parts = text.split(IMPORTANT);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={{ fontFamily: fonts.semiBold, color: tone }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

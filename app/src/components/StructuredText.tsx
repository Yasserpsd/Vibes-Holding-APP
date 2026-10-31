import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/lux';
import { textStart } from '@/i18n/direction';
import type { IoniconName } from '@/lib/icons';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M173 (owner: «أي كلام Bulk كده ليه ديزين محترم ومرتب»): owner-written prose (an event blurb, a service
 * description) rendered as tidy blocks instead of one grey paragraph. Every line becomes its own row:
 * a «label: text» line turns into a fact row with an icon and a golden label, a «- » line into a bullet,
 * anything else into a paragraph with a golden rail; figures and currency light up in gold. Pure
 * presentation — the words stay exactly the owner's.
 */
type Block = { kind: 'fact'; label: string; text: string; icon: IoniconName } | { kind: 'bullet'; text: string } | { kind: 'paragraph'; text: string };

const LABEL_MAX = 40;
const NUMBER = /(\d[\d,.٫٬]*\s?(?:%|٪|ريال|SAR|مقعدًا|مقعد)?)/u;

const ICONS: { test: RegExp; icon: IoniconName }[] = [
  { test: /مكان|مقر|موقع|place|venue|location/iu, icon: 'location-outline' },
  { test: /حضور|attend|online|أونلاين/iu, icon: 'people-outline' },
  { test: /عضو|membership|member/iu, icon: 'ribbon-outline' },
  { test: /سعر|رسوم|ريال|price|fee|sar/iu, icon: 'pricetag-outline' },
  { test: /وقت|موعد|تاريخ|يوم|time|date|when/iu, icon: 'time-outline' },
  { test: /محاور|برنامج|أجندة|agenda|topics|program/iu, icon: 'list-outline' },
];

function iconFor(label: string): IoniconName {
  return ICONS.find((entry) => entry.test.test(label))?.icon ?? 'sparkles-outline';
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-•◆*]\s+(.+)$/u);
    if (bullet?.[1]) {
      blocks.push({ kind: 'bullet', text: bullet[1] });
      continue;
    }
    // A space after the colon is required: «19:00» is a time, never a label.
    const fact = line.match(/^([^:：]{2,40})[:：]\s+(.+)$/u);
    if (fact?.[1] && fact[2] && fact[1].length <= LABEL_MAX && !/[.؟!]/u.test(fact[1])) {
      blocks.push({ kind: 'fact', label: fact[1].trim(), text: fact[2].trim(), icon: iconFor(fact[1]) });
      continue;
    }
    blocks.push({ kind: 'paragraph', text: line });
  }
  return blocks;
}

/** Figures glow gold inside the owner's sentence. */
function Lit({ text, style }: { text: string; style: object }) {
  const parts = text.split(NUMBER);
  return (
    <Text style={style}>
      {parts.map((part, index) => (index % 2 === 1 ? <Text key={index} style={styles.lit}>{part}</Text> : part))}
    </Text>
  );
}

export function StructuredText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <GlassCard style={styles.card}>
      {blocks.map((block, index) => {
        if (block.kind === 'fact') {
          return (
            <View key={index} style={styles.fact}>
              <View style={styles.factIcon}>
                <Ionicons name={block.icon} size={15} color={colors.gold} />
              </View>
              <View style={styles.factTexts}>
                <Text style={styles.factLabel}>{block.label}</Text>
                <Lit text={block.text} style={styles.factText} />
              </View>
            </View>
          );
        }
        if (block.kind === 'bullet') {
          return (
            <View key={index} style={styles.bullet}>
              <Text style={styles.diamond}>◆</Text>
              <Lit text={block.text} style={styles.bulletText} />
            </View>
          );
        }
        return (
          <View key={index} style={styles.paragraph}>
            <View style={styles.rail} />
            <Lit text={block.text} style={styles.paragraphText} />
          </View>
        );
      })}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm + 2, padding: spacing.md },
  paragraph: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  rail: { width: 3, borderRadius: 2, backgroundColor: colors.borderGold, marginVertical: 3 },
  paragraphText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart, lineHeight: 26 },
  fact: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  factIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    marginTop: 2,
  },
  factTexts: { flex: 1, gap: 2 },
  factLabel: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.goldLight, textAlign: textStart },
  factText: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  diamond: { color: colors.gold, fontSize: 9, lineHeight: 26 },
  bulletText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  lit: { fontFamily: fonts.semiBold, color: colors.goldLight },
});

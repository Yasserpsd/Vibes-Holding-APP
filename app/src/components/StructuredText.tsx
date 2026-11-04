import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { SarText } from '@/components/SarText';
import { textStart } from '@/i18n/direction';
import type { IoniconName } from '@/lib/icons';
import { sized } from '@/lib/imageUrl';
import { playVideo, youtubeIdOf } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M173 (owner: «أي كلام Bulk كده ليه ديزين محترم ومرتب»): owner-written prose (an event blurb, a service
 * description) rendered as tidy blocks instead of one grey paragraph. Every line becomes its own row:
 * a «label: text» line turns into a fact row with an icon and a golden label, a «- » line into a bullet,
 * anything else into a paragraph with a golden rail; figures and currency light up in gold. Pure
 * presentation — the words stay exactly the owner's.
 */
type Block =
  | { kind: 'fact'; label: string; text: string; icon: IoniconName }
  | { kind: 'bullet'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string };

/** M177 (owner: «أضيف صورة وبعدين أكمل كلام»): a line that is only a photo or video link shows that media in place. */
const URL_LINE = /^https?:\/\/\S+$/u;
const IMAGE_URL = /\.(?:jpe?g|png|webp|gif|heic)(?:\?\S*)?$/iu;
const VIDEO_URL = /\.(?:mp4|mov|m4v|webm)(?:\?\S*)?$/iu;

/** The text without its media lines — for one-line previews (inbox rows, the home list). */
export function withoutMediaLines(text: string): string {
  return text
    .split(/\r?\n/u)
    .filter((line) => !(URL_LINE.test(line.trim()) && (IMAGE_URL.test(line.trim()) || VIDEO_URL.test(line.trim()) || youtubeIdOf(line.trim()))))
    .join('\n')
    .trim();
}

/** M176: a short line that asks or announces («لماذا لم نحضر؟», «والسبب بسيط:») reads as a sub-heading. */
const HEADING_MAX = 60;

const LABEL_MAX = 40;
// «ريال» swallows its suffixed forms (ريالًا/ريالاً/ريالات) so the tanween never falls outside the lit span.
const NUMBER = /(\d[\d,.٫٬]*\s?(?:%|٪|ريال(?:ات|ًا|اً|ا)?|SAR|مقعدًا|مقعد)?)/u;

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
    if (URL_LINE.test(line)) {
      if (IMAGE_URL.test(line)) {
        blocks.push({ kind: 'image', url: line });
        continue;
      }
      if (VIDEO_URL.test(line) || youtubeIdOf(line)) {
        blocks.push({ kind: 'video', url: line });
        continue;
      }
    }
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
    if (line.length <= HEADING_MAX && /[؟?:：]$/u.test(line)) {
      blocks.push({ kind: 'heading', text: line.replace(/[:：]$/u, '').trim() });
      continue;
    }
    blocks.push({ kind: 'paragraph', text: line });
  }
  return blocks;
}

/** Figures glow gold inside the owner's sentence; «ريال»/SAR inside them becomes the riyal symbol. */
function Lit({ text, style, paper = false }: { text: string; style: object; paper?: boolean }) {
  const parts = text.split(NUMBER);
  return (
    <Text style={style}>
      {parts.map((part, index) => (index % 2 === 1 ? <SarText key={index} style={[style, paper ? styles.litPaper : styles.lit]}>{part}</SarText> : part))}
    </Text>
  );
}

/** M176: `paper` = ink on a white sheet (admin messages); the default is the dark glass card. */
export function StructuredText({ text, variant = 'dark' }: { text: string; variant?: 'dark' | 'paper' }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  if (variant === 'paper') return <PaperBlocks blocks={blocks} />;
  return (
    <GlassCard style={styles.card}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return <Text key={index} style={styles.heading}>{block.text}</Text>;
        }
        if (block.kind === 'image' || block.kind === 'video') return <MediaBlock key={index} block={block} />;
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

/** A photo at its own shape (capped), or a video tile that opens the in-app player. */
function MediaBlock({ block }: { block: { kind: 'image' | 'video'; url: string } }) {
  const router = useRouter();
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => {
    if (block.kind !== 'image') return;
    Image.getSize(block.url, (w, h) => (w > 0 && h > 0 ? setRatio(Math.max(0.6, w / h)) : undefined), () => undefined);
  }, [block]);
  if (block.kind === 'image') {
    return <Image source={{ uri: sized(block.url, 720) }} style={[styles.media, { aspectRatio: ratio }]} resizeMode="cover" />;
  }
  const youtube = youtubeIdOf(block.url);
  return (
    <PressScale onPress={() => playVideo(router, { url: block.url, title: '', poster: youtube ? `https://img.youtube.com/vi/${youtube}/hqdefault.jpg` : null })} accessibilityRole="button" glow glowRadius={radii.lg}>
      <View style={[styles.media, styles.videoTile]}>
        {youtube ? <Image source={{ uri: `https://img.youtube.com/vi/${youtube}/hqdefault.jpg` }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.play}>
          <Ionicons name="play" size={26} color={colors.goldInk} />
        </View>
      </View>
    </PressScale>
  );
}

function PaperBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <View style={styles.paperBody}>
      {blocks.map((block, index) => {
        if (block.kind === 'image' || block.kind === 'video') return <MediaBlock key={index} block={block} />;
        if (block.kind === 'heading') {
          return (
            <View key={index} style={[styles.paperHeadingRow, index > 0 && styles.paperHeadingGap]}>
              <View style={styles.paperHeadingBar} />
              <Text style={styles.paperHeading}>{block.text}</Text>
            </View>
          );
        }
        if (block.kind === 'fact') {
          return (
            <View key={index} style={styles.paperFact}>
              <Ionicons name={block.icon} size={16} color={colors.paperGold} style={styles.paperFactIcon} />
              <View style={styles.factTexts}>
                <Text style={styles.paperFactLabel}>{block.label}</Text>
                <Lit text={block.text} style={styles.paperText} paper />
              </View>
            </View>
          );
        }
        if (block.kind === 'bullet') {
          return (
            <View key={index} style={styles.bullet}>
              <Text style={styles.paperDiamond}>◆</Text>
              <Lit text={block.text} style={[styles.paperText, styles.flex]} paper />
            </View>
          );
        }
        return <Lit key={index} text={block.text} style={styles.paperText} paper />;
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  media: { width: '100%', borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, overflow: 'hidden', marginVertical: spacing.xs },
  videoTile: { aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0B0D' },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  heading: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 26, color: colors.goldLight, textAlign: textStart },
  // M176: the white-sheet palette — ink text, dark gold accents, air between the thoughts.
  paperBody: { gap: spacing.sm + 2 },
  paperHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  paperHeadingGap: { marginTop: spacing.sm },
  paperHeadingBar: { width: 4, height: 20, borderRadius: 2, backgroundColor: colors.gold },
  paperHeading: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 28, color: colors.paperInk, flex: 1, textAlign: textStart },
  paperText: { ...typography.body, fontSize: 16, lineHeight: 29, color: colors.paperInkSoft, textAlign: textStart },
  paperFact: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  paperFactIcon: { marginTop: 4 },
  paperFactLabel: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.paperGold, textAlign: textStart },
  paperDiamond: { color: colors.paperGold, fontSize: 9, lineHeight: 29 },
  litPaper: { fontFamily: fonts.semiBold, color: colors.paperGold },
  flex: { flex: 1 },
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
}));

import { ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { textDir, textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

// The advisor's replies use markdown: **bold**, links (plain or [label](url)), headings, bullet lists and tables.
// A plain link ends at the Arabic comma, semicolon and question mark too (U+060C, U+061B, U+061F), like at the Latin ones.
const TOKEN = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()[\]«»"'\u060C\u061B\u061F]+)/g;
const ARABIC_LETTER = /[\u0600-\u06FF]/;

/**
 * M177 for the chat: a reply with no Arabic at all (an English answer in the Arabic app) reads left-to-right from
 * the left edge. Text that holds Arabic sits on the Arabic side, and each of its lines keeps its own direction,
 * so an English line inside an Arabic reply still ends with its full stop on the right.
 */
function contentDir(text: string): TextStyle {
  const dir = textDir(text);
  return ARABIC_LETTER.test(text) ? { textAlign: dir.textAlign } : dir;
}
const MARKDOWN_LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/;
const TRAILING_PUNCTUATION = /[.,،;:!?]+$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*]\s+/;
// Marks the app does not draw never reach the member raw: `code` and code fences show as plain text,
// ***bold italic*** as bold, *italic* as plain text.
const CODE_OR_STRONG = /`[^`\n]+`|\*\*\*[^*\n]+\*\*\*/;
const REPLY_TOKEN = new RegExp(`(${CODE_OR_STRONG.source}|${TOKEN.source.slice(1)}`, 'g');
// *italic*: the opening star touches the word after it, the closing one the word before it, so «5 * 3 * 2» stays.
const ITALIC = /(^|[^*\w])\*(?=[^*\s])([^*\n]*?[^*\s])\*(?![*\w])/g;
const FENCE = /^\s*(`{3,}|~{3,})/;
const ONE_LINE_FENCE = /^\s*`{3,}(.+?)`{3,}\s*$/;
/** Wider tables scroll sideways instead of squeezing their columns. */
const MAX_FIT_COLUMNS = 3;
const SCROLL_COLUMN_WIDTH = 132;

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  /** The inside of a code fence, shown as it is (no markdown is read in it). */
  | { type: 'code'; text: string }
  | { type: 'rule' };

type Props = {
  text: string;
  style: StyleProp<TextStyle>;
  linkColor?: string;
  /** The member's own words: only bold and links, never headings or tables. */
  plain?: boolean;
};

const isTableRow = (line: string): boolean => line.includes('|') && line.trim().length > 1;

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const joined = paragraph.join('\n').trim();
    if (joined) blocks.push({ type: 'paragraph', text: joined });
    paragraph = [];
  };
  // Lines of an open code fence; the fence marks themselves are dropped.
  let fence: string[] | null = null;
  const closeFence = () => {
    const code = (fence ?? []).join('\n').replace(/^\n+|\s+$/g, '');
    if (code.trim()) blocks.push({ type: 'code', text: code });
    fence = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const oneLine = fence ? null : ONE_LINE_FENCE.exec(line);
    if (oneLine) {
      flush();
      blocks.push({ type: 'code', text: (oneLine[1] ?? '').trim() });
      continue;
    }
    if (FENCE.test(line)) {
      if (fence) closeFence();
      else {
        flush();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' });
      continue;
    }
    if (isTableRow(line) && TABLE_SEPARATOR.test(lines[index + 1] ?? '')) {
      flush();
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        const cells = tableCells(lines[index] ?? '');
        // Every row gets the header's number of cells, so the columns line up.
        rows.push(header.map((_, column) => cells[column] ?? ''));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }
    paragraph.push(line.replace(BULLET, '$1• '));
  }
  // A fence the reply never closed still shows its lines.
  if (fence) closeFence();
  flush();
  return blocks;
}

/** True when the reply holds a markdown table: the bubble then takes its full width so the columns have room. */
export function hasTable(text: string): boolean {
  return text.includes('|') && parseBlocks(text).some((block) => block.type === 'table');
}

export function RichText({ text, style, linkColor = colors.goldLightText, plain = false }: Props) {
  // The member's own words stay as typed: their stars and backticks are theirs.
  if (plain) return <Inline text={text} style={style} linkColor={linkColor} selectable marks={false} />;
  const blocks = parseBlocks(text);
  const only = blocks.length === 1 ? blocks[0] : null;
  if (only?.type === 'paragraph') return <Inline text={only.text} style={style} linkColor={linkColor} selectable />;
  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return <Inline key={index} text={block.text} style={[style, block.level <= 2 ? styles.headingLarge : styles.heading]} linkColor={linkColor} selectable />;
          case 'table':
            return <Table key={index} header={block.header} rows={block.rows} linkColor={linkColor} />;
          case 'code':
            return (
              <Text key={index} style={[style, contentDir(block.text)]} selectable>
                {block.text}
              </Text>
            );
          case 'rule':
            return <View key={index} style={styles.rule} />;
          default:
            return <Inline key={index} text={block.text} style={style} linkColor={linkColor} selectable />;
        }
      })}
    </View>
  );
}

type InlineProps = {
  text: string;
  style: StyleProp<TextStyle>;
  linkColor: string;
  /** A long press selects and copies the text (messages; table cells stay plain so a wide table scrolls freely). */
  selectable?: boolean;
  /** The advisor's markdown: marks the app does not draw are removed. False for the member's own words. */
  marks?: boolean;
};

function Inline({ text, style, linkColor, selectable = false, marks = true }: InlineProps) {
  // `split` with one capture group: even entries are the text between tokens, odd entries the tokens.
  const parts = text.split(marks ? REPLY_TOKEN : TOKEN);
  return (
    <Text style={[style, contentDir(text)]} selectable={selectable}>
      {parts.map((part, index) => {
        if (!part) return null;
        if (index % 2 === 0) return marks ? part.replace(ITALIC, '$1$2') : part;
        if (marks && part.length > 2 && part.startsWith('`') && part.endsWith('`')) return part.slice(1, -1);
        if (marks && part.length > 6 && part.startsWith('***') && part.endsWith('***')) {
          return (
            <Text key={index} style={styles.bold}>
              {part.slice(3, -3)}
            </Text>
          );
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={index} style={styles.bold}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        const labelled = MARKDOWN_LINK.exec(part);
        if (labelled) {
          const url = labelled[2] ?? '';
          return (
            <Text key={index} style={[styles.link, { color: linkColor }]} onPress={() => void openLink(url)}>
              {labelled[1]}
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

function Table({ header, rows, linkColor }: { header: string[]; rows: string[][]; linkColor: string }) {
  const scrolls = header.length > MAX_FIT_COLUMNS;
  const cell = scrolls ? styles.cellFixed : styles.cellFit;
  const body = (
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHead]}>
        {header.map((title, column) => (
          <View key={column} style={[cell, column > 0 && styles.cellBorder]}>
            <Inline text={title} style={styles.headText} linkColor={linkColor} />
          </View>
        ))}
      </View>
      {rows.map((row, line) => (
        <View key={line} style={[styles.tableRow, styles.rowBorder, line % 2 === 1 && styles.rowAlt]}>
          {row.map((value, column) => (
            <View key={column} style={[cell, column > 0 && styles.cellBorder]}>
              <Inline text={value || '—'} style={[styles.cellText, column === 0 && styles.cellLead]} linkColor={linkColor} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
  if (!scrolls) return body;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {body}
    </ScrollView>
  );
}

const styles = themedStyles(() => ({
  bold: { fontFamily: fonts.semiBold },
  link: { textDecorationLine: 'underline' },
  blocks: { gap: spacing.sm, alignSelf: 'stretch' },
  headingLarge: { fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 28, color: colors.goldLightText },
  heading: { fontFamily: fonts.semiBold, color: colors.goldLightText },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, alignSelf: 'stretch' },
  table: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderGold, overflow: 'hidden', alignSelf: 'stretch' },
  // In the forced RTL layout a row starts on the right, so the first column is the right one, as Arabic reads.
  tableRow: { flexDirection: 'row' },
  tableHead: { backgroundColor: colors.goldSoft },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowAlt: { backgroundColor: colors.surface },
  cellFit: { flex: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2 },
  cellFixed: { width: SCROLL_COLUMN_WIDTH, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2 },
  cellBorder: { borderStartWidth: StyleSheet.hairlineWidth, borderStartColor: colors.border },
  headText: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.goldLightText, textAlign: textStart },
  cellText: { ...typography.caption, color: colors.textPrimary, textAlign: textStart },
  cellLead: { fontFamily: fonts.medium, color: colors.textSecondary },
}));

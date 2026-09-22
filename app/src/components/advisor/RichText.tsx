import { ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

// The advisor's replies use markdown: **bold**, links (plain or [label](url)), headings, bullet lists and tables.
const TOKEN = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()[\]«»"']+)/g;
const MARKDOWN_LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/;
const TRAILING_PUNCTUATION = /[.,،;:!?]+$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*]\s+/;
/** Wider tables scroll sideways instead of squeezing their columns. */
const MAX_FIT_COLUMNS = 3;
const SCROLL_COLUMN_WIDTH = 132;

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
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
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
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
  flush();
  return blocks;
}

/** True when the reply holds a markdown table: the bubble then takes its full width so the columns have room. */
export function hasTable(text: string): boolean {
  return text.includes('|') && parseBlocks(text).some((block) => block.type === 'table');
}

export function RichText({ text, style, linkColor = colors.goldLight, plain = false }: Props) {
  if (plain) return <Inline text={text} style={style} linkColor={linkColor} />;
  const blocks = parseBlocks(text);
  const only = blocks.length === 1 ? blocks[0] : null;
  if (only?.type === 'paragraph') return <Inline text={only.text} style={style} linkColor={linkColor} />;
  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return <Inline key={index} text={block.text} style={[style, block.level <= 2 ? styles.headingLarge : styles.heading]} linkColor={linkColor} />;
          case 'table':
            return <Table key={index} header={block.header} rows={block.rows} linkColor={linkColor} />;
          case 'rule':
            return <View key={index} style={styles.rule} />;
          default:
            return <Inline key={index} text={block.text} style={style} linkColor={linkColor} />;
        }
      })}
    </View>
  );
}

function Inline({ text, style, linkColor }: { text: string; style: StyleProp<TextStyle>; linkColor: string }) {
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

const styles = StyleSheet.create({
  bold: { fontFamily: fonts.semiBold },
  link: { textDecorationLine: 'underline' },
  blocks: { gap: spacing.sm, alignSelf: 'stretch' },
  headingLarge: { fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 28, color: colors.goldLight },
  heading: { fontFamily: fonts.semiBold, color: colors.goldLight },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, alignSelf: 'stretch' },
  table: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.goldDark, overflow: 'hidden', alignSelf: 'stretch' },
  // In the forced RTL layout a row starts on the right, so the first column is the right one, as Arabic reads.
  tableRow: { flexDirection: 'row' },
  tableHead: { backgroundColor: 'rgba(201, 162, 39, 0.14)' },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowAlt: { backgroundColor: colors.surface },
  cellFit: { flex: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2 },
  cellFixed: { width: SCROLL_COLUMN_WIDTH, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2 },
  cellBorder: { borderStartWidth: StyleSheet.hairlineWidth, borderStartColor: colors.border },
  headText: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.goldLight, textAlign: textStart },
  cellText: { ...typography.caption, color: colors.textPrimary, textAlign: textStart },
  cellLead: { fontFamily: fonts.medium, color: colors.textSecondary },
});

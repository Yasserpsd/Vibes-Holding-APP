import type { RoyalMail, RoyalRow, RoyalStatus } from './royal.js';

/**
 * M206 (owner, 2026-11-06: «ايميلات كتير بتيجي زي كده بدون ترتيب بدون شكل»): every admin notification is written as
 * lines of «label: value», so one reader turns them into the royal shell and no mail needs its own template.
 * The text twin keeps the lines as they are.
 */
const ROW = /^([^:\n]{1,60}):\s+(.+)$/s;

function statusOf(subject: string): RoyalStatus | undefined {
  if (/ناجح|✅/.test(subject)) return { label: 'مكتمل', tone: 'good' };
  if (/❌|⚠️|غير مكتمل|لم تكتمل|تحتاج/.test(subject)) return { label: 'يحتاج متابعة', tone: 'bad' };
  if (/^بدء /.test(subject)) return { label: 'لم يكتمل بعد', tone: 'wait' };
  return undefined;
}

/** «بدء دفع من التطبيق: اصنع ملتقاك — Mohamed» → the title and, under it, what it is about. */
function splitSubject(subject: string): { title: string; subtitle?: string } {
  const at = subject.indexOf(': ');
  if (at < 0) return { title: subject };
  return { title: subject.slice(0, at), subtitle: subject.slice(at + 2) };
}

function blocksOf(lines: string[]): string[][] {
  const blocks: string[][] = [[]];
  for (const line of lines) {
    if (line.trim()) blocks[blocks.length - 1]?.push(line.trim());
    else blocks.push([]);
  }
  return blocks.filter((block) => block.length > 0);
}

export function adminRoyal(subject: string, lines: string[], stamp: string): RoyalMail {
  const blocks = blocksOf(lines);
  const lead: string[] = [];
  const rows: RoyalRow[] = [];
  const notes: string[] = [];
  blocks.forEach((block, blockIndex) => {
    // A last block of one line after the facts is the closing instruction («القائمة الكاملة في لوحة الإدارة: …»).
    if (blockIndex > 1 && blockIndex === blocks.length - 1 && block.length === 1) {
      notes.push(block[0] as string);
      return;
    }
    block.forEach((line, lineIndex) => {
      if (blockIndex === 0 && lineIndex === 0) {
        lead.push(line);
        return;
      }
      const row = ROW.exec(line);
      if (row) rows.push({ label: row[1] as string, value: row[2] as string });
      else (rows.length ? notes : lead).push(line);
    });
  });
  rows.push({ label: 'التاريخ', value: stamp });
  const status = statusOf(subject);
  return {
    lang: 'ar',
    ...splitSubject(subject),
    ...(status ? { status } : {}),
    ...(lead.length ? { lead } : {}),
    rows,
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

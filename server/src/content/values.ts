import type { KV } from '../store.js';
import { CONTENT_BLOCKS, ContentError, type ContentBlock } from './admin.js';
import type { ContentBlockKey } from './edits.js';

/**
 * M33 («تحكم كامل»): the values the text editor leaves out — prices and amounts, links, phone numbers,
 * order numbers and switches — listed from the same seven blocks and edited in place in the stored
 * Arabic block (values are the same in both languages, see i18n.ts). What stays code-side, on purpose:
 * item names (`key`/`code`/`id`), kind/enum fields, icon names, and adding or removing rows — each of
 * those can break how the app draws or routes.
 */
export type ValueKind = 'number' | 'url' | 'phone' | 'switch';
export type ContentValue = {
  block: ContentBlockKey;
  path: string;
  kind: ValueKind;
  value: number | string | boolean;
  /** The seed's value at this path: «رجوع للقيمة الأصلية» writes it back. Null when the seed no longer has the path. */
  seedValue: number | string | boolean | null;
  edit: ValueEdit | null;
};
export type ValueEdit = { by: string; at: string };

export type AdminValues = { blocks: { key: ContentBlockKey; label: string; count: number }[]; items: ContentValue[]; edited: number };

const VALUE_EDITS_KEY = 'content:values:edits';
const NAME_KEYS = new Set(['key', 'code', 'id']);
/** Numbers that name or version things are not content. */
const SKIPPED_NUMBERS = new Set(['version']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isUrl = (value: string): boolean => /^https?:\/\//iu.test(value.trim());
const isPhone = (value: string): boolean => /^\+[0-9][0-9 -]{7,18}$/u.test(value.trim());

function nameOf(item: unknown, index: number): string {
  if (isRecord(item)) {
    for (const name of NAME_KEYS) {
      const value = item[name];
      if (typeof value === 'string' && value && !value.includes('.')) return value;
    }
  }
  return String(index);
}

function kindOf(lastSegment: string, value: unknown): ValueKind | null {
  if (typeof value === 'number') return Number.isFinite(value) && !SKIPPED_NUMBERS.has(lastSegment) ? 'number' : null;
  if (typeof value === 'boolean') return 'switch';
  if (typeof value === 'string') {
    if (NAME_KEYS.has(lastSegment) || lastSegment === 'updatedAt') return null;
    if (isUrl(value)) return 'url';
    if (isPhone(value)) return 'phone';
  }
  return null;
}

function walk(node: unknown, prefix: string, visit: (path: string, kind: ValueKind, value: number | string | boolean) => void): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, prefix ? `${prefix}.${nameOf(item, index)}` : nameOf(item, index), visit));
    return;
  }
  if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const kind = kindOf(key, value);
      if (kind) visit(path, kind, value as number | string | boolean);
      else walk(value, path, visit);
    }
  }
}

/** The value at a dotted path (list items by their name), or undefined. */
function at(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) current = current.find((entry, index) => nameOf(entry, index) === segment);
    else if (isRecord(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

type EditsDoc = Record<string, ValueEdit>;
const editKey = (block: string, path: string): string => `${block}|${path}`;

const baseOf = async (kv: KV, block: ContentBlock): Promise<unknown> => (await kv.get<unknown>(block.storeKey)) ?? block.seed;

export async function adminValues(kv: KV): Promise<AdminValues> {
  const edits = (await kv.get<EditsDoc>(VALUE_EDITS_KEY)) ?? {};
  const blocks: AdminValues['blocks'] = [];
  const items: ContentValue[] = [];
  let edited = 0;
  for (const block of CONTENT_BLOCKS) {
    const base = await baseOf(kv, block);
    let count = 0;
    walk(base, '', (path, kind, value) => {
      const seed = at(block.seed, path);
      const seedValue = typeof seed === typeof value ? (seed as number | string | boolean) : null;
      const edit = edits[editKey(block.key, path)] ?? null;
      if (edit) edited += 1;
      items.push({ block: block.key, path, kind, value, seedValue, edit });
      count += 1;
    });
    blocks.push({ key: block.key, label: block.label, count });
  }
  return { blocks, items, edited };
}

export type ValueInput = { block: ContentBlockKey; path: string; value: number | string | boolean | null; by: string };

// One save at a time (single-instance server): each save rewrites a whole block document.
let chain: Promise<unknown> = Promise.resolve();

/** Saves one value in place; `value: null` writes the seed's value back. Answers the block as stored. */
export function saveContentValue(kv: KV, input: ValueInput): Promise<{ value: number | string | boolean; edit: ValueEdit | null }> {
  const run = chain.then(() => save(kv, input));
  chain = run.catch(() => undefined);
  return run;
}

async function save(kv: KV, input: ValueInput): Promise<{ value: number | string | boolean; edit: ValueEdit | null }> {
  const block = CONTENT_BLOCKS.find((entry) => entry.key === input.block);
  if (!block) throw new ContentError('هذا القسم غير موجود');
  const base = await baseOf(kv, block);
  const current = at(base, input.path);
  const lastSegment = input.path.split('.').pop() ?? '';
  const kind = kindOf(lastSegment, current);
  if (!kind || current === undefined) throw new ContentError('هذه القيمة غير موجودة في المحتوى');
  const seed = at(block.seed, input.path);
  const next = input.value === null ? seed : input.value;
  if (typeof next !== typeof current) throw new ContentError('نوع القيمة غير مطابق');
  const problem = valueProblem(kind, next as number | string | boolean);
  if (problem) throw new ContentError(problem);
  const doc = withValue(base, input.path, next as number | string | boolean);
  if (isRecord(doc) && typeof doc.updatedAt === 'string') doc.updatedAt = new Date().toISOString();
  await kv.set(block.storeKey, doc);
  const edits = (await kv.get<EditsDoc>(VALUE_EDITS_KEY)) ?? {};
  const key = editKey(block.key, input.path);
  let edit: ValueEdit | null = null;
  if (next === seed) delete edits[key];
  else {
    edit = { by: input.by, at: new Date().toISOString() };
    edits[key] = edit;
  }
  await kv.set(VALUE_EDITS_KEY, edits);
  return { value: next as number | string | boolean, edit };
}

function valueProblem(kind: ValueKind, value: number | string | boolean): string | null {
  if (kind === 'number' && typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 100_000_000) return 'رقم غير صالح';
    return null;
  }
  if (kind === 'url' && typeof value === 'string') return isUrl(value) && value.length <= 500 ? null : 'اكتب رابطًا يبدأ بـ https://';
  if (kind === 'phone' && typeof value === 'string') return isPhone(value) ? null : 'اكتب الرقم بصيغة دولية مثل +966500000000';
  if (kind === 'switch' && typeof value === 'boolean') return null;
  return 'نوع القيمة غير مطابق';
}

/** A copy of the document with one leaf replaced; lists keep their rows (items found by their name). */
function withValue(node: unknown, path: string, value: number | string | boolean): unknown {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return value;
  const inner = (child: unknown): unknown => (rest.length === 0 ? value : withValue(child, rest.join('.'), value));
  if (Array.isArray(node)) return node.map((item, index) => (nameOf(item, index) === head ? inner(item) : item));
  if (isRecord(node)) return { ...node, [head]: inner(node[head]) };
  return node;
}

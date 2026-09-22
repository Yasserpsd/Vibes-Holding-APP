import { useState } from 'react';

import { api } from '../api';
import type { ContentList, WordingList } from '../types';
import { Chips } from '../ui';
import { Values } from './Values';
import { WordingEditor, type WordingSave } from './Wording';

/** The editor's key of one content text: the block and the path inside it (a path never carries «|»). */
const keyOf = (block: string, path: string) => `${block}|${path}`;

const toWordingList = (list: ContentList): WordingList => ({
  groups: list.blocks,
  items: list.items.map((item) => ({ key: keyOf(item.block, item.path), group: item.block, ar: item.ar, en: item.en, arEdit: item.arEdit, enEdit: item.enEdit, placeholders: [] })),
  edited: list.edited,
});

const load = () => api.content().then(toWordingList);
const save: WordingSave = ({ lang, key, value }) => {
  const [block, ...path] = key.split('|');
  return api.saveContent({ lang, block: block ?? '', path: path.join('|'), value });
};

type Tab = 'texts' | 'values';
const TABS: { value: Tab; label: string }[] = [
  { value: 'texts', label: 'النصوص' },
  { value: 'values', label: 'القيم والأسعار' },
];

/**
 * «محتوى التطبيق»: the marketing content the server sends the app, block by block (home, membership,
 * services, golden projects, HQ, about, videos). «النصوص» edits every text in both languages (M27 stage 3);
 * «القيم والأسعار» (M33) edits the prices, links, phone numbers, order numbers and switches of the same blocks.
 * An edit reaches open apps within seconds, and «رجوع للنص الأصلي» undoes it.
 */
export function Content() {
  const [tab, setTab] = useState<Tab>('texts');
  return (
    <div className="stack">
      <Chips label="ماذا تعدّل" options={TABS} value={tab} onChange={setTab} />
      {tab === 'texts' ? (
        <WordingEditor title="محتوى التطبيق" hint="نصوص الشاشات التي يرسلها الخادم للتطبيق (الرئيسية، العضوية، الخدمات، المشاريع الذهبية، المقر، عن النادي، الفيديو) بالعربية وبالإنجليزية. الأسعار والروابط والأرقام في تبويب «القيم والأسعار»." groupLabel="القسم" allLabel="كل الأقسام" maxLength={2000} load={load} save={save} />
      ) : (
        <Values />
      )}
    </div>
  );
}

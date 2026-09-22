import { api } from '../api';
import type { ContentList, WordingList } from '../types';
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

/**
 * «محتوى التطبيق» (M27 stage 3): the marketing content the server sends the app, block by block (home, membership,
 * services, golden projects, HQ, about, videos), in both languages. Prices, links, phone numbers and times are not
 * texts and are not listed here. An edit reaches open apps within seconds, and «رجوع للنص الأصلي» undoes it.
 */
export function Content() {
  return <WordingEditor title="محتوى التطبيق" hint="نصوص الشاشات التي يرسلها الخادم للتطبيق (الرئيسية، العضوية، الخدمات، المشاريع الذهبية، المقر، عن النادي، الفيديو) بالعربية وبالإنجليزية. الأسعار والروابط والأرقام ليست نصوصًا هنا." groupLabel="القسم" allLabel="كل الأقسام" maxLength={2000} load={load} save={save} />;
}

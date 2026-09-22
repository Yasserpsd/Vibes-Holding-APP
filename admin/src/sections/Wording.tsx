import { useMemo, useState } from 'react';

import { api } from '../api';
import { formatDateTime } from '../format';
import type { WordingItem, WordingLang, WordingList } from '../types';
import { Async, Chips, Pill, SearchBox, SectionHead, messageOf, sessionOver, useLoad, useShell, type ChipOption } from '../ui';

const LANGS: ChipOption<WordingLang>[] = [
  { value: 'ar', label: 'النسخة العربية' },
  { value: 'en', label: 'النسخة الإنجليزية' },
];

const shownText = (item: WordingItem, lang: WordingLang) => (lang === 'ar' ? (item.arEdit?.value ?? item.ar) : (item.enEdit?.value ?? item.en));
const folded = (text: string) => text.toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا');

export type WordingSave = (input: { lang: WordingLang; key: string; value: string | null }) => Promise<unknown>;

/**
 * «نصوص التطبيق»: every text of the app as the member reads it, screen by screen, in both versions. The owner changes
 * the wording of a text and the app shows it within seconds, with no update. Edit only: nothing is deleted or added,
 * and the save refuses an empty text or wording the club does not use.
 */
export function Wording() {
  return <WordingEditor title="نصوص التطبيق" hint="غيّر صياغة أي نص يراه العضو في التطبيق، بالعربية أو بالإنجليزية. يظهر التعديل في التطبيق خلال ثوانٍ." groupLabel="الشاشة" allLabel="كل الشاشات" maxLength={800} load={api.strings} save={api.saveString} />;
}

type EditorProps = { title: string; hint: string; groupLabel: string; allLabel: string; maxLength: number; load: () => Promise<WordingList>; save: WordingSave };

/** The list, the chips and the inline edit, shared by «نصوص التطبيق» and «محتوى التطبيق» (sections/Content.tsx). */
export function WordingEditor({ title, hint, groupLabel, allLabel, maxLength, load, save }: EditorProps) {
  const shell = useShell();
  const state = useLoad(load, [load]);
  const [lang, setLang] = useState<WordingLang>('ar');
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const data = state.data;
  const groups: ChipOption<string>[] = useMemo(
    () => [{ value: 'all', label: allLabel, count: data?.items.length ?? null }, ...(data?.groups ?? []).map((entry) => ({ value: entry.key, label: entry.label, count: entry.count }))],
    [allLabel, data],
  );
  const rows = useMemo(() => {
    const needle = folded(search.trim());
    return (data?.items ?? []).filter((item) => {
      if (group !== 'all' && item.group !== group) return false;
      if (onlyEdited && !(lang === 'ar' ? item.arEdit : item.enEdit)) return false;
      return !needle || folded(`${item.ar} ${item.en} ${item.arEdit?.value ?? ''} ${item.enEdit?.value ?? ''} ${item.key}`).includes(needle);
    });
  }, [data, group, lang, onlyEdited, search]);

  return (
    <>
      <SectionHead title={title} hint={hint} onReload={state.reload} busy={state.loading} />
      <Async state={state} rows={8}>
        {(loaded) => (
          <div className="stack">
            <Chips label="النسخة" options={LANGS.map((option) => ({ ...option, count: loaded.edited[option.value] }))} value={lang} onChange={setLang} />
            <Chips label={groupLabel} options={groups} value={group} onChange={setGroup} />
            <div className="row">
              <SearchBox value={search} onChange={setSearch} placeholder="ابحث عن كلمة كما تظهر في التطبيق" />
              <label className="check">
                <input type="checkbox" checked={onlyEdited} onChange={(event) => setOnlyEdited(event.target.checked)} />
                المعدَّل فقط
              </label>
            </div>
            {rows.length === 0 ? <p className="muted">لا يوجد نص بهذه الكلمة.</p> : null}
            <div className="wording-list">
              {rows.map((item) => (
                <WordingRow
                  key={`${item.key}:${lang}`}
                  item={item}
                  lang={lang}
                  maxLength={maxLength}
                  open={open === item.key}
                  onToggle={() => setOpen(open === item.key ? null : item.key)}
                  save={(value) => save({ lang, key: item.key, value })}
                  onSaved={(text) => {
                    shell.notify('ok', text);
                    setOpen(null);
                    state.reload();
                  }}
                  onFailed={(failure) => (sessionOver(failure) ? shell.signOut() : shell.notify('error', messageOf(failure)))}
                />
              ))}
            </div>
          </div>
        )}
      </Async>
    </>
  );
}

type RowProps = {
  item: WordingItem;
  lang: WordingLang;
  maxLength: number;
  open: boolean;
  onToggle: () => void;
  save: (value: string | null) => Promise<unknown>;
  onSaved: (text: string) => void;
  onFailed: (failure: unknown) => void;
};

function WordingRow({ item, lang, maxLength, open, onToggle, save, onSaved, onFailed }: RowProps) {
  const edit = lang === 'ar' ? item.arEdit : item.enEdit;
  const own = lang === 'ar' ? item.ar : item.en;
  const other = shownText(item, lang === 'ar' ? 'en' : 'ar');
  const [draft, setDraft] = useState(edit?.value ?? own);
  const [busy, setBusy] = useState(false);
  const text = draft.trim();
  const lost = item.placeholders.filter((name) => !text.includes(name));
  const problem = !text ? 'النص لا يُترك فارغًا: غيّر الصياغة فقط.' : lost.length > 0 ? `أبقِ ${lost.join(' و ')} كما هي: التطبيق يضع مكانها قيمة.` : null;
  const unchanged = text === (edit?.value ?? own);

  const submit = (value: string | null) => {
    setBusy(true);
    save(value)
      .then(() => onSaved(value === null ? 'رجع النص إلى صياغته الأصلية.' : 'حُفظت الصياغة الجديدة، وتظهر في التطبيق خلال ثوانٍ.'))
      .catch(onFailed)
      .finally(() => setBusy(false));
  };

  return (
    <article className={open ? 'wording on' : 'wording'}>
      <button type="button" className="wording-head" onClick={onToggle} aria-expanded={open}>
        <span className="wording-text" dir={lang === 'en' ? 'ltr' : 'rtl'}>
          {edit?.value ?? own}
        </span>
        {edit ? <Pill tone="gold">معدَّل</Pill> : null}
      </button>
      {open ? (
        <form
          className="wording-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!problem && !unchanged && !busy) submit(text);
          }}
        >
          <label>
            الصياغة في {lang === 'ar' ? 'النسخة العربية' : 'النسخة الإنجليزية'}
            <textarea value={draft} dir={lang === 'en' ? 'ltr' : 'rtl'} rows={Math.min(12, Math.max(2, Math.ceil(draft.length / 60)))} maxLength={maxLength} onChange={(event) => setDraft(event.target.value)} />
          </label>
          {problem ? <p className="error">{problem}</p> : null}
          {item.placeholders.length > 0 ? <p className="muted">ما بين القوسين {item.placeholders.map((name) => <bdi key={name} dir="ltr">{name} </bdi>)}يضع التطبيق مكانه قيمة (رقم أو اسم): أبقه كما هو.</p> : null}
          {edit ? (
            <p className="muted">
              النص الأصلي: <bdi dir={lang === 'en' ? 'ltr' : 'rtl'}>{own}</bdi> · عدّله {edit.by || 'مدير'} في {formatDateTime(edit.at)}
            </p>
          ) : null}
          <p className="muted">
            في {lang === 'ar' ? 'النسخة الإنجليزية' : 'النسخة العربية'}: <bdi dir={lang === 'ar' ? 'ltr' : 'rtl'}>{other}</bdi>
          </p>
          <div className="row">
            <button className="primary" type="submit" disabled={Boolean(problem) || unchanged || busy}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ الصياغة'}
            </button>
            {edit ? (
              <button type="button" disabled={busy} onClick={() => submit(null)}>
                رجوع للنص الأصلي
              </button>
            ) : null}
            <button type="button" className="link" disabled={busy} onClick={onToggle}>
              إلغاء
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

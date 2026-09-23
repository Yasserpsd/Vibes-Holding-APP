import { useEffect, useRef, useState } from 'react';

import { api, uploadFile, type Profile, type ProfileFields, type ProfilesConfig } from '../api';
import { formatDateTime } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, Sheet, useLoad, useShell, type Tone } from '../ui';

/** M11 «شخصية ومسيرة»: review the members' applications, edit or enter profiles, order the public list. */

const EMPTY: ProfileFields = { name: '', title: '', company: '', bio: '', milestones: [], links: [], photo: null };

function statusOf(row: Profile): { label: string; tone: Tone } {
  if (row.draft) return { label: 'تعديل بانتظار المراجعة', tone: 'gold' };
  if (row.status === 'pending') return { label: 'بانتظار الاعتماد', tone: 'gold' };
  if (row.status === 'approved') return { label: 'معتمد وظاهر', tone: 'ok' };
  return { label: 'مرفوض', tone: 'muted' };
}

const toLines = (list: string[]) => list.join('\n');
const fromLines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
/** One link per line: «العنوان | https://…» or the URL alone. */
const linksToText = (links: ProfileFields['links']) => links.map((link) => (link.label ? `${link.label} | ${link.url}` : link.url)).join('\n');
function linksFromText(text: string): ProfileFields['links'] {
  return fromLines(text)
    .map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      return parts.length > 1 ? { label: parts[0] ?? '', url: parts.slice(1).join('|') } : { label: '', url: parts[0] ?? '' };
    })
    .filter((link) => link.url);
}

type EditorState = { row: Profile | null; fields: ProfileFields; milestonesText: string; linksText: string; order: number };

export function People() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.profiles(), []);
  const [config, setConfig] = useState<ProfilesConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => setConfig(state.data?.config ?? null), [state.data]);
  const waiting = state.data?.profiles.filter((row) => row.status === 'pending' || row.draft).length ?? 0;

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  async function saveConfig() {
    if (!config || savingConfig) return;
    setSavingConfig(true);
    try {
      await api.profilesConfig(config);
      notify('ok', 'حُفظت مقدمة القسم.');
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setSavingConfig(false);
    }
  }

  function open(row: Profile | null) {
    const fields = row ? row.fields : EMPTY;
    setEditor({ row, fields, milestonesText: toLines(fields.milestones), linksText: linksToText(fields.links), order: row?.order ?? 100 });
  }

  async function save() {
    if (!editor || busy) return;
    const fields: ProfileFields = { ...editor.fields, milestones: fromLines(editor.milestonesText), links: linksFromText(editor.linksText) };
    setBusy(true);
    try {
      if (editor.row) await api.updateProfile(editor.row.id, { ...fields, order: editor.order });
      else await api.createProfile({ contactId: null, fields });
      notify('ok', 'حُفظ الملف.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function decide(row: Profile, action: 'approve' | 'reject') {
    let note = '';
    if (action === 'reject') {
      note = window.prompt(`اكتب للعضو «${row.fields.name}» سبب الرفض (يظهر له في التطبيق):`)?.trim() ?? '';
      if (!note) return;
    } else if (!window.confirm(row.draft ? `اعتماد تعديل «${row.fields.name}»؟ الكلمات الجديدة تحل محل الظاهرة.` : `اعتماد ملف «${row.fields.name}»؟ سيظهر لكل مستخدمي التطبيق.`)) {
      return;
    }
    setBusy(true);
    try {
      await api.decideProfile(row.id, action, note);
      notify('ok', action === 'approve' ? 'اعتُمد الملف وأُخطر العضو.' : 'سُجّل الرفض وأُخطر العضو بالسبب.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Profile) {
    if (!window.confirm(`حذف ملف «${row.fields.name}» نهائيًا؟`)) return;
    setBusy(true);
    try {
      await api.deleteProfile(row.id);
      notify('ok', 'حُذف الملف.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file || !editor || uploading) return;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file);
      if (uploaded.kind !== 'image') throw new Error('اختر صورة.');
      setEditor((current) => (current ? { ...current, fields: { ...current.fields, photo: uploaded.url } } : current));
    } catch (failure) {
      fail(failure);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const edit = (patch: Partial<ProfileFields>) => setEditor((current) => (current ? { ...current, fields: { ...current.fields, ...patch } } : current));

  return (
    <>
      <SectionHead title="شخصية ومسيرة" hint={state.data ? `بانتظار المراجعة: ${waiting}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        يقدّم العضو ملفه من التطبيق (عضوية فعّالة فقط) فيصل هنا للمراجعة: اعتماد فيظهر في قسم «شخصية ومسيرة»، أو رفض بسبب يقرؤه العضو. تعديل العضو
        لملفه المعتمد ينتظر هنا أيضًا والنسخة المعتمدة تبقى الظاهرة. الإدارة تعدّل أي ملف وتضيف الصورة، وتدخل ملفات يدويًا، وترتب الظهور (الأصغر أولًا).
      </p>
      <Async state={state} rows={5}>
        {(data) => (
          <div className="stack">
            {config ? (
              <form className="card editor" onSubmit={(event) => { event.preventDefault(); void saveConfig(); }}>
                <label>
                  مقدمة القسم في التطبيق (جملة المالك)
                  <textarea rows={2} maxLength={500} value={config.intro} onChange={(event) => setConfig({ intro: event.target.value })} />
                </label>
                <div className="row-actions">
                  <button type="submit" disabled={savingConfig}>{savingConfig ? 'جارٍ الحفظ…' : 'حفظ المقدمة'}</button>
                  <button type="button" className="ghost" onClick={() => open(null)}>+ إضافة ملف يدويًا</button>
                </div>
              </form>
            ) : null}
            {data.profiles.length === 0 ? (
              <p className="state-card empty">لا توجد ملفات بعد — أول طلب من التطبيق يظهر هنا.</p>
            ) : (
              <DataTable<Profile>
                caption="ملفات شخصية ومسيرة"
                rows={data.profiles}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'who',
                    label: 'الشخصية',
                    cell: (row) => (
                      <>
                        {row.contactId ? <MemberLink id={row.contactId} name={row.fields.name} /> : row.fields.name}
                        {row.memberNumber ? <> <bdi dir="ltr" className="num">{row.memberNumber}</bdi></> : null}
                      </>
                    ),
                  },
                  { key: 'title', label: 'الوظيفة والشركة', cell: (row) => [row.fields.title, row.fields.company].filter(Boolean).join(' · ') || '—' },
                  { key: 'photo', label: 'الصورة', cell: (row) => (row.fields.photo ? <Pill tone="ok">موجودة</Pill> : <Pill tone="muted">بلا صورة</Pill>) },
                  { key: 'state', label: 'الحالة', cell: (row) => { const status = statusOf(row); return <Pill tone={status.tone}>{status.label}</Pill>; } },
                  { key: 'order', label: 'الترتيب', cell: (row) => <bdi dir="ltr" className="num">{row.order}</bdi> },
                  { key: 'at', label: 'آخر تحديث', cell: (row) => formatDateTime(row.updatedAt) },
                  {
                    key: 'actions',
                    label: '',
                    cell: (row) => (
                      <span className="row-actions">
                        <button type="button" onClick={() => open(row)}>فتح</button>
                        {row.status === 'pending' || row.draft ? (
                          <button type="button" disabled={busy} onClick={() => void decide(row, 'approve')}>اعتماد</button>
                        ) : null}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </div>
        )}
      </Async>

      {editor ? (
        <Sheet title={editor.row ? `ملف «${editor.row.fields.name}»` : 'ملف جديد'} onClose={() => setEditor(null)}>
          <div className="stack">
            {editor.row?.draft ? (
              <div className="card">
                <strong>تعديل العضو بانتظار المراجعة</strong>
                <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {`النبذة: ${editor.row.draft.bio}\nالمحطات: ${editor.row.draft.milestones.join(' · ')}${editor.row.draft.links.length ? `\nالروابط: ${editor.row.draft.links.map((link) => link.url).join(' · ')}` : ''}`}
                </p>
                <div className="row-actions">
                  <button type="button" disabled={busy} onClick={() => void decide(editor.row as Profile, 'approve')}>اعتماد التعديل</button>
                  <button type="button" className="ghost" disabled={busy} onClick={() => void decide(editor.row as Profile, 'reject')}>رفض التعديل بسبب</button>
                </div>
              </div>
            ) : null}
            <form className="card editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label>
                الاسم
                <input value={editor.fields.name} maxLength={80} onChange={(event) => edit({ name: event.target.value })} required />
              </label>
              <label>
                الوظيفة أو المنصب
                <input value={editor.fields.title} maxLength={80} onChange={(event) => edit({ title: event.target.value })} required />
              </label>
              <label>
                الشركة (اختياري)
                <input value={editor.fields.company} maxLength={120} onChange={(event) => edit({ company: event.target.value })} />
              </label>
              <label>
                النبذة
                <textarea rows={5} maxLength={1200} value={editor.fields.bio} onChange={(event) => edit({ bio: event.target.value })} required />
              </label>
              <label>
                محطات المسيرة (سطر لكل محطة)
                <textarea rows={4} value={editor.milestonesText} onChange={(event) => setEditor({ ...editor, milestonesText: event.target.value })} />
              </label>
              <label>
                الروابط (سطر لكل رابط: «العنوان | الرابط» أو الرابط وحده)
                <textarea rows={3} dir="ltr" value={editor.linksText} onChange={(event) => setEditor({ ...editor, linksText: event.target.value })} />
              </label>
              <label>
                الصورة الشخصية
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void pickPhoto(event.target.files?.[0])} />
              </label>
              {uploading ? <p className="muted">جارٍ رفع الصورة…</p> : null}
              {editor.fields.photo ? (
                <div className="row-actions">
                  <img src={editor.fields.photo} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 12 }} referrerPolicy="no-referrer" />
                  <button type="button" className="ghost" onClick={() => edit({ photo: null })}>إزالة الصورة</button>
                </div>
              ) : null}
              {editor.row ? (
                <label>
                  ترتيب الظهور (الأصغر أولًا)
                  <input type="number" min={0} max={9999} value={editor.order} onChange={(event) => setEditor({ ...editor, order: Number(event.target.value) })} />
                </label>
              ) : null}
              <div className="row-actions">
                <button type="submit" disabled={busy || uploading}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
                {editor.row && editor.row.status === 'pending' ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => void decide(editor.row as Profile, 'approve')}>اعتماد</button>
                    <button type="button" className="ghost" disabled={busy} onClick={() => void decide(editor.row as Profile, 'reject')}>رفض بسبب</button>
                  </>
                ) : null}
                {editor.row ? (
                  <button type="button" className="ghost danger" disabled={busy} onClick={() => void remove(editor.row as Profile)}>حذف</button>
                ) : null}
              </div>
              {editor.row?.note ? <p className="muted">آخر ملاحظة رفض: {editor.row.note}</p> : null}
            </form>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

import { useRef, useState } from 'react';

import { api, uploadFile, type Partner, type PartnerInput, type PartnersSettings, type PromoRecord } from '../api';
import { formatDateTime } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, Sheet, useLoad, useShell } from '../ui';

/**
 * M68 «شركاؤنا»: the partners program. The owner controls everything from here — the partner's logo,
 * name, description, discount line, the buy link, the order and the visibility, plus the program's
 * wording in the app. The lookup box answers a partner's question: whose promo code is this?
 */

const EMPTY: PartnerInput = { name: '', nameEn: '', description: '', descriptionEn: '', discount: '', discountEn: '', ribbon: '', ribbonEn: '', url: '', whatsapp: '', logoUrl: null, order: 100, visible: true };

type EditorState = { row: Partner | null; fields: PartnerInput };

export function Partners() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.partners(), []);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [settings, setSettings] = useState<PartnersSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lookup, setLookup] = useState('');
  const [looked, setLooked] = useState<{ code: string; promo: PromoRecord | null } | null>(null);
  const [looking, setLooking] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  async function save() {
    if (!editor || busy) return;
    if (!editor.fields.name?.trim() || !editor.fields.url?.trim()) {
      notify('error', 'اسم الشريك ورابطه مطلوبان.');
      return;
    }
    setBusy(true);
    try {
      if (editor.row) await api.updatePartner(editor.row.id, editor.fields);
      else await api.createPartner(editor.fields);
      notify('ok', 'حُفظ الشريك وظهر التحديث في التطبيق.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Partner) {
    if (!window.confirm(`حذف شريك «${row.name}» نهائيًا؟ يختفي من التطبيق فورًا.`)) return;
    setBusy(true);
    try {
      await api.deletePartner(row.id);
      notify('ok', 'حُذف الشريك.');
      setEditor(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: Partner) {
    try {
      await api.updatePartner(row.id, { visible: !row.visible });
      state.reload();
    } catch (failure) {
      fail(failure);
    }
  }

  async function saveSettings() {
    if (!settings || busy) return;
    setBusy(true);
    try {
      await api.savePartnersSettings(settings);
      notify('ok', 'حُفظت نصوص البرنامج.');
      setSettings(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function pickLogo(file: File | undefined) {
    if (!file || !editor || uploading) return;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file);
      if (uploaded.kind !== 'image') throw new Error('اختر صورة للوجو.');
      setEditor((current) => (current ? { ...current, fields: { ...current.fields, logoUrl: uploaded.url } } : current));
    } catch (failure) {
      fail(failure);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function findCode() {
    const code = lookup.trim();
    if (!code || looking) return;
    setLooking(true);
    try {
      const result = await api.promoLookup(code);
      setLooked({ code: code.toUpperCase(), promo: result.promo });
    } catch (failure) {
      fail(failure);
    } finally {
      setLooking(false);
    }
  }

  const edit = (patch: Partial<PartnerInput>) => setEditor((current) => (current ? { ...current, fields: { ...current.fields, ...patch } } : current));

  return (
    <>
      <SectionHead title="شركاؤنا" hint={state.data ? `الشركاء: ${state.data.partners.length}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        برنامج شركاء النادي: كل شريك هنا يظهر في التطبيق بلوجو واسم ووصف وسطر الخصم وزر يفتح رابط الشراء. كل عضو مشترك يحمل برومو كودًا واحدًا
        ثابتًا (5 حروف وأرقام، أول حرف من فئته) يستخدمه عند جميع الشركاء، ويظهر له في شاشة «شركاؤنا» وعلى كارت عضويته. الكود يصدر لأول مرة عندما
        يفتح العضو الشاشة بعضوية فعّالة.
      </p>

      <div className="card editor">
        <label>
          كود مين ده؟ — الصق البرومو كود الذي سأل عنه الشريك
          <input dir="ltr" value={lookup} maxLength={10} placeholder="N7K2M" onChange={(event) => setLookup(event.target.value)} onKeyDown={(event) => (event.key === 'Enter' ? void findCode() : undefined)} />
        </label>
        <div className="row-actions">
          <button type="button" disabled={looking || !lookup.trim()} onClick={() => void findCode()}>{looking ? 'جارٍ البحث…' : 'بحث'}</button>
          {looked ? (
            looked.promo ? (
              <span>
                <bdi dir="ltr" className="num">{looked.promo.code}</bdi> — <MemberLink id={looked.promo.contactId} name={looked.promo.name} /> · {looked.promo.personaLabel} ·{' '}
                <bdi dir="ltr" className="num">{looked.promo.cardNumber}</bdi> · صدر {formatDateTime(looked.promo.issuedAt)}
              </span>
            ) : (
              <span className="muted">لا يوجد عضو بهذا الكود ({looked.code}).</span>
            )
          ) : null}
        </div>
      </div>

      <Async state={state} rows={4}>
        {(data) => (
          <div className="stack">
            <div className="row-actions">
              <button type="button" onClick={() => setEditor({ row: null, fields: { ...EMPTY } })}>+ إضافة شريك</button>
              <button type="button" className="ghost" onClick={() => setSettings(data.settings)}>نصوص البرنامج في التطبيق</button>
            </div>
            {data.partners.length === 0 ? (
              <p className="state-card empty">لا يوجد شركاء بعد — أضف أول شريك وسيظهر في التطبيق فورًا.</p>
            ) : (
              <DataTable<Partner>
                caption="شركاء النادي"
                rows={data.partners}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'who',
                    label: 'الشريك',
                    cell: (row) => (
                      <span className="row-actions">
                        {row.logoUrl ? <img src={row.logoUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 8, background: '#fff' }} referrerPolicy="no-referrer" /> : null}
                        <span>{row.name}</span>
                      </span>
                    ),
                  },
                  { key: 'discount', label: 'الخصم', cell: (row) => row.discount || '—' },
                  { key: 'ribbon', label: 'الريبون', cell: (row) => (row.ribbon ? <Pill tone="ok">{row.ribbon}</Pill> : '—') },
                  {
                    key: 'url',
                    label: 'الرابط',
                    cell: (row) => (
                      <a href={row.url} target="_blank" rel="noreferrer noopener" dir="ltr">
                        {row.url.replace(/^https?:\/\//, '').slice(0, 40)}
                      </a>
                    ),
                  },
                  { key: 'order', label: 'الترتيب', cell: (row) => <bdi dir="ltr" className="num">{row.order}</bdi> },
                  { key: 'state', label: 'الحالة', cell: (row) => (row.visible ? <Pill tone="ok">ظاهر في التطبيق</Pill> : <Pill tone="muted">مخفي</Pill>) },
                  {
                    key: 'actions',
                    label: '',
                    cell: (row) => (
                      <span className="row-actions">
                        <button type="button" onClick={() => setEditor({ row, fields: { name: row.name, nameEn: row.nameEn, description: row.description, descriptionEn: row.descriptionEn, discount: row.discount, discountEn: row.discountEn, ribbon: row.ribbon ?? '', ribbonEn: row.ribbonEn ?? '', url: row.url, whatsapp: row.whatsapp ?? '', logoUrl: row.logoUrl, order: row.order, visible: row.visible } })}>فتح</button>
                        <button type="button" className="ghost" disabled={busy} onClick={() => void toggle(row)}>{row.visible ? 'إخفاء' : 'إظهار'}</button>
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
        <Sheet title={editor.row ? `شريك «${editor.row.name}»` : 'شريك جديد'} onClose={() => setEditor(null)}>
          <form className="card editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>
              اسم الشريك
              <input value={editor.fields.name ?? ''} maxLength={120} onChange={(event) => edit({ name: event.target.value })} required />
            </label>
            <label>
              الاسم بالإنجليزية (اختياري — للنسخة الإنجليزية من التطبيق)
              <input dir="ltr" value={editor.fields.nameEn ?? ''} maxLength={120} onChange={(event) => edit({ nameEn: event.target.value })} />
            </label>
            <label>
              الوصف
              <textarea rows={3} maxLength={1000} value={editor.fields.description ?? ''} onChange={(event) => edit({ description: event.target.value })} />
            </label>
            <label>
              الوصف بالإنجليزية (اختياري)
              <textarea dir="ltr" rows={3} maxLength={1000} value={editor.fields.descriptionEn ?? ''} onChange={(event) => edit({ descriptionEn: event.target.value })} />
            </label>
            <label>
              سطر الخصم (يظهر على كارت الشريك، مثال: «خصم 20% لأعضاء النادي بالبرومو كود»)
              <input value={editor.fields.discount ?? ''} maxLength={200} onChange={(event) => edit({ discount: event.target.value })} />
            </label>
            <label>
              سطر الخصم بالإنجليزية (اختياري)
              <input dir="ltr" value={editor.fields.discountEn ?? ''} maxLength={200} onChange={(event) => edit({ discountEn: event.target.value })} />
            </label>
            <label>
              الريبون — سطر قصير يظهر على شريط ذهبي أعلى الكارت (مثال: «خصم 50%») — اتركه فارغًا بلا شريط
              <input value={editor.fields.ribbon ?? ''} maxLength={80} onChange={(event) => edit({ ribbon: event.target.value })} />
            </label>
            <label>
              الريبون بالإنجليزية (اختياري)
              <input dir="ltr" value={editor.fields.ribbonEn ?? ''} maxLength={80} onChange={(event) => edit({ ribbonEn: event.target.value })} />
            </label>
            <label>
              رقم واتساب الشريك — زر الكارت يصبح «تواصل مباشر» ويفتح واتساب على هذا الرقم. اتركه فارغًا ليفتح الزر رابط الشراء
              <input dir="ltr" value={editor.fields.whatsapp ?? ''} maxLength={30} placeholder="+9665XXXXXXXX" onChange={(event) => edit({ whatsapp: event.target.value })} />
            </label>
            <label>
              رابط الشراء — الصفحة التي يفتحها زر «الشراء من الشريك» عندما لا يوجد رقم واتساب
              <input dir="ltr" type="url" value={editor.fields.url ?? ''} maxLength={500} placeholder="https://…" onChange={(event) => edit({ url: event.target.value })} required />
            </label>
            <label>
              لوجو الشريك
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void pickLogo(event.target.files?.[0])} />
            </label>
            {uploading ? <p className="muted">جارٍ رفع اللوجو…</p> : null}
            {editor.fields.logoUrl ? (
              <div className="row-actions">
                <img src={editor.fields.logoUrl} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 12, background: '#fff' }} referrerPolicy="no-referrer" />
                <button type="button" className="ghost" onClick={() => edit({ logoUrl: null })}>إزالة اللوجو</button>
              </div>
            ) : null}
            <label>
              ترتيب الظهور (الأصغر أولًا)
              <input type="number" min={0} max={9999} value={editor.fields.order ?? 100} onChange={(event) => edit({ order: Number(event.target.value) })} />
            </label>
            <label className="row-actions">
              <input type="checkbox" checked={editor.fields.visible ?? true} onChange={(event) => edit({ visible: event.target.checked })} />
              ظاهر في التطبيق
            </label>
            <div className="row-actions">
              <button type="submit" disabled={busy || uploading}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
              {editor.row ? (
                <button type="button" className="ghost danger" disabled={busy} onClick={() => void remove(editor.row as Partner)}>حذف</button>
              ) : null}
            </div>
          </form>
        </Sheet>
      ) : null}

      {settings ? (
        <Sheet title="نصوص البرنامج في التطبيق" onClose={() => setSettings(null)}>
          <form className="card editor" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
            <label>
              عنوان الشاشة
              <input value={settings.title} maxLength={120} onChange={(event) => setSettings({ ...settings, title: event.target.value })} />
            </label>
            <label>
              مقدمة البرنامج (تشرح للعضو فكرة الشركاء والبرومو كود)
              <textarea rows={4} maxLength={1000} value={settings.intro} onChange={(event) => setSettings({ ...settings, intro: event.target.value })} />
            </label>
            <label>
              عنوان بطاقة الكود
              <input value={settings.codeTitle} maxLength={120} onChange={(event) => setSettings({ ...settings, codeTitle: event.target.value })} />
            </label>
            <label>
              شرح استخدام الكود
              <textarea rows={3} maxLength={500} value={settings.codeHint} onChange={(event) => setSettings({ ...settings, codeHint: event.target.value })} />
            </label>
            <label>
              نص غير المشترك (من ليست له عضوية فعّالة)
              <textarea rows={3} maxLength={500} value={settings.membersOnlyText} onChange={(event) => setSettings({ ...settings, membersOnlyText: event.target.value })} />
            </label>
            <details>
              <summary>النصوص الإنجليزية (اختياري)</summary>
              <label>
                Title
                <input dir="ltr" value={settings.titleEn} maxLength={120} onChange={(event) => setSettings({ ...settings, titleEn: event.target.value })} />
              </label>
              <label>
                Intro
                <textarea dir="ltr" rows={4} maxLength={1000} value={settings.introEn} onChange={(event) => setSettings({ ...settings, introEn: event.target.value })} />
              </label>
              <label>
                Code card title
                <input dir="ltr" value={settings.codeTitleEn} maxLength={120} onChange={(event) => setSettings({ ...settings, codeTitleEn: event.target.value })} />
              </label>
              <label>
                Code hint
                <textarea dir="ltr" rows={3} maxLength={500} value={settings.codeHintEn} onChange={(event) => setSettings({ ...settings, codeHintEn: event.target.value })} />
              </label>
              <label>
                Non-member text
                <textarea dir="ltr" rows={3} maxLength={500} value={settings.membersOnlyTextEn} onChange={(event) => setSettings({ ...settings, membersOnlyTextEn: event.target.value })} />
              </label>
            </details>
            <div className="row-actions">
              <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ النصوص'}</button>
            </div>
          </form>
        </Sheet>
      ) : null}
    </>
  );
}

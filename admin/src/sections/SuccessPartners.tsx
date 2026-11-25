import { useState } from 'react';

import { api } from '../api';
import { formatDay, formatNumber } from '../format';
import type { ProjectRef, SuccessPartners } from '../types';
import { Async, Pill, SearchBox, useLoad, useShell } from '../ui';

/** M275 (owner, 2026-11-25): every Success Partner is tied to one Projects Bank project, and a project to one partner. */

const SHOWN = 40;

/** The way a name is typed in a search: hamza, taa marbuta, vowel marks and Arabic digits do not matter. */
const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    // taa marbuta -> haa, alef maqsura -> yaa (code points: these are not words for the dictionary).
    .replace(/ة/g, String.fromCharCode(0x0647))
    .replace(/ى/g, String.fromCharCode(0x064a))
    .replace(/[ً-ْـ]/g, '')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .trim();

export const projectName = (project: ProjectRef): string => (project.number ? `${project.title} (رقم المشروع: ${project.number})` : project.title);

/**
 * The partner's project, made to stand out (owner, 2026-11-25: «اسم المشروع المرتبط بيه ده مهم جدا لازم يبان») in the
 * membership's royal blue, or as a warning while there is none. Spans only: it also sits inside a list row's button.
 */
export function LinkedProject({ project }: { project: ProjectRef | null }) {
  return (
    <span className={project ? 'pp-card' : 'pp-card missing'}>
      <span className="pp-label">المشروع المرتبط</span>
      <strong className="pp-title">{project ? project.title : 'لم يُربط بمشروع بعد'}</strong>
      {project?.number ? <span className="pp-number">{`رقم المشروع: ${project.number}`}</span> : null}
    </span>
  );
}

/** The required choice of a grant or a change: search by name or number; a project another partner holds is locked. */
export function ProjectPicker({ value, current, onPick }: { value: ProjectRef | null; current: ProjectRef | null; onPick: (project: ProjectRef) => void }) {
  const state = useLoad(() => api.successPartners(), []);
  const [text, setText] = useState('');
  const words = plain(text).split(/\s+/).filter(Boolean);
  return (
    <div className="pp-picker">
      <strong>المشروع المرتبط (إلزامي)</strong>
      {value ? <p className="pp-chosen">{`المشروع المختار: ${projectName(value)}`}</p> : <p className="muted hint">اختر مشروعًا من بنك المشاريع. المشروع الواحد لا يرتبط إلا بشريك واحد.</p>}
      {/* Enter in the search box must not send the form behind it. */}
      <div onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}>
        <SearchBox value={text} onChange={setText} placeholder="ابحث باسم المشروع أو رقمه" />
      </div>
      <Async state={state} rows={3}>
        {({ projects }: SuccessPartners) => {
          const found = projects.filter((project) => {
            const hay = plain(`${project.number ?? ''} ${project.title}`);
            return words.every((word) => hay.includes(word));
          });
          if (projects.length === 0) return <p className="muted hint">بنك المشاريع غير متاح الآن، حاول بعد قليل.</p>;
          if (found.length === 0) return <p className="muted hint">لا يوجد مشروع يطابق البحث.</p>;
          return (
            <>
              <ul className="pp-list" role="list">
                {found.slice(0, SHOWN).map((project) => {
                  const mine = project.id === current?.id;
                  const taken = !mine && project.holder !== null;
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        className={value?.id === project.id ? 'pp-row on' : 'pp-row'}
                        aria-pressed={value?.id === project.id}
                        disabled={taken || mine}
                        onClick={() => onPick({ id: project.id, number: project.number, title: project.title })}
                      >
                        <span>{project.title}</span>
                        {project.number ? <small className="muted">{`رقم المشروع: ${project.number}`}</small> : null}
                        {mine ? <small>المشروع الحالي</small> : null}
                        {taken ? <small className="warn">{`مرتبط بشريك النجاح: ${project.holder?.name || `حساب رقم ${project.holder?.contactId}`}`}</small> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {found.length > SHOWN ? <p className="muted hint">{`المعروض ${formatNumber(SHOWN)} من ${formatNumber(found.length)} مشروعًا، ابحث بالاسم أو الرقم للوصول إلى غيرها.`}</p> : null}
            </>
          );
        }}
      </Async>
    </div>
  );
}

function PartnerList({ stamp }: { stamp: number }) {
  const { openMember } = useShell();
  const state = useLoad(() => api.successPartners(), [stamp]);
  return (
    <Async state={state} rows={4} empty={(data) => data.partners.length === 0} emptyText="لا يوجد شركاء نجاح حاليًا.">
      {({ partners }: SuccessPartners) => (
        <ul className="list">
          {partners.map((partner) => (
            <li key={partner.contactId}>
              <button type="button" className="list-row" onClick={() => openMember(partner.contactId)}>
                <span className="list-main pp-partner">
                  <strong>{partner.name || `حساب رقم ${partner.contactId}`}</strong>
                  <LinkedProject project={partner.project} />
                  <span className="muted">
                    {partner.phone ? <bdi dir="ltr">{partner.phone}</bdi> : null}
                    {partner.end ? <span>{` · تنتهي في ${formatDay(partner.end)}`}</span> : null}
                  </span>
                </span>
                <Pill tone={partner.project ? 'ok' : 'danger'}>{partner.project ? 'مرتبط' : 'يحتاج ربطًا'}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Async>
  );
}

/** The members section's list of who holds which project. Closed until asked for: it reads the whole registry. */
export function SuccessPartnersBlock({ stamp }: { stamp: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <div className="row">
        <h3>شركاء النجاح ومشاريعهم</h3>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'إخفاء القائمة' : 'عرض القائمة'}</button>
      </div>
      {open ? <PartnerList stamp={stamp} /> : null}
    </section>
  );
}

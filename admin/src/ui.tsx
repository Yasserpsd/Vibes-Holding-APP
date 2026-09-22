import { Component, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { ApiError } from './api';
import { formatNumber } from './format';
import type { AccountFilter } from './types';

export type SectionKey = 'home' | 'members' | 'payments' | 'cards' | 'tickets' | 'leads' | 'threads' | 'mail' | 'audit' | 'posts' | 'wording' | 'content';

/** What every section gets from the shell: leaving on a dead session, a passing notice, and moving between sections. */
export type Shell = {
  signOut: () => void;
  notify: (kind: 'ok' | 'error', text: string) => void;
  openMember: (contactId: number) => void;
  openMembers: (state: AccountFilter) => void;
  openSection: (section: SectionKey) => void;
  openThread: (contactId: number) => void;
};
export const ShellContext = createContext<Shell>({ signOut: () => undefined, notify: () => undefined, openMember: () => undefined, openMembers: () => undefined, openSection: () => undefined, openThread: () => undefined });
export const useShell = () => useContext(ShellContext);

/**
 * The session is over: 401, or the dashboard guard's own 403. The hub's 403 `not_admin` is not one of them: signing in
 * again would not change the hub's mind, so the section shows its message instead.
 */
export function sessionOver(failure: unknown): boolean {
  return failure instanceof ApiError && (failure.status === 401 || (failure.status === 403 && (failure.code === 'forbidden' || failure.code === 'otp_required')));
}

export const messageOf = (failure: unknown): string => (failure instanceof ApiError ? failure.message : 'حدث خطأ غير متوقع');
const toError = (failure: unknown): ApiError => (failure instanceof ApiError ? failure : new ApiError('حدث خطأ غير متوقع', 0, 'error'));

export type Loaded<T> = { data: T | null; error: ApiError | null; loading: boolean; reload: () => void };

/**
 * Loads one part of a section. While a reload runs the last answer stays on screen, so paging and searching never
 * flash; an older answer that arrives late is dropped.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const { signOut } = useShell();
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [turn, setTurn] = useState(0);
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const run = ++latest.current;
    setState((current) => ({ ...current, loading: true }));
    loader.current().then(
      (data) => run === latest.current && setState({ data, error: null, loading: false }),
      (failure: unknown) => {
        if (run !== latest.current) return;
        if (sessionOver(failure)) signOut();
        setState({ data: null, error: toError(failure), loading: false });
      },
    );
    // The caller lists what the request depends on; the loader itself is read through a ref.
  }, [...deps, turn, signOut]);

  const reload = useCallback(() => setTurn((value) => value + 1), []);
  return { ...state, reload };
}

/** The typed text, a moment after the owner stops typing. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9.5 20v-6h5v6',
  members: 'M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19M9.5 9.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM21 19v-1.5a4 4 0 0 0-3-3.85M15.5 3.2a3.25 3.25 0 0 1 0 6.3',
  payments: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9ZM3 10h18M7 15h3',
  tickets: 'M4 8V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V8a2.5 2.5 0 0 0 0 5v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5V13a2.5 2.5 0 0 0 0-5ZM14 5v14',
  leads: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 12h.01',
  threads: 'M20 4H4v12h4v4l5-4h7V4ZM8 9h8M8 12.5h5',
  mail: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11ZM3.5 7l8.5 6.5L20.5 7',
  audit: 'M12 8v4.5l3 1.75M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4h4',
  cards: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9ZM6.5 10.5h5M6.5 13.5h3M16 12a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 16 12ZM13.5 15.5a2.6 2.6 0 0 1 5 0',
  posts: 'M4 10v4h3l6 4.5v-13L7 10H4ZM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11',
  wording: 'M4 6.5h16M4 6.5V5M20 6.5V5M12 6.5V19M9 19h6M15.5 13.5l4 4M19.5 13.5l-4 4',
  content: 'M6.5 3h8l4 4v14h-12V3ZM14.5 3v4h4M9.5 12h5M9.5 15.5h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18',
  refresh: 'M20 12a8 8 0 1 1-2.35-5.65M20 4.5v4.5h-4.5',
  logout: 'M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h9',
  back: 'M9 6l6 6-6 6',
} as const;
export type IconName = keyof typeof ICONS;

/** Thin gold-friendly line icons, decorative: the label beside them carries the meaning. */
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 2.6 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function SectionHead({ title, hint, onReload, busy, children }: { title: string; hint?: string; onReload?: () => void; busy?: boolean; children?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h1>{title}</h1>
        {hint ? <p className="muted hint">{hint}</p> : null}
      </div>
      <div className="section-tools">
        {children}
        {onReload ? (
          <button className={busy ? 'icon-button spinning' : 'icon-button'} type="button" onClick={onReload} disabled={busy} aria-label="تحديث">
            <Icon name="refresh" size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

const HINTS: Record<string, string> = {
  hub_not_supported: 'هذا القسم يعمل بعد رفع إضافة الهب 2.7.0 على vcmem.com. باقي اللوحة يعمل كالمعتاد.',
  hub_not_trusted: 'فعّل خانة «خادم التطبيق (صلاحيات إدارية)» لموقع التطبيق في صفحة «المواقع» على الهب.',
  not_admin: 'الهب لا يرى هذا الحساب مديرًا موثّقًا. راجع صلاحية الحساب من صفحة الهب.',
  hub_unreachable: 'تعذّر الوصول إلى الهب الآن. حاول بعد قليل.',
  pb_not_configured: 'جسر بنك المشاريع لم يُضبط على الخادم بعد.',
  pb_not_supported: 'حدّث إضافة بنك المشاريع إلى 39.0.',
};

/** One failed part, inside its own card: the rest of the page keeps working. */
export function ErrorCard({ error, onRetry }: { error: { code: string; message: string }; onRetry?: () => void }) {
  const upgrade = error.code === 'hub_not_supported' || error.code === 'pb_not_supported';
  return (
    <div className={upgrade ? 'state-card upgrade' : 'state-card'} role="alert">
      <strong>{upgrade ? error.message || 'حدّث إضافة الهب إلى 2.7.0' : error.message}</strong>
      {HINTS[error.code] ? <p className="muted">{HINTS[error.code]}</p> : null}
      {onRetry ? <button type="button" onClick={onRetry}>إعادة المحاولة</button> : null}
    </div>
  );
}

/** What a part shows when drawing it threw. */
export function Broken({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="state-card" role="alert">
      <strong>تعذّر عرض هذا الجزء</strong>
      <p className="muted">وصلت بيانات غير متوقعة. باقي اللوحة يعمل كالمعتاد.</p>
      <button type="button" onClick={onRetry}>إعادة المحاولة</button>
    </div>
  );
}

type BoundaryProps = { children: ReactNode; watch?: unknown; fallback?: (retry: () => void) => ReactNode };

/**
 * One unexpected value from the hub must never blank the dashboard: the part that threw shows a card and the shell
 * stays. React catches render errors in a class only. A new `watch` value (fresh data, another address) tries again.
 */
export class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.failed && previous.watch !== this.props.watch) this.setState({ failed: false });
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.retry) : <Broken onRetry={this.retry} />;
  }
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" role="status" aria-label="جارٍ التحميل">
      {Array.from({ length: rows }, (_, index) => <span key={index} />)}
    </div>
  );
}

/** Loading, error (with the «hub needs 2.7.0» case) and empty, the same way in every section. */
export function Async<T>({ state, empty, emptyText, rows, children }: { state: Loaded<T>; empty?: (data: T) => boolean; emptyText?: string; rows?: number; children: (data: T) => ReactNode }) {
  if (state.error && !state.loading) return <ErrorCard error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Skeleton rows={rows} />;
  if (empty?.(state.data)) return <p className="state-card empty">{emptyText ?? 'لا توجد بيانات بعد.'}</p>;
  return <div className={state.loading ? 'stale' : undefined}>{children(state.data)}</div>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <span className="sr-only">{placeholder}</span>
      <input type="search" value={value} placeholder={placeholder} maxLength={120} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export type ChipOption<V extends string> = { value: V; label: string; count?: number | null };

/** A single-choice row that scrolls sideways on a phone. */
export function Chips<V extends string>({ label, options, value, onChange }: { label: string; options: ChipOption<V>[]; value: V; onChange: (value: V) => void }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={option.value === value ? 'chip on' : 'chip'} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
          {typeof option.count === 'number' ? <span className="num">{formatNumber(option.count)}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, perPage, total, onPage }: { page: number; perPage: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  // A list that shrank can leave the asked page past the end: the pager never counts beyond what exists.
  const current = Math.min(Math.max(1, page), pages);
  return (
    <nav className="pager" aria-label="الصفحات">
      <button type="button" disabled={current <= 1} onClick={() => onPage(current - 1)}>السابق</button>
      <span className="muted num">صفحة {formatNumber(current)} من {formatNumber(pages)}</span>
      <button type="button" disabled={current >= pages} onClick={() => onPage(current + 1)}>التالي</button>
    </nav>
  );
}

type PageOf = { total: number; page: number; per_page: number; items: unknown[] };

/**
 * `Async` for a list the server pages. The list is empty only when this page has no rows and no page before it has
 * any: a write (or the hub itself) can shrink a list while the owner stands on its last page, and that page then
 * steps back to the new last one instead of reading as «no data» with no pager to leave by.
 */
export function AsyncPage<T extends PageOf>({ state, onPage, emptyText, rows, children }: { state: Loaded<T>; onPage: (page: number) => void; emptyText: string; rows?: number; children: (data: T) => ReactNode }) {
  const data = state.data;
  const last = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  const beyond = data !== null && data.items.length === 0 && data.page > last;
  useEffect(() => {
    if (beyond) onPage(last);
  }, [beyond, last, onPage]);

  if (beyond) return <Skeleton rows={rows} />;
  return (
    <Async state={state} rows={rows}>
      {(answer) => (
        <>
          {answer.items.length === 0 ? <p className="state-card empty">{emptyText}</p> : children(answer)}
          <Pager page={answer.page} perPage={answer.per_page} total={answer.total} onPage={onPage} />
        </>
      )}
    </Async>
  );
}

export type Tone = 'gold' | 'ok' | 'danger' | 'muted';
export function Pill({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/** The hub's seriousness grade (0 to 9) with its own label: five quiet bars, the label always beside them. */
export function Intent({ score, label }: { score: number; label: string }) {
  const lit = Math.max(0, Math.min(5, Math.ceil(score / 2)));
  return (
    <span className="intent" title={`درجة الجدية ${score} من 9`}>
      <span className="intent-bars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <i key={index} className={index < lit ? 'on' : undefined} />)}
      </span>
      <span>{label || 'غير مصنّف'}</span>
    </span>
  );
}

/** A label over a value, for the detail sheets. */
export function Field({ label, children, ltr }: { label: string; children: ReactNode; ltr?: boolean }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{ltr ? <bdi dir="ltr">{children}</bdi> : children}</dd>
    </div>
  );
}

/**
 * A panel over the page: full height from the bottom on a phone, a side panel on a desk. Focus moves in and stays in,
 * Escape and the backdrop close it, and focus returns to where it was.
 */
export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      // The focused control can vanish under the finger (a panel that closes): Tab then starts inside again, never behind the sheet.
      if (!node.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('locked');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('locked');
      before?.focus();
    };
  }, []);

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => (event.target === event.currentTarget ? onClose() : undefined)}>
      <div className={wide ? 'sheet wide' : 'sheet'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}>
        <header className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="إغلاق">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** A plain table that turns into stacked cards on a phone: every cell carries its column name. */
export function DataTable<T>({ caption, columns, rows, rowKey }: { caption: string; columns: { key: string; label: string; cell: (row: T) => ReactNode; num?: boolean }[]; rows: T[]; rowKey: (row: T) => string | number }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col" className={column.num ? 'num' : undefined}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => <td key={column.key} data-label={column.label} className={column.num ? 'num' : undefined}>{column.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Opens the member's sheet from any list. */
export function MemberLink({ id, name }: { id: number; name: string }) {
  const { openMember } = useShell();
  if (!id) return <span>{name || '—'}</span>;
  return (
    <button
      className="name-link"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openMember(id);
      }}
    >
      {name || `حساب رقم ${id}`}
    </button>
  );
}

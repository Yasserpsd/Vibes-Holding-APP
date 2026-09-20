import { useEffect, useState } from 'react';

import { api } from '../api';
import { daysText, formatDay, formatNumber, formatRelative } from '../format';
import type { Account, AccountFilter, AccountRow } from '../types';
import { AsyncPage, Chips, ErrorCard, Pill, SearchBox, SectionHead, useDebounced, useLoad, useShell, type Tone } from '../ui';

const PER_PAGE = 25;
const FILTERS: { value: AccountFilter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'member', label: 'أعضاء مشتركون' },
  { value: 'unpaid', label: 'لم يدفعوا بعد' },
  { value: 'pending', label: 'بانتظار تأكيد البريد' },
  { value: 'expired', label: 'انتهت عضويتهم' },
  { value: 'publisher', label: 'ناشرون' },
  { value: 'admin', label: 'الإدارة' },
  { value: 'lead', label: 'عملاء محتملون' },
];

const STATES: Record<Account['state'], { label: string; tone: Tone }> = {
  member: { label: 'عضو مشترك', tone: 'gold' },
  unpaid: { label: 'لم يدفع بعد', tone: 'muted' },
  pending: { label: 'بانتظار تأكيد البريد', tone: 'muted' },
  expired: { label: 'انتهت العضوية', tone: 'danger' },
  lead: { label: 'عميل محتمل', tone: 'muted' },
};

export function StatePill({ account }: { account: Pick<Account, 'state' | 'role'> }) {
  const state = STATES[account.state] ?? { label: account.state, tone: 'muted' as Tone };
  return (
    <>
      <Pill tone={state.tone}>{state.label}</Pill>
      {account.role === 'admin' ? <Pill tone="gold">إدارة</Pill> : account.role === 'publisher' ? <Pill tone="gold">ناشر</Pill> : null}
    </>
  );
}

/** "باقي 120 يومًا" for a dated membership, the plain fact for one without an end. */
export function memberLeft(account: Pick<Account, 'never_expires' | 'member_left' | 'member_end'>): string {
  if (account.never_expires) return 'بلا تاريخ انتهاء';
  if (account.member_left === null) return '—';
  return `باقي ${daysText(account.member_left)}`;
}

/** Today's adviser «رصيد». The hub answers null when it has no figure for the account: that never means "no limit". */
export function dailyLeft(account: Pick<Account, 'daily_left' | 'daily_limit'>): string {
  return account.daily_left === null ? '—' : `${formatNumber(account.daily_left)} من ${formatNumber(account.daily_limit)}`;
}

function Row({ account }: { account: AccountRow }) {
  const { openMember } = useShell();
  const member = account.state === 'member';
  return (
    <li>
      <button type="button" className="member-row" onClick={() => openMember(account.id)}>
        <span className="member-top">
          <strong>{account.name || account.email || `حساب رقم ${account.id}`}</strong>
          <span className="pills"><StatePill account={account} /></span>
        </span>
        <span className="muted member-contact">
          {account.email ? <bdi dir="ltr">{account.email}</bdi> : null}
          {account.phone ? <bdi dir="ltr">{account.phone}</bdi> : null}
          <span>آخر نشاط {formatRelative(account.last_at ?? account.created_at)}</span>
        </span>
        {member ? (
          <span className="member-facts">
            <span className={!account.never_expires && account.member_left !== null && account.member_left <= 7 ? 'fact alert' : 'fact'}>
              <i>العضوية</i>
              <b className="num">{memberLeft(account)}</b>
              {account.member_end && !account.never_expires ? <small>حتى {formatDay(account.member_end)}</small> : null}
            </span>
            <span className="fact">
              <i>رصيد المستشار اليوم</i>
              <b className="num">{dailyLeft(account)}</b>
            </span>
            <span className="fact">
              <i>رصيد بنك المشاريع</i>
              <b className="num">{account.pb ? `${formatNumber(account.pb.left)} من ${formatNumber(account.pb.left + account.pb.used)}` : '—'}</b>
              {account.pb ? <small>استخدم {formatNumber(account.pb.used)}</small> : null}
            </span>
          </span>
        ) : account.state === 'expired' && account.member_end ? (
          <span className="muted hint">انتهت في {formatDay(account.member_end)}</span>
        ) : null}
      </button>
    </li>
  );
}

/** Every account of the hub: search, the states with their counts, and beside each annual member what he has left. The shell remounts it to open on another state. */
export function Members({ initial, stamp }: { initial: AccountFilter; stamp: number }) {
  const [filter, setFilter] = useState<AccountFilter>(initial);
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(text.trim());
  const state = useLoad(() => api.accounts({ q, state: filter, page, perPage: PER_PAGE }), [q, filter, page, stamp]);

  useEffect(() => setPage(1), [q, filter]);

  const counts = state.data?.counts;
  return (
    <>
      <SectionHead title="الأعضاء" hint={state.data ? `الحسابات في هذا العرض: ${formatNumber(state.data.total)}` : undefined} onReload={state.reload} busy={state.loading} />
      <div className="filters">
        <SearchBox value={text} onChange={setText} placeholder="ابحث بالاسم أو البريد أو الجوال" />
        <Chips label="حالة الحساب" options={FILTERS.map((entry) => ({ ...entry, count: counts?.[entry.value] ?? null }))} value={filter} onChange={setFilter} />
      </div>
      <AsyncPage state={state} onPage={setPage} rows={8} emptyText={q ? 'لا توجد حسابات تطابق البحث.' : 'لا توجد حسابات في هذه الحالة.'}>
        {(data) => (
          <>
            {data.pbError ? <ErrorCard error={{ code: data.pbError.code, message: `رصيد بنك المشاريع غير متاح الآن: ${data.pbError.message}` }} /> : null}
            <ul className="member-list">
              {data.items.map((account) => <Row key={account.id} account={account} />)}
            </ul>
          </>
        )}
      </AsyncPage>
    </>
  );
}

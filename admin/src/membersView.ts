import type { AccountFilter, EndsFilter, MembersView, PersonaFilter, WaFilter } from './types';

export const DEFAULT_VIEW: MembersView = { state: 'all', persona: 'all', wa: 'all', ends: 'all' };

const STATES: readonly AccountFilter[] = ['all', 'registered', 'pending', 'unpaid', 'member', 'expired', 'admin', 'publisher', 'lead'];
const PERSONAS: readonly PersonaFilter[] = ['all', 'neutral', 'entrepreneur', 'investor', 'none'];
const WAS: readonly WaFilter[] = ['all', 'yes', 'no'];
const ENDS: readonly EndsFilter[] = ['all', '7', '30'];

/** The members view named by an address query (`state=unpaid&persona=investor`); anything unknown falls back to «all». */
export function parseView(query: string): MembersView {
  const params = new URLSearchParams(query);
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key) as T | null;
    return value !== null && allowed.includes(value) ? value : fallback;
  };
  return {
    state: pick('state', STATES, DEFAULT_VIEW.state),
    persona: pick('persona', PERSONAS, DEFAULT_VIEW.persona),
    wa: pick('wa', WAS, DEFAULT_VIEW.wa),
    ends: pick('ends', ENDS, DEFAULT_VIEW.ends),
  };
}

/** The address query of a view: only what differs from «all», so the plain list keeps the plain `#members`. */
export function viewQuery(view: Partial<MembersView>): string {
  const params = new URLSearchParams();
  for (const key of ['state', 'persona', 'wa', 'ends'] as const) {
    const value = view[key];
    if (value && value !== DEFAULT_VIEW[key]) params.set(key, value);
  }
  return params.toString();
}

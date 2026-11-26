/**
 * The JSX runtime of the dashboard (tsconfig `jsxImportSource`, vite alias `tx-jsx`). In Arabic it is React's own.
 * In English mode every host element (`div`, `button`, `input`…) has its Arabic text and its `placeholder`,
 * `title`, `alt` and `aria-label` passed through the dictionary on the way in. Components are left alone: what
 * they are given reaches a host element sooner or later, and state, form values and requests never pass here.
 */
import * as React from 'react/jsx-runtime';

import { isEn, tx } from '../i18n';

export type { JSX } from 'react/jsx-runtime';
export const Fragment = React.Fragment;

type Props = Record<string, unknown>;

const ATTRIBUTES = ['placeholder', 'title', 'alt', 'aria-label'] as const;
/** Text typed or stored by people stays as written. */
const SKIP = new Set(['textarea', 'script', 'style']);

function children(value: unknown): unknown {
  if (typeof value === 'string') return tx(value);
  if (!Array.isArray(value)) return value;
  let next: unknown[] | null = null;
  value.forEach((child, index) => {
    const done = typeof child === 'string' ? tx(child) : Array.isArray(child) ? children(child) : child;
    if (done !== child) {
      next ??= value.slice();
      next[index] = done;
    }
  });
  return next ?? value;
}

export function localize(type: unknown, props: unknown): unknown {
  if (typeof type !== 'string' || SKIP.has(type) || !props || typeof props !== 'object') return props;
  const from = props as Props;
  // `lang="ar"` marks Arabic that is content, not interface: the app's own wording shown for editing.
  // M282: `data-content` marks members' / the owner's own texts (posts, poll options): no word-by-word dictionary,
  // the whole text is translated by `englishSweep.ts` instead.
  if (from.lang === 'ar' || from['data-content'] !== undefined) return props;
  let next: Props | null = null;
  const set = (key: string, value: unknown) => {
    next ??= { ...from };
    next[key] = value;
  };
  const inner = children(from.children);
  if (inner !== from.children) {
    set('children', inner);
    // An option with no value of its own submits its text: keep the Arabic one the code compares against.
    if (type === 'option' && from.value === undefined && typeof from.children === 'string') set('value', from.children);
  }
  for (const name of ATTRIBUTES) {
    const value = from[name];
    if (typeof value === 'string') {
      const done = tx(value);
      if (done !== value) set(name, done);
    }
  }
  return next ?? props;
}

type Create = typeof React.jsx;

const wrap = (create: Create): Create => (isEn ? (((type: never, props: never, key?: never) => create(type, localize(type, props) as never, key)) as Create) : create);

export const jsx = wrap(React.jsx);
export const jsxs = wrap(React.jsxs);

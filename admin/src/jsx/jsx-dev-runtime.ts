/** The development twin of `jsx-runtime.ts`: the dev server compiles JSX to `jsxDEV`. */
import * as React from 'react/jsx-dev-runtime';

import { isEn } from '../i18n';
import { localize } from './jsx-runtime';

export type { JSX } from 'react/jsx-runtime';
export const Fragment = React.Fragment;

type Create = typeof React.jsxDEV;

export const jsxDEV: Create = isEn
  ? (((type: never, props: never, ...rest: never[]) => (React.jsxDEV as (...args: never[]) => unknown)(type, localize(type, props) as never, ...rest)) as Create)
  : React.jsxDEV;

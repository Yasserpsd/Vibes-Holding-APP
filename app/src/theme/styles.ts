import { StyleSheet } from 'react-native';

/**
 * M196: an object built on first use instead of at module load. Module scope runs while the bundle
 * loads — before the saved theme is applied in _layout.tsx — so anything that reads `colors.x` there
 * would bake the dark value. Deferring the build to the first property read (always inside a render)
 * makes it read the active palette. One theme per JS lifetime (switching restarts the app, like the
 * language), so the object is built once and never invalidated.
 */
export function lazyTokens<T extends object>(build: () => T): T {
  let value: T | null = null;
  const get = (): T => (value ??= build());
  return new Proxy({} as T, {
    get: (_target, key) => get()[key as keyof T],
    has: (_target, key) => key in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_target, key) => {
      const current = get()[key as keyof T];
      return current === undefined ? undefined : { value: current, enumerable: true, configurable: true, writable: false };
    },
  });
}

/** A StyleSheet whose colours come from the active palette: `StyleSheet.create`, deferred to the first render. */
export function themedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(build: () => T): T {
  return lazyTokens(() => StyleSheet.create(build()));
}

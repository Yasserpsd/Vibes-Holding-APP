import { useCallback, useRef, useState, type RefObject } from 'react';
import type { ScrollView, View } from 'react-native';

import { ApiError } from '@/api/client';
import { t } from '@/i18n';

/**
 * M195: the red-error discipline of every form (owner, 2026-11-04: «أي حقل فيه خطأ: الـ border أحمر واضح
 * وتحته رسالة … الشاشة تنزل لوحدها لأول خطأ ويظهر فوق ملخص أحمر بعدد الأخطاء … الخطأ يختفي أول ما
 * المستخدم يصلّح الحقل»).
 *
 *   const form = useFormErrors<'name' | 'phone'>(scrollRef);
 *   <FormField anchorRef={form.anchor('name')} error={form.errors.name} onChangeText={(v) => { setName(v); form.clear('name'); }} />
 *   const submit = () => { const next = validate(); if (form.fail(next, ['name', 'phone'])) return; … };
 *
 * `fail` stores the errors and scrolls to the FIRST one in the order given; it returns true when there was any.
 */
export type FormErrors<K extends string> = Partial<Record<K, string>>;

export function useFormErrors<K extends string>(scrollRef?: RefObject<ScrollView | null>) {
  const [errors, setErrors] = useState<FormErrors<K>>({});
  const anchors = useRef<Partial<Record<K, View | null>>>({});

  const anchor = useCallback(
    (key: K) => (node: View | null) => {
      anchors.current[key] = node;
    },
    [],
  );

  const clear = useCallback((key: K) => {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const scrollTo = useCallback(
    (key: K) => {
      const node = anchors.current[key];
      const scroll = scrollRef?.current;
      if (!node || !scroll) return;
      try {
        // The content view of the ScrollView is the frame of reference: y is the field's offset in the content.
        const content = (scroll as unknown as { getInnerViewRef?: () => View | null }).getInnerViewRef?.();
        if (!content) return;
        node.measureLayout(
          content as never,
          (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 96), animated: true }),
          () => undefined,
        );
      } catch {
        // Measuring can fail while the layout is still settling: the red field and summary still show.
      }
    },
    [scrollRef],
  );

  const fail = useCallback(
    (next: FormErrors<K>, order: K[]): boolean => {
      setErrors(next);
      const first = order.find((key) => next[key]);
      if (!first) return false;
      // Let the error rows render first so the measured position includes them.
      setTimeout(() => scrollTo(first), 50);
      return true;
    },
    [scrollTo],
  );

  const reset = useCallback(() => setErrors({}), []);

  /**
   * Live checks (owner, 2026-11-06: «أي خانة فيها مشكلة يظهر عليها أحمر فورًا ويظهر تحذير تحتها»): the screen
   * calls this on every keystroke with the field's own verdict — a message paints the field red at once, null
   * clears it the moment the value is right. The screens skip the check while the field is still empty and
   * being typed, and run it in full when the member leaves the field.
   */
  const check = useCallback((key: K, message: string | null | undefined) => {
    setErrors((current) => {
      if (!message) {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (current[key] === message) return current;
      return { ...current, [key]: message };
    });
  }, []);

  /** One field turns red on its own (a fourth interest tapped) without touching the others. */
  const set = useCallback((key: K, message: string) => setErrors((current) => ({ ...current, [key]: message })), []);

  /**
   * M253 (owner, 2026-11-19: «يظهرلي فورا الخانة اللي فيها مشكلة»): a refusal that came back from the server lands
   * on its own fields — red border, the server's sentence under each, the screen at the first one. `fields` maps
   * the names the server uses to this form's keys (same name when absent); `codes` gives a field to a refusal
   * that names none (the hub's `exists` belongs under the e-mail). Returns the fields that took it; an empty
   * list means the refusal is not about a field and the screen shows it by the button.
   */
  const fromServer = useCallback(
    (error: unknown, order: K[], options: { fields?: Record<string, K>; codes?: Partial<Record<string, K>> } = {}): K[] => {
      if (!(error instanceof ApiError)) return [];
      const next: FormErrors<K> = {};
      for (const problem of error.fields) {
        const key = options.fields?.[problem.field] ?? options.fields?.[problem.path] ?? (order.includes(problem.field as K) ? (problem.field as K) : undefined);
        if (!key || next[key]) continue;
        next[key] = problem.index === undefined ? problem.message : t('form.error.line', { line: problem.index + 1, message: problem.message });
      }
      const byCode = options.codes?.[error.code];
      if (byCode && !Object.keys(next).length) next[byCode] = error.message;
      const taken = Object.keys(next) as K[];
      if (!taken.length) return [];
      setErrors((current) => ({ ...current, ...next }));
      const first = order.find((key) => next[key]) ?? taken[0];
      if (first) setTimeout(() => scrollTo(first), 50);
      return taken;
    },
    [scrollTo],
  );

  return { errors, anchor, clear, fail, reset, set, check, scrollTo, fromServer, count: Object.values(errors).filter(Boolean).length };
}

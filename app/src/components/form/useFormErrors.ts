import { useCallback, useRef, useState, type RefObject } from 'react';
import type { ScrollView, View } from 'react-native';

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

  /** One field turns red on its own (a fourth interest tapped) without touching the others. */
  const set = useCallback((key: K, message: string) => setErrors((current) => ({ ...current, [key]: message })), []);

  return { errors, anchor, clear, fail, reset, set, count: Object.values(errors).filter(Boolean).length };
}

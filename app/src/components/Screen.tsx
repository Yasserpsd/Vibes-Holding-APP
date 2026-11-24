import { HeaderHeightContext } from 'expo-router/react-navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pagePhotoOf, usePagePhotos } from '@/api/images';
import { useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { EmblemWatermark, GoldHairline } from '@/components/lux';
import { FadeInView } from '@/components/motion';
import { textStart } from '@/i18n/direction';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Pull-to-refresh control, forwarded to the scroll view. */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Safe-area edges; tab screens keep the bottom for the tab bar. */
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  /** A tab screen: it ends at the tab bar, which already takes the bottom safe-area inset. */
  aboveTabBar?: boolean;
  /** V2: ghost the club emblem behind the heading — for the screens that deserve a signature. */
  watermark?: boolean;
  /** M176: lets a screen scroll itself (the top «اشترك الآن» button jumps to the booking card). */
  scrollRef?: RefObject<ScrollView | null>;
  /**
   * M270: a titled page opens on a photograph with its title written on it. `false` keeps the plain heading —
   * for the few pages that already lead with their own banner right under the title.
   */
  photo?: boolean;
};

/**
 * Review 2026-11-16 (members: «الكيبورد يغطي المكان اللي بكتب فيه»): keeping the field that holds the cursor in view.
 *
 * The binary runs edge-to-edge, so Android no longer resizes the window for the keyboard: the keyboard wrapper pads
 * the bottom instead (see `Screen` below), which shortens the scroll view. That alone does not move the content — a
 * field in the lower half stays behind the keys until the member drags the form. So the scroll view around a form
 * tracks where it is and how tall it is, and brings the focused field back into its visible part:
 *   - when a field takes the cursor (FormField reports its whole row: label, input and the line under it);
 *   - when the scroll view gets shorter, which is the keyboard opening.
 * It scrolls only when the field is really outside, by the smallest distance that shows it.
 */
type FieldScroll = { focus: (row: View | null) => void; blur: (row: View | null) => void };

const FieldScrollContext = createContext<FieldScroll | null>(null);

/** For a scroll view that is not a `Screen` (the profile-completion cover): wrap its content in this. */
export const FieldScrollProvider = FieldScrollContext.Provider;

/** A field reports its focus to the scroll view around it; null where no such scroll view exists (a modal sheet). */
export const useFieldScroll = (): FieldScroll | null => useContext(FieldScrollContext);

/** Air kept above and below the focused row, so it never sits flush against the header or the keyboard. */
const FIELD_AIR = 20;

/**
 * The scroll view's side of the above. Returns the value for `FieldScrollProvider` and the props to spread on the
 * ScrollView (`scrollsChildToFocus` included: Android's own «scroll to the focused child» mis-measures a field
 * inside a tilted sheet — PaperCard `pinned` — and threw the whole page back to its top on every tap).
 */
export function useFieldScroller(scrollRef: RefObject<ScrollView | null>) {
  const offset = useRef(0);
  const viewport = useRef(0);
  const row = useRef<View | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reveal = useCallback(() => {
    const scroll = scrollRef.current;
    // A field that is not a FormField (a bare TextInput) still counts: the input itself is measured.
    const target = row.current ?? TextInput.State.currentlyFocusedInput();
    const room = viewport.current;
    if (!scroll || !target || room <= 0) return;
    try {
      // The content view is the frame of reference: y is the row's offset inside the scrolled content.
      const content = (scroll as unknown as { getInnerViewRef?: () => View | null }).getInnerViewRef?.();
      if (!content) return;
      target.measureLayout(
        content as never,
        (_x, y, _width, height) => {
          const top = offset.current;
          let next: number | null = null;
          if (y - FIELD_AIR < top) next = y - FIELD_AIR;
          // A row taller than the visible room (a long note) shows its top; any other shows whole.
          else if (y + height + FIELD_AIR > top + room) next = height + FIELD_AIR * 2 > room ? y - FIELD_AIR : y + height + FIELD_AIR - room;
          if (next !== null) scroll.scrollTo({ y: Math.max(0, next), animated: true });
        },
        // Not inside this scroll view (a field in a sheet above it): nothing to do.
        () => undefined,
      );
    } catch {
      // Measuring can fail while the layout is still settling; the next focus or keyboard change tries again.
    }
  }, [scrollRef]);

  const schedule = useCallback(
    (delay: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(reveal, delay);
    },
    [reveal],
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  const field = useMemo<FieldScroll>(
    () => ({
      focus: (node) => {
        row.current = node;
        // Keyboard already up: the room is known, move now (after the hint line under the field has drawn).
        // Keyboard on its way: wait for it — the shorter scroll view below reschedules this the moment it opens,
        // so the form moves once, not twice. The long wait only fires when no keyboard comes (a hardware one).
        schedule(Keyboard.isVisible() ? 80 : 450);
      },
      blur: (node) => {
        if (row.current === node) row.current = null;
      },
    }),
    [schedule],
  );

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      const shrank = height < viewport.current - 1;
      viewport.current = height;
      if (shrank) schedule(60);
    },
    [schedule],
  );

  return { field, scrollProps: { onScroll, onLayout, scrollEventThrottle: 32, scrollsChildToFocus: false } };
}

/** Scrollable screen with keyboard handling, used by forms and detail pages. */
export function Screen({ title, subtitle, children, refreshControl, edges = ['top'], aboveTabBar = false, watermark = false, scrollRef, photo = true }: Props) {
  // M270 (owner, on the gate's photograph: «عايز كله يكون كده… نفس الفكرة دي كل الصفحات»): the heading of every
  // titled page is a photograph of the club that melts into the page, each page its own picture.
  const pagePhotos = usePagePhotos();
  const heroPhoto = title && photo ? pagePhotoOf(pagePhotos, title) : null;
  // The bottom padding keeps the last element clear of the floating «اسأل المستشار» button. Without a tab bar or
  // a bottom safe-area edge under it, the scroll view runs to the physical bottom edge and the inset counts too.
  const clearance = useAskAdvisorClearance(aboveTabBar || edges.includes('bottom'));
  // Review 2026-11-15 (iOS): under the stack's opaque header this view starts one header-height down the screen,
  // and the keyboard padding came out short by that much — the last field of a long form stayed under the keyboard.
  // The context is read directly (never useHeaderHeight(), which throws where no navigator provides it): the stack
  // gives the header height, or 0 for a screen without a header. expo-router 57 ships react-navigation inside itself,
  // so the context comes from its own entry, not from @react-navigation/elements (not installed here).
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  // Review 2026-11-16: under the stack's header the top inset is already taken by the header itself. Adding it again
  // left an empty band as tall as the status bar under the header, and scrolled content was cut along that band.
  // A screen without a header (the tab screens) keeps its top edge.
  const safeEdges = headerHeight > 0 ? edges.filter((edge) => edge !== 'top') : edges;
  const ownScrollRef = useRef<ScrollView | null>(null);
  const scroll = scrollRef ?? ownScrollRef;
  const keeper = useFieldScroller(scroll);
  return (
    <SafeAreaView style={styles.safeArea} edges={safeEdges}>
      {watermark && !heroPhoto ? <EmblemWatermark /> : null}
      {/* Review 2026-11-16: `padding` on Android too. Edge-to-edge means the window is not resized for the keyboard,
          so `undefined` (a plain View) left every form behind the keys. The offset is the header above this view on
          both platforms; if a device ever did resize the window, the padding works out to zero by itself. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <FieldScrollProvider value={keeper.field}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          {...keeper.scrollProps}
        >
          {title && heroPhoto ? (
            <FadeInView key="photo-heading" offset={10} duration={360}>
              <View style={styles.hero}>
                <Image source={{ uri: sized(heroPhoto, 400) }} style={styles.heroFill} resizeMode="cover" resizeMethod="resize" accessibilityIgnoresInvertColors />
                <View style={[styles.heroFill, styles.heroScrim]} />
                <View style={styles.heroTexts}>
                  <Text style={styles.heroTitle}>{title}</Text>
                  {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
                  <GoldHairline style={styles.hairline} />
                </View>
              </View>
            </FadeInView>
          ) : title ? (
            <FadeInView key="plain-heading" offset={10} duration={360}>
              <View style={styles.heading}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                <GoldHairline style={styles.hairline} />
              </View>
            </FadeInView>
          ) : null}
          {children}
        </ScrollView>
        </FieldScrollProvider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  safeArea: { flex: 1, backgroundColor: colors.black },
  flex: { flex: 1 },
  // M85c density: tighter side gutters give the content the width the owner asked for.
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  heading: { gap: spacing.xs, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.gold, textAlign: textStart },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  hairline: { marginTop: spacing.sm, width: 72, alignSelf: 'flex-start' },
  // M270: the photograph runs to the screen's edges (it undoes the content's own padding) and darkens downward
  // into the dark theme's background, so the page seems to grow out of it; the light theme reads it as a
  // rounded picture header. The words on it use the on-photo colours in both themes.
  hero: {
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    minHeight: 206,
    justifyContent: 'flex-end',
    backgroundColor: '#070708',
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    overflow: 'hidden',
  },
  heroFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroScrim: { experimental_backgroundImage: 'linear-gradient(0deg, rgba(7, 7, 8, 1) 0%, rgba(7, 7, 8, 0.82) 30%, rgba(7, 7, 8, 0.28) 64%, rgba(7, 7, 8, 0.22) 100%)' },
  heroTexts: { paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.sm, gap: spacing.xs },
  heroTitle: { ...typography.title, color: colors.onPhotoGold, textAlign: textStart },
  heroSubtitle: { ...typography.body, color: colors.onPhoto, textAlign: textStart },
}));

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { t } from '@/i18n';
import { isRTL } from '@/i18n/direction';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M85f (owner): «حاجة تحب تفضل فاتح التطبيق بس تتفرج عليه من جماله» — the wow layer.
 * Everything here is RN-Animated transform/opacity only (OTA-safe, native driver, no new module):
 * the live gold ticker, the flip countdown, the membership confetti and the hero's golden dust.
 */

// ── الشريط الذهبي ────────────────────────────────────────────────────────────

const TICKER_SPEED_PX_PER_SEC = 32;

/** A stock-exchange gold strip sliding the club's live numbers across the home. */
export function GoldTicker({ items }: { items: string[] }) {
  const [width, setWidth] = useState(0);
  const [shift] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!width) return;
    shift.setValue(0);
    // The row slides one full copy of itself, then snaps back unseen: an endless tape.
    const loop = Animated.loop(
      Animated.timing(shift, {
        toValue: 1,
        duration: Math.max(6000, (width / TICKER_SPEED_PX_PER_SEC) * 1000),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [width, shift]);

  if (items.length === 0) return null;
  // Under RTL the tape travels the other way, so the reader always meets the text head-on.
  const translateX = shift.interpolate({ inputRange: [0, 1], outputRange: isRTL() ? [-width, 0] : [0, -width] });

  const copy = (keyPrefix: string) => (
    <View style={styles.tickerRow} onLayout={keyPrefix === 'a' ? (event) => setWidth(Math.ceil(event.nativeEvent.layout.width)) : undefined}>
      {items.map((item, index) => (
        <View key={`${keyPrefix}${index}`} style={styles.tickerItem}>
          <Text style={styles.tickerDiamond}>◆</Text>
          <Text style={styles.tickerText} numberOfLines={1}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.ticker} accessibilityLabel={items.join(' · ')}>
      <Animated.View style={[styles.tickerTape, { transform: [{ translateX }] }]}>
        {copy('a')}
        {copy('b')}
      </Animated.View>
    </View>
  );
}

// ── الإطار الذهبي الجاري ─────────────────────────────────────────────────────

/**
 * M85f: a gradient sweeping along a golden card's rim. A large light band spins behind
 * an inner mask that re-paints the card surface, so only the hairline rim catches it.
 * Rotation is transform-only on the native driver; the gradient itself never animates.
 * Render it as the FIRST child inside a GlassCard (it fills the card absolutely).
 */
export function GoldSweep({ radius = radii.lg, thickness = 1.5, duration = 5200 }: { radius?: number; thickness?: number; duration?: number }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [turn] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn, duration]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // The spinning square must cover the card's diagonal at every angle.
  const span = Math.ceil(Math.hypot(size.w, size.h)) + 8;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
      onLayout={(event) => setSize({ w: Math.ceil(event.nativeEvent.layout.width), h: Math.ceil(event.nativeEvent.layout.height) })}
    >
      {size.w > 0 ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: size.w / 2 - span / 2,
            top: size.h / 2 - span / 2,
            width: span,
            height: span,
            transform: [{ rotate }],
            experimental_backgroundImage:
              'linear-gradient(90deg, rgba(242,206,116,0) 0%, rgba(242,206,116,0) 38%, rgba(242,206,116,0.95) 50%, rgba(242,206,116,0) 62%, rgba(242,206,116,0) 100%)',
          }}
        />
      ) : null}
      {/* The mask re-paints the card surface, leaving only the rim lit. */}
      <View
        style={{
          position: 'absolute',
          top: thickness,
          bottom: thickness,
          start: thickness,
          end: thickness,
          borderRadius: Math.max(radius - thickness, 0),
          backgroundColor: colors.surface,
          experimental_backgroundImage: gradients.surface,
        }}
      />
    </View>
  );
}

// ── العداد التنازلي ──────────────────────────────────────────────────────────

type Remaining = { days: number; hours: number; minutes: number } | null;

function remainingTo(target: number, now: number): Remaining {
  const left = target - now;
  if (left <= 0) return null;
  const minutes = Math.floor(left / 60_000);
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

/** One flip cell: the value snaps closed and springs open again whenever it changes. */
function FlipCell({ value, label, small = false }: { value: number; label: string; small?: boolean }) {
  const [scaleY] = useState(() => new Animated.Value(1));
  const shown = useRef(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    Animated.sequence([
      Animated.timing(scaleY, { toValue: 0.08, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.spring(scaleY, { toValue: 1, speed: 24, bounciness: 9, useNativeDriver: true }),
    ]).start();
    const swap = setTimeout(() => setDisplay(value), 130);
    return () => clearTimeout(swap);
  }, [value, scaleY]);

  return (
    <View style={styles.flipCell}>
      <Animated.View style={[styles.flipCard, small && styles.flipCardSm, { transform: [{ scaleY }] }]}>
        <Text style={[styles.flipDigits, small && styles.flipDigitsSm]}>{String(display).padStart(2, '0')}</Text>
      </Animated.View>
      <Text style={styles.flipLabel}>{label}</Text>
    </View>
  );
}

/** M85f flip-digit countdown. M96: `compact` mounts it ON the event's own card so the numbers visibly belong to it. */
export function FlipCountdown({ targetMs, title = '', compact = false }: { targetMs: number; title?: string; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const left = remainingTo(targetMs, now);
  if (!left) return null;
  if (compact) {
    return (
      <View style={styles.countdownCompact}>
        <Text style={styles.countdownCompactLabel}>{t('wow.startsIn')}</Text>
        <View style={styles.flipRow}>
          <FlipCell small value={left.days} label={t('wow.days')} />
          <Text style={[styles.flipColon, styles.flipColonSm]}>:</Text>
          <FlipCell small value={left.hours} label={t('wow.hours')} />
          <Text style={[styles.flipColon, styles.flipColonSm]}>:</Text>
          <FlipCell small value={left.minutes} label={t('wow.minutes')} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.countdown}>
      <Text style={styles.countdownTitle} numberOfLines={1}>
        {t('wow.countdown', { title })}
      </Text>
      {/* The cells sit in logical order: الأيام first where reading starts. */}
      <View style={styles.flipRow}>
        <FlipCell value={left.days} label={t('wow.days')} />
        <Text style={styles.flipColon}>:</Text>
        <FlipCell value={left.hours} label={t('wow.hours')} />
        <Text style={styles.flipColon}>:</Text>
        <FlipCell value={left.minutes} label={t('wow.minutes')} />
      </View>
    </View>
  );
}

// ── الكونفيتي الذهبي ─────────────────────────────────────────────────────────

type ConfettiPiece = { startX: number; driftX: number; fall: number; size: number; spin: number; delay: number; shade: string };

function makePieces(count: number): ConfettiPiece[] {
  const shades = [colors.gold, colors.goldLight, colors.goldNeon, colors.goldDark];
  return Array.from({ length: count }, (_, index) => ({
    startX: Math.random() * 100,
    driftX: (Math.random() - 0.5) * 120,
    fall: 380 + Math.random() * 260,
    size: 5 + Math.random() * 5,
    spin: (Math.random() - 0.5) * 720,
    delay: Math.random() * 350,
    shade: shades[index % shades.length] ?? colors.gold,
  }));
}

/** One golden burst, then it removes itself. Mount with a fresh `key` to fire again. */
export function GoldConfetti({ onDone }: { onDone?: () => void }) {
  const [pieces] = useState(() => makePieces(22));
  const [progress] = useState(() => new Animated.Value(0));
  const [alive, setAlive] = useState(true);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 2300, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => {
      setAlive(false);
      onDone?.();
    });
  }, [progress, onDone]);

  if (!alive) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((piece, index) => {
        const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-40, piece.fall] });
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, piece.driftX] });
        const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.spin}deg`] });
        const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] });
        return (
          <Animated.View
            key={index}
            style={[
              styles.confetti,
              {
                start: `${piece.startX}%`,
                width: piece.size,
                height: piece.size * 1.8,
                backgroundColor: piece.shade,
                opacity,
                transform: [{ translateY }, { translateX }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * M85f: the moment this session SEES the membership turn active, gold rains once.
 * Rendered once at the root; it watches the account across every screen.
 */
export function MembershipCelebration() {
  const { me } = useAuth();
  const status = me?.membership.status ?? null;
  const previous = useRef<string | null>(null);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (previous.current && previous.current !== 'active' && status === 'active') setBurst(Date.now());
    if (status) previous.current = status;
  }, [status]);

  if (!burst) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <GoldConfetti key={burst} onDone={() => setBurst(0)} />
    </View>
  );
}

// ── الغبار الذهبي ────────────────────────────────────────────────────────────

type Mote = { x: number; bottom: number; rise: number; size: number; duration: number; delay: number };

/** Deterministic jitter in [0,1): pure during render (react-hooks/purity), varied enough for dust. */
const jitter = (seed: number): number => {
  const raw = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return raw - Math.floor(raw);
};

/** M85f: faint golden dust drifting up behind the hero emblem. Transform/opacity loops only. */
export function GoldDust({ count = 8, height = 120 }: { count?: number; height?: number }) {
  const motes = useMemo<Mote[]>(
    () =>
      Array.from({ length: count }, (_, index) => ({
        x: jitter(index + 1) * 100,
        bottom: jitter(index + 11) * 30,
        rise: 40 + jitter(index + 21) * (height - 50),
        size: 2 + jitter(index + 31) * 3,
        duration: 3200 + jitter(index + 41) * 2600,
        delay: jitter(index + 51) * 2400,
      })),
    [count, height],
  );
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'visible' }]}>
      {motes.map((mote, index) => (
        <DustMote key={index} mote={mote} />
      ))}
    </View>
  );
}

function DustMote({ mote }: { mote: Mote }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(mote.delay),
        Animated.timing(progress, { toValue: 1, duration: mote.duration, easing: Easing.out(Easing.sin), useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, mote]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -mote.rise] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 0.9, 0.5, 0] });
  return (
    <Animated.View
      style={[
        styles.mote,
        { start: `${mote.x}%`, bottom: mote.bottom, width: mote.size, height: mote.size, opacity, transform: [{ translateY }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // The ticker: a thin lit tape, gold on dark, like an exchange board.
  ticker: {
    overflow: 'hidden',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surface,
    boxShadow: shadows.glowGoldFaint,
    marginTop: spacing.sm,
  },
  tickerTape: { flexDirection: 'row' },
  tickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs + 2 },
  tickerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  tickerDiamond: { fontSize: 8, lineHeight: 18, color: colors.gold },
  tickerText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldLight },
  // The countdown.
  countdown: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  countdownTitle: { ...typography.caption, color: colors.textSecondary },
  // M96: the on-card version — tight enough to sit inside the event photo's scrim.
  countdownCompact: { alignItems: 'center', gap: 2 },
  countdownCompactLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.goldLight },
  flipCardSm: { minWidth: 34, paddingVertical: 2, paddingHorizontal: spacing.xs + 2 },
  flipDigitsSm: { fontSize: 15, lineHeight: 22 },
  flipColonSm: { fontSize: 14, lineHeight: 30 },
  flipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  flipCell: { alignItems: 'center', gap: 2 },
  flipCard: {
    minWidth: 46,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    boxShadow: shadows.glowGoldFaint,
  },
  flipDigits: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 28, color: colors.goldLight },
  flipLabel: { ...typography.caption, fontSize: 10, lineHeight: 14, color: colors.textMuted },
  flipColon: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 40, color: colors.gold },
  // Confetti and dust.
  confetti: { position: 'absolute', top: 0, borderRadius: 2 },
  mote: { position: 'absolute', borderRadius: radii.pill, backgroundColor: colors.goldNeon, boxShadow: shadows.glowGoldFaint },
});

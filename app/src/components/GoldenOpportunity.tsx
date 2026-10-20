import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { HomeContent } from '@/api/content';
import { useProjectsList } from '@/api/queries';
import type { PublicProject } from '@/api/types';
import { PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { StarsRow } from '@/components/Stars';
import { chevronForward, textStart } from '@/i18n/direction';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

// M99c (owner): ONE golden opportunity per APP OPEN — the seed lives for the JS session, so the pick
// changes when the app is closed and reopened, not on every screen focus.
const OPEN_SEED = Date.now();

/** Seeded pick: projects with an image first, so the reveal stays cinematic. */
function pick(items: PublicProject[], seed: number): PublicProject | null {
  const withImage = items.filter((project) => Boolean(project.image));
  const pool = withImage.length ? withImage : items;
  if (pool.length === 0) return null;
  const state = ((seed >>> 0 || 1) * 1664525 + 1013904223) >>> 0;
  return pool[state % pool.length] ?? null;
}

/** M99c «الفرصة الذهبية»: the investor's opening act — one big-image project, a fresh one every open. */
export function GoldenOpportunity({ block }: { block: NonNullable<HomeContent['opportunity']> }) {
  const router = useRouter();
  const list = useProjectsList({ q: '', sort: 'discover' });
  const page = list.data?.pages[0];
  const project = useMemo(() => pick(page?.items ?? [], OPEN_SEED), [page]);
  // M102 (owner): «الصورة بتفضل فاضية» — a broken image URL must never leave a dark hole: the club
  // emblem steps in on a golden wash.
  const [imageBroken, setImageBroken] = useState(false);
  // M109h: the featured project changes on every app open — a new photo url resets the latched
  // failure (reset during render, the React way for derived state).
  const imageUri = project?.image ?? null;
  const [brokenFor, setBrokenFor] = useState(imageUri);
  if (brokenFor !== imageUri) {
    setBrokenFor(imageUri);
    setImageBroken(false);
  }
  if (!project) return null;
  const showImage = Boolean(project.image) && !imageBroken;

  return (
    <View>
      <SectionHeader icon="star-outline" title={block.title} subtitle={block.subtitle} />
      <PressScale
        onPress={() => router.push({ pathname: '/project/[id]', params: { id: String(project.id) } })}
        glow
        glowRadius={radii.xl}
        accessibilityRole="button"
        accessibilityLabel={`${block.title} — ${project.title}`}
      >
        <View style={styles.card}>
          {/* M106b (owner: «الصورة سودا مش بتظهر»): the emblem layer ALWAYS renders underneath —
              a slow or hotlink-blocked PB image can stall without erroring, and black is never ok. */}
          <View style={styles.fallback} pointerEvents="none">
            <Image source={require('../../assets/images/club-emblem.png')} style={styles.fallbackEmblem} resizeMode="contain" />
          </View>
          {showImage ? (
            <Image
              source={{ uri: project.image ?? undefined }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              // Android decodes at the card's size instead of the photo's — the home stops paying for full-resolution bitmaps.
              resizeMethod="resize"
              accessibilityLabel={project.title}
              onError={() => setImageBroken(true)}
            />
          ) : null}
          {/* M107b: the dark scrim belongs on a photo only — over the golden fallback it read as a dead black card. */}
          {/* No GoldSweep here: its rim mask repaints the card interior opaque and swallowed the photo. */}
          {showImage ? <View style={styles.scrim} pointerEvents="none" /> : null}
          <View style={styles.body}>
            <View style={styles.pillRow}>
              {project.sector ? <Pill text={project.sector.name} /> : null}
              {project.stage ? <Pill text={project.stage.name} /> : null}
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {project.title}
            </Text>
            {project.rating && project.rating.stars !== null ? <StarsRow value={project.rating.stars} count={project.rating.count} /> : null}
            <View style={styles.ctaRow}>
              <Text style={styles.cta}>{block.cta}</Text>
              <Ionicons name={chevronForward()} size={14} color={colors.gold} />
            </View>
          </View>
        </View>
      </PressScale>
    </View>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 220,
    marginTop: spacing.sm,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    boxShadow: shadows.glowGoldFaint,
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: gradients.goldWash,
  },
  fallbackEmblem: { width: 110, height: 110, opacity: 0.5 },
  body: { padding: spacing.md, gap: spacing.xs },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  pillText: { ...typography.caption, color: colors.goldLight },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: textStart },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cta: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.gold },
});

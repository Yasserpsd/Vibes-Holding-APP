import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { HomeContent } from '@/api/content';
import { useProjectsList } from '@/api/queries';
import type { PublicProject } from '@/api/types';
import { ownDirection } from '@/components/Highlight';
import { PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { StarsRow } from '@/components/Stars';
import { chevronForward, textStart } from '@/i18n/direction';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

// M99c (owner): ONE golden opportunity per APP OPEN — the seed lives for the JS session, so the pick
// changes when the app is closed and reopened, not on every screen focus.
const OPEN_SEED = Date.now();

/** A list this old is asked for again when the home comes back into view (not on every focus). */
const REFRESH_AFTER_MS = 5 * 60_000;

/** Seeded pick: projects with an image first, so the reveal stays cinematic. */
function pick(items: PublicProject[], seed: number): PublicProject | null {
  const withImage = items.filter((project) => Boolean(project.image));
  const pool = withImage.length ? withImage : items;
  if (pool.length === 0) return null;
  const state = ((seed >>> 0 || 1) * 1664525 + 1013904223) >>> 0;
  return pool[state % pool.length] ?? null;
}

/**
 * M99c «الفرصة الذهبية»: the investor's opening act — one big-image Projects Bank project, a fresh one
 * every open. M149 (owner, 2026-10-28: «محفظة Vibes Ventures تتشال بالكامل»): the pinned M121
 * VibesOpportunityCard is gone from the home too (component deleted); the /golden page stays.
 */
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
  // Which photo has actually arrived. Until then (slow network, offline, no photo) the card is the themed
  // placeholder, so its words wear the theme's colours; the scrim and the on-photo white come with the photo.
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  // Coming back to the home asks for the bank's list again once it is older than five minutes.
  const { dataUpdatedAt, refetch } = list;
  useFocusEffect(
    useCallback(() => {
      if (dataUpdatedAt > 0 && Date.now() - dataUpdatedAt > REFRESH_AFTER_MS) void refetch({ cancelRefetch: false });
    }, [dataUpdatedAt, refetch]),
  );
  if (!project) return null;
  const showImage = Boolean(project?.image) && !imageBroken;
  const onPhoto = showImage && loadedUri === imageUri;

  return (
    <View>
      <SectionHeader icon="star-outline" title={block.title} subtitle={block.subtitle} />
      {project ? (
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
              // A Projects Bank photo passes through sized() untouched by design; an uploaded one gets its small variant.
              source={{ uri: sized(project.image, 400) }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              // Android decodes at the card's size instead of the photo's — the home stops paying for full-resolution bitmaps.
              resizeMethod="resize"
              accessibilityLabel={project.title}
              onLoad={() => setLoadedUri(imageUri)}
              onError={() => setImageBroken(true)}
            />
          ) : null}
          {/* M107b: the dark scrim belongs on a photo only — over the golden fallback it read as a dead black card. */}
          {/* No GoldSweep here: its rim mask repaints the card interior opaque and swallowed the photo. */}
          {onPhoto ? <View style={styles.scrim} pointerEvents="none" /> : null}
          {/* The sector and stage ride the card's top edge, clear of the photo's subject. */}
          {project.sector || project.stage ? (
            <View style={styles.pillRow} pointerEvents="none">
              {project.sector ? <Pill text={project.sector.name} onPhoto={onPhoto} /> : null}
              {project.stage ? <Pill text={project.stage.name} onPhoto={onPhoto} /> : null}
            </View>
          ) : null}
          <View style={styles.body}>
            <Text style={[styles.title, !onPhoto && styles.titlePlain, ownDirection(project.title)]} numberOfLines={2}>
              {project.title}
            </Text>
            {project.rating ? <StarsRow value={project.rating.stars} count={project.rating.count} /> : null}
            <View style={styles.ctaRow}>
              {/* On the photo's scrim the call wears the on-photo gold; on the golden fallback (no photo yet) the page's readable gold. */}
              <Text style={[styles.cta, onPhoto && styles.ctaOnPhoto]}>{block.cta}</Text>
              <Ionicons name={chevronForward()} size={14} color={onPhoto ? colors.onPhotoGold : colors.goldText} />
            </View>
          </View>
        </View>
      </PressScale>
      ) : null}
    </View>
  );
}

function Pill({ text, onPhoto }: { text: string; onPhoto: boolean }) {
  return (
    <View style={[styles.pill, !onPhoto && styles.pillPlain]}>
      <Text style={[styles.pillText, !onPhoto && styles.pillTextPlain]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
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
  pillRow: { position: 'absolute', top: spacing.md, start: spacing.md, end: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    maxWidth: '100%',
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  // No photo behind the card (missing, failed or still loading): the chips and the title follow the theme.
  pillPlain: { backgroundColor: colors.goldFaint, borderColor: colors.borderGoldSoft },
  pillText: { ...typography.caption, color: colors.onPhotoGold },
  pillTextPlain: { color: colors.goldLightText },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.onPhoto, textAlign: textStart },
  titlePlain: { color: colors.textPrimary },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cta: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.goldText },
  ctaOnPhoto: { color: colors.onPhotoGold },
}));

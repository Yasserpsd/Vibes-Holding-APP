import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useProjectReviews } from '@/api/queries';
import type { ProjectReview } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { RateProjectModal } from '@/components/project/RateProjectModal';
import { StarsRow } from '@/components/Stars';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M116 «تقييمات المشاريع»: the project's stars and comments. Anyone signed in rates — member or
 * not (owner's rule) — behind the complete-profile gate; a rater's name and photo show, and
 * NOTHING links back to his account. Resubmitting updates the member's own review.
 */
export function ProjectReviews({ projectId }: { projectId: string }) {
  const { status, me } = useAuth();
  const signedIn = status === 'signedIn';
  const query = useProjectReviews(projectId, signedIn && me ? String(me.id) : null);
  const summary = query.data?.summary ?? null;
  const reviews = query.data?.reviews ?? [];
  const myReview = reviews.find((review) => review.mine) ?? null;
  // M116d: ONE rating sheet for the whole app — this block and the title stars open the same modal.
  const [rateOpen, setRateOpen] = useState(false);

  return (
    <GlassCard radius={radii.xl} style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="star-outline" size={18} color={colors.gold} />
        <Text style={styles.title}>{t('ratings.title')}</Text>
        {summary && summary.stars !== null ? <StarsRow value={summary.stars} count={summary.count} size={15} /> : null}
      </View>

      {reviews.length === 0 ? <Text style={styles.empty}>{t('ratings.empty')}</Text> : null}
      {reviews.map((review) => (
        <ReviewRow key={review.id} review={review} />
      ))}

      <AppButton label={signedIn && myReview ? t('ratings.edit') : t('ratings.add')} icon="star-outline" variant="outline" onPress={() => setRateOpen(true)} />
      <RateProjectModal projectId={projectId} visible={rateOpen} onClose={() => setRateOpen(false)} />
    </GlassCard>
  );
}

function ReviewRow({ review }: { review: ProjectReview }) {
  const [photoBroken, setPhotoBroken] = useState(false);
  return (
    <View style={styles.review}>
      <View style={styles.avatar}>
        {review.photoUrl && !photoBroken ? (
          <Image source={{ uri: review.photoUrl }} style={styles.avatarImage} onError={() => setPhotoBroken(true)} />
        ) : (
          <Ionicons name="person" size={18} color={colors.goldDark} />
        )}
      </View>
      <View style={styles.reviewBody}>
        <View style={styles.reviewTop}>
          <Text style={styles.reviewName} numberOfLines={1}>
            {review.name}
          </Text>
          <Text style={styles.reviewAt}>{formatRelativeTime(review.at)}</Text>
        </View>
        <StarsRow value={review.stars} size={12} />
        {review.comment ? <Text style={styles.reviewText}>{review.comment}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.textPrimary, textAlign: textStart, flexShrink: 1 },
  empty: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  review: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  reviewBody: { flex: 1, gap: 3 },
  reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  reviewName: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.textPrimary, flexShrink: 1, textAlign: textStart },
  reviewAt: { ...typography.caption, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  reviewText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  gate: { gap: spacing.sm },
  composer: { gap: spacing.sm },
  pickLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
});

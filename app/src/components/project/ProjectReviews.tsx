import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { projectsApi, useProjectReviews } from '@/api/queries';
import type { ProjectReview } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { GlassCard } from '@/components/lux';
import { Notice } from '@/components/Notice';
import { isProfileGate, ProfileGateNotice } from '@/components/ProfileGate';
import { StarsPicker, StarsRow } from '@/components/Stars';
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const signedIn = status === 'signedIn';
  const query = useProjectReviews(projectId, signedIn && me ? String(me.id) : null);
  const summary = query.data?.summary ?? null;
  const reviews = query.data?.reviews ?? [];
  const myReview = reviews.find((review) => review.mine) ?? null;

  const [composing, setComposing] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const open = () => {
    setStars(myReview?.stars ?? 0);
    setComment(myReview?.comment ?? '');
    setDone(false);
    setError(null);
    setComposing(true);
  };

  async function submit() {
    if (busy || stars < 1) return;
    setBusy(true);
    setError(null);
    try {
      await projectsApi.review(projectId, stars, comment.trim());
      setDone(true);
      setComposing(false);
      await query.refetch();
      // The stars on the cards and the «الأعلى تقييمًا» order move with the new average.
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

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

      {done ? <Notice tone="success" text={t('ratings.thanks')} /> : null}

      {!signedIn ? (
        <View style={styles.gate}>
          <Notice text={t('ratings.signIn')} />
          <AppButton label={t('auth.login.title')} icon="log-in-outline" variant="outline" onPress={() => router.push('/auth/login')} />
        </View>
      ) : composing ? (
        <View style={styles.composer}>
          <Text style={styles.pickLabel}>{t('ratings.yourStars')}</Text>
          <StarsPicker value={stars} onChange={setStars} />
          <FormField
            label={t('ratings.commentLabel')}
            placeholder={t('ratings.commentPlaceholder')}
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={500}
          />
          {isProfileGate(error) ? (
            <ProfileGateNotice text={error instanceof ApiError ? error.message : ''} />
          ) : error ? (
            <Notice tone="warning" text={error instanceof ApiError ? error.message : t('errors.generic')} />
          ) : null}
          <AppButton
            label={myReview ? t('ratings.update') : t('ratings.submit')}
            icon="star"
            disabled={stars < 1}
            loading={busy}
            onPress={() => void submit()}
          />
        </View>
      ) : (
        <AppButton label={myReview ? t('ratings.edit') : t('ratings.add')} icon="star-outline" variant="outline" onPress={open} />
      )}
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

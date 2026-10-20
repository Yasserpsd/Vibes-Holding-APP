import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { projectsApi, useProjectReviews } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { isProfileGate, ProfileGateNotice } from '@/components/ProfileGate';
import { StarsPicker } from '@/components/Stars';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M116d (owner: «بمجرد ما ادوس علي النجوم يظهر بوب اب اقدر اضيف فيه التقييم بتاعي»): ONE rating
 * sheet for the whole app — opened from the stars under the project title and from the reviews
 * block alike. Prefills the member's own review; guests get the sign-in door.
 */
export function RateProjectModal({ projectId, visible, onClose }: { projectId: string; visible: boolean; onClose: () => void }) {
  const { status, me } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const signedIn = status === 'signedIn';
  const query = useProjectReviews(projectId, signedIn && me ? String(me.id) : null);
  const myReview = query.data?.reviews.find((review) => review.mine) ?? null;

  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Every opening starts from the member's current review, clean of the previous run
  // (derived-state reset during render, the React way — no setState inside an effect).
  const [seededFor, setSeededFor] = useState(false);
  if (visible !== seededFor) {
    setSeededFor(visible);
    if (visible) {
      setStars(myReview?.stars ?? 0);
      setComment(myReview?.comment ?? '');
      setDone(false);
      setError(null);
    }
  }

  async function submit() {
    if (busy || stars < 1) return;
    setBusy(true);
    setError(null);
    try {
      await projectsApi.review(projectId, stars, comment.trim());
      setDone(true);
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('ratings.close')} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none" style={styles.wrap}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Ionicons name="star" size={18} color={colors.gold} />
            <Text style={styles.title}>{myReview ? t('ratings.edit') : t('ratings.add')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('ratings.close')}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {!signedIn ? (
            <View style={styles.body}>
              <Notice text={t('ratings.signIn')} />
              <AppButton
                label={t('auth.login.title')}
                icon="log-in-outline"
                onPress={() => {
                  onClose();
                  router.push('/auth/login');
                }}
              />
            </View>
          ) : done ? (
            <View style={styles.body}>
              <Notice tone="success" text={t('ratings.thanks')} />
              <AppButton label={t('ratings.close')} variant="outline" onPress={onClose} />
            </View>
          ) : (
            <View style={styles.body}>
              <Text style={styles.pickLabel}>{t('ratings.yourStars')}</Text>
              <View style={styles.pickerRow}>
                <StarsPicker value={stars} onChange={setStars} />
              </View>
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
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.72)' },
  wrap: { flex: 1, justifyContent: 'flex-end', padding: spacing.md },
  sheet: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    gap: spacing.md,
    boxShadow: shadows.glowGoldFaint,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.textPrimary, flex: 1, textAlign: textStart },
  body: { gap: spacing.sm },
  pickLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  pickerRow: { alignItems: 'center', paddingVertical: spacing.xs },
});

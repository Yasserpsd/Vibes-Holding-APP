import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePost } from '@/api/posts';
import { AppButton } from '@/components/AppButton';
import { StateView } from '@/components/StateView';
import { formatRelativeTime } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/** One «رسائل الإدارة» post: text, images, a YouTube video and link buttons, all opened in-app. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = usePost(id);
  const post = query.data?.post;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'رسالة من الإدارة' }} />
      {!post ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.meta}>
            <View style={styles.badge}>
              <Ionicons name="megaphone-outline" size={14} color={colors.black} />
              <Text style={styles.badgeText}>رسائل الإدارة</Text>
            </View>
            {post.publishedAt ? <Text style={styles.time}>{formatRelativeTime(post.publishedAt)}</Text> : null}
          </View>
          <Text style={styles.title}>{post.title}</Text>
          {post.body ? <Text style={styles.body}>{post.body}</Text> : null}
          {post.youtubeId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تشغيل الفيديو"
              onPress={() => void openLink(`https://www.youtube.com/watch?v=${post.youtubeId}`)}
              style={({ pressed }) => [styles.video, pressed && styles.pressed]}
            >
              <Image source={{ uri: `https://img.youtube.com/vi/${post.youtubeId}/hqdefault.jpg` }} style={styles.videoImage} resizeMode="cover" />
              <View style={styles.play}>
                <Ionicons name="play" size={28} color={colors.black} />
              </View>
            </Pressable>
          ) : null}
          {post.images.map((uri) => (
            <Image key={uri} source={{ uri }} style={styles.image} resizeMode="cover" />
          ))}
          {post.links.map((link) => (
            <AppButton key={`${link.label}:${link.url}`} label={link.label} variant="outline" icon="open-outline" onPress={() => void openLink(link.url)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  // Padding sits on a View: Android measures a padded Text too narrow and truncates it.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.black },
  time: { ...typography.caption, color: colors.textMuted },
  title: { ...typography.title, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary },
  image: { width: '100%', height: 220, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
  video: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
  videoImage: { width: '100%', height: 200 },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: 72,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  pressed: { opacity: 0.85 },
});

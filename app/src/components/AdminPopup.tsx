import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Modal, ScrollView, Text, View } from 'react-native';

import { usePopups, type AdminPopupItem } from '@/api/posts';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn } from '@/components/motion';
import { t } from '@/i18n';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { sized } from '@/lib/imageUrl';
import { openLink } from '@/lib/openLink';
import { claimAutoPopup, useAutoPopupFree, usePopupHold } from '@/lib/popupGate';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const SEEN_KEY = 'investorsclub.adminPopups.seen';
const SEEN_MAX = 60;

/**
 * M232 (owner: «أقدر أضيف بوب اب من داشبورد»): a popup the management published from the dashboard («أدوات التواصل»).
 * The server sends only what this viewer may see (never to an honorary member); the device shows each popup ONCE, and
 * it shares the single automatic-popup slot of a launch (M128), so it never opens on top of another popup.
 */
export function AdminPopup() {
  const { status, me } = useAuth();
  const pathname = usePathname();
  const quiet = pathname.startsWith('/auth') || pathname.startsWith('/phone-confirm');
  const popups = usePopups(status === 'signedIn' && me ? String(me.id) : 'guest', status !== 'loading').data?.popups;
  /** Ids this device already showed; null until the stored list loads (nothing opens before it). */
  const [seen, setSeen] = useState<string[] | null>(null);
  const [open, setOpen] = useState<AdminPopupItem | null>(null);
  const free = useAutoPopupFree();

  useEffect(() => {
    let alive = true;
    void loadSetting(SEEN_KEY).then((raw) => {
      if (!alive) return;
      try {
        const stored: unknown = raw ? JSON.parse(raw) : [];
        setSeen(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
      } catch {
        setSeen([]);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const next = !open && seen && !quiet ? (popups?.find((popup) => !seen.includes(popup.id)) ?? null) : null;

  useEffect(() => {
    if (!next || !seen) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive || !claimAutoPopup()) return;
      // Shown = seen: a popup never comes back, even when the app is closed while it is up.
      const marked = [next.id, ...seen].slice(0, SEEN_MAX);
      setSeen(marked);
      void saveSetting(SEEN_KEY, JSON.stringify(marked));
      setOpen(next);
    });
    return () => {
      alive = false;
    };
  }, [next, seen, free]);

  usePopupHold(open !== null);
  if (!open) return null;
  const close = () => setOpen(null);
  const link = open.link;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={styles.backdrop}>
        <PopIn style={styles.wrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              {open.image ? <Image source={{ uri: sized(open.image, 340) }} style={styles.image} resizeMode="cover" /> : null}
              <Text style={styles.title}>{open.title}</Text>
              {open.body ? <Text style={styles.text}>{open.body}</Text> : null}
            </ScrollView>
            {link ? (
              <AppButton
                label={link.label}
                icon="open-outline"
                onPress={() => {
                  close();
                  void openLink(link.url);
                }}
              />
            ) : null}
            <AppButton label={t('common.close')} variant="outline" onPress={close} />
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.overlay },
  wrap: { width: '100%', maxWidth: 380, maxHeight: '86%' },
  card: { padding: spacing.lg, gap: spacing.sm, alignItems: 'stretch' },
  content: { gap: spacing.sm },
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: 'center' },
  text: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
}));

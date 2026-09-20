import type { ReactElement, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, type RefreshControlProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { colors, spacing, typography } from '@/theme/tokens';

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
};

/** Scrollable screen with keyboard handling, used by forms and detail pages. */
export function Screen({ title, subtitle, children, refreshControl, edges = ['top'], aboveTabBar = false }: Props) {
  // The bottom padding keeps the last element clear of the floating «اسأل المستشار» button. Without a tab bar or
  // a bottom safe-area edge under it, the scroll view runs to the physical bottom edge and the inset counts too.
  const clearance = useAskAdvisorClearance(aboveTabBar || edges.includes('bottom'));
  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          {title ? (
            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          ) : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.black },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { gap: spacing.xs, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.gold, textAlign: 'right' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'right' },
});

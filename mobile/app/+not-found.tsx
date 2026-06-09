import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Link, Stack } from 'expo-router';
import { colors, spacing, typography } from '@/theme';

/** Fallback shown for any unmatched route. */
export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '없는 페이지' }} />
      <View style={styles.container}>
        <Text style={styles.code}>404</Text>
        <Text style={styles.message}>요청한 화면을 찾을 수 없습니다.</Text>
        <Link href="/" style={styles.link}>
          홈으로 돌아가기
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  code: { ...typography.display, color: colors.accent },
  message: { ...typography.body, color: colors.textMuted },
  link: { ...typography.heading, color: colors.text, marginTop: spacing.md },
});

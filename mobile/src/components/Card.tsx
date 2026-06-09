import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '@/theme';

/** Elevated surface container with the app's standard border and padding. */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});

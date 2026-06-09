import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';
import type { PortfolioItem } from '@/types';

/** Two-column grid of link/portfolio tiles, echoing the web grid template. */
export function PortfolioGrid({ items }: { items: PortfolioItem[] }) {
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <View key={item.id} style={styles.tile}>
          <View style={[styles.swatch, { backgroundColor: item.swatch }]} />
          <Text style={styles.platform}>{item.platform}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.clicks}>{item.clicks.toLocaleString('ko-KR')} 클릭</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    width: '47.5%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  swatch: {
    height: 64,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  platform: { ...typography.caption, color: colors.accent, letterSpacing: 0.5 },
  title: { ...typography.body, color: colors.text, fontWeight: '600' },
  clicks: { ...typography.caption, color: colors.textMuted },
});

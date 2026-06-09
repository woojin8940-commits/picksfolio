import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/Card';
import { colors, typography } from '@/theme';

interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
}

/** Compact metric tile for the home dashboard summary row. */
export function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <Card style={styles.tile}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, gap: 4 },
  label: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.title, color: colors.text },
  hint: { ...typography.caption, color: colors.accent },
});

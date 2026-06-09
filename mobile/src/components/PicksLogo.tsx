import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius } from '@/theme';

/** The PICKS Folio wordmark — a small gold monogram tile beside the name. */
export function PicksLogo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const tile = size === 'sm' ? 24 : 32;
  const font = size === 'sm' ? 14 : 18;
  return (
    <View style={styles.row}>
      <View style={[styles.tile, { width: tile, height: tile }]}>
        <Text style={[styles.mark, { fontSize: font }]}>P</Text>
      </View>
      <Text style={[styles.word, { fontSize: font }]}>
        PICKS <Text style={styles.folio}>Folio</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tile: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { color: colors.background, fontWeight: '800' },
  word: { color: colors.text, fontWeight: '700', letterSpacing: 0.5 },
  folio: { color: colors.accent, fontWeight: '600' },
});

import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CampaignCard } from '@/components/CampaignCard';
import { sampleCampaigns } from '@/data/mockData';
import { colors, radius, spacing, typography } from '@/theme';
import type { CampaignStatus } from '@/types';

type Filter = 'all' | CampaignStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'invited', label: '제안' },
  { key: 'in_progress', label: '진행 중' },
  { key: 'completed', label: '완료' },
];

/** Campaign inbox with status filtering. */
export default function CampaignsScreen() {
  const [filter, setFilter] = useState<Filter>('all');

  const campaigns = useMemo(
    () =>
      filter === 'all'
        ? sampleCampaigns
        : sampleCampaigns.filter((c) => c.status === filter),
    [filter],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="캠페인" subtitle="브랜드 협업 제안을 한눈에." />
      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {campaigns.length === 0 ? (
          <Text style={styles.empty}>해당 상태의 캠페인이 없어요.</Text>
        ) : (
          campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.accent },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxl },
});

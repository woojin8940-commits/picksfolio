import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/Card';
import { colors, radius, spacing, typography } from '@/theme';
import type { Campaign, CampaignStatus } from '@/types';

const STATUS_LABEL: Record<CampaignStatus, string> = {
  invited: '제안 도착',
  in_progress: '진행 중',
  completed: '완료',
};

const STATUS_COLOR: Record<CampaignStatus, string> = {
  invited: colors.accent,
  in_progress: colors.success,
  completed: colors.textFaint,
};

function formatKRW(value: number): string {
  return `₩${value.toLocaleString('ko-KR')}`;
}

/** A single brand collaboration campaign row. */
export function CampaignCard({ campaign }: { campaign: Campaign }) {
  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.brand}>{campaign.brand}</Text>
        <View style={[styles.badge, { borderColor: STATUS_COLOR[campaign.status] }]}>
          <Text style={[styles.badgeText, { color: STATUS_COLOR[campaign.status] }]}>
            {STATUS_LABEL[campaign.status]}
          </Text>
        </View>
      </View>
      <Text style={styles.title}>{campaign.title}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{campaign.category}</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.meta}>마감 {campaign.deadline}</Text>
      </View>
      <Text style={styles.reward}>{formatKRW(campaign.reward)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { ...typography.caption, color: colors.textMuted, letterSpacing: 1 },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { ...typography.caption },
  title: { ...typography.heading, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { ...typography.caption, color: colors.textMuted },
  dot: { color: colors.textFaint },
  reward: { ...typography.heading, color: colors.accent, marginTop: 2 },
});

import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StatTile } from '@/components/StatTile';
import { CampaignCard } from '@/components/CampaignCard';
import { PicksLogo } from '@/components/PicksLogo';
import { useAuth } from '@/hooks/useAuth';
import { sampleCampaigns, sampleStats } from '@/data/mockData';
import { colors, spacing, typography } from '@/theme';

function formatCount(value: number): string {
  return value.toLocaleString('ko-KR');
}

/** Home dashboard: greeting, key metrics, and the latest campaign activity. */
export default function HomeScreen() {
  const { profile } = useAuth();
  const recent = sampleCampaigns.filter((c) => c.status !== 'completed').slice(0, 3);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={`안녕하세요,\n${profile?.displayName ?? '크리에이터'}님`}
        subtitle="오늘의 PICKS Folio 현황이에요."
        right={<PicksLogo size="sm" />}
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <StatTile
            label="이번 달 수익"
            value={`₩${formatCount(sampleStats.monthlyEarnings)}`}
            hint="+12.4%"
          />
          <StatTile label="총 클릭" value={formatCount(sampleStats.totalClicks)} />
        </View>
        <View style={styles.statsRow}>
          <StatTile label="진행 중 캠페인" value={`${sampleStats.activeCampaigns}건`} />
          <StatTile
            label="월간 조회수"
            value={formatCount(profile?.monthlyViews ?? 0)}
          />
        </View>

        <Text style={styles.sectionTitle}>최근 캠페인</Text>
        <View style={styles.list}>
          {recent.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  sectionTitle: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  list: { gap: spacing.md },
});

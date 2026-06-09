import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PortfolioGrid } from '@/components/PortfolioGrid';
import { samplePortfolio } from '@/data/mockData';
import { colors, spacing, typography } from '@/theme';

/** Portfolio tab: the creator's grid of curated links. */
export default function PortfolioScreen() {
  const totalClicks = samplePortfolio.reduce((sum, item) => sum + item.clicks, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="포트폴리오"
        subtitle={`${samplePortfolio.length}개 링크 · ${totalClicks.toLocaleString('ko-KR')} 클릭`}
      />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <PortfolioGrid items={samplePortfolio} />
        <Text style={styles.note}>
          그리드 순서와 디자인은 PICKS Folio 웹에서 편집할 수 있어요.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
  note: {
    ...typography.caption,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

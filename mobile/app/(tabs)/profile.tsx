import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { useAuth } from '@/hooks/useAuth';
import { colors, radius, spacing, typography } from '@/theme';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** Profile tab: creator identity, reach summary, and sign-out. */
export default function ProfileScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuth();

  async function onSignOut() {
    await signOut();
    router.replace('/login');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="프로필" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Card style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: profile?.avatarColor ?? colors.accent }]}>
            <Text style={styles.avatarText}>
              {(profile?.displayName ?? 'P').slice(0, 1)}
            </Text>
          </View>
          <Text style={styles.name}>{profile?.displayName ?? '크리에이터'}</Text>
          <Text style={styles.handle}>@{profile?.handle ?? 'guest'}</Text>
          <Text style={styles.bio}>{profile?.bio ?? ''}</Text>
        </Card>

        <Card>
          <Row label="팔로워" value={(profile?.followers ?? 0).toLocaleString('ko-KR')} />
          <View style={styles.divider} />
          <Row label="월간 조회수" value={(profile?.monthlyViews ?? 0).toLocaleString('ko-KR')} />
        </Card>

        <Pressable onPress={onSignOut} style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.8 }]}>
          <Text style={styles.signOutText}>로그아웃</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  identity: { alignItems: 'center', gap: spacing.xs },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { ...typography.display, color: colors.background },
  name: { ...typography.title, color: colors.text },
  handle: { ...typography.body, color: colors.accent },
  bio: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...typography.body, color: colors.textMuted },
  rowValue: { ...typography.heading, color: colors.text },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  signOut: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  signOutText: { ...typography.heading, color: colors.danger },
});

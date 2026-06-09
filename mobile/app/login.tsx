import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PicksLogo } from '@/components/PicksLogo';
import { useAuth } from '@/hooks/useAuth';
import { colors, radius, spacing, typography } from '@/theme';

/** Lightweight handle-based sign-in screen. */
export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    await signIn(handle.trim() || 'guest');
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.brand}>
          <PicksLogo />
        </View>
        <Text style={styles.title}>크리에이터 로그인</Text>
        <Text style={styles.subtitle}>
          PICKS Folio 핸들로 포트폴리오와 협업 제안을 관리하세요.
        </Text>

        <Text style={styles.label}>핸들</Text>
        <View style={styles.inputRow}>
          <Text style={styles.at}>@</Text>
          <TextInput
            value={handle}
            onChangeText={setHandle}
            placeholder="soo.curates"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        <Pressable
          onPress={onSubmit}
          disabled={busy}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>{busy ? '로그인 중…' : '시작하기'}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'center' },
  brand: { marginBottom: spacing.xl },
  title: { ...typography.display, color: colors.text },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  label: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  at: { ...typography.heading, color: colors.textFaint },
  input: {
    flex: 1,
    color: colors.text,
    paddingVertical: spacing.lg,
    paddingLeft: spacing.xs,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { ...typography.heading, color: colors.background },
});

import { getCheckedBlobStore } from "./blob-write.mts";

interface SmsBudget { day: string; used: number }
export class SmsBudgetError extends Error {
  constructor(public readonly status: 429 | 503, public readonly code: string) {
    super(status === 429 ? "인증문자 일일 발송 한도에 도달했습니다. 내일 다시 시도해 주세요." : "인증문자 발송 한도를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "SmsBudgetError";
  }
}

export async function reserveSmsVerificationBudget(): Promise<void> {
  const raw = process.env.SMS_VERIFICATION_DAILY_LIMIT ?? "1000";
  if (!/^[1-9]\d{0,5}$/.test(raw)) throw new SmsBudgetError(503, "SMS_BUDGET_NOT_CONFIGURED");
  const limit = Number(raw);
  const day = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10);
  try {
    const store = getCheckedBlobStore("sms-budget");
    const key = `verification/${day}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const snapshot = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
      const current = snapshot?.data as SmsBudget | null;
      if (snapshot && (!current || typeof current !== "object" || Array.isArray(current) ||
        current.day !== day || !Number.isSafeInteger(current.used) || current.used < 0 || !snapshot.etag)) {
        throw new Error("Invalid SMS budget state");
      }
      const used = current?.used ?? 0;
      if (used >= limit) throw new SmsBudgetError(429, "SMS_DAILY_LIMIT");
      const result = await store.set(key, JSON.stringify({ day, used: used + 1 }),
        snapshot ? { onlyIfMatch: snapshot.etag! } : { onlyIfNew: true });
      if (result.modified) return;
    }
    throw new Error("SMS budget changed concurrently");
  } catch (error) {
    if (error instanceof SmsBudgetError) throw error;
    throw new SmsBudgetError(503, "SMS_BUDGET_UNAVAILABLE");
  }
  // A failed or uncertain provider request still consumes its reservation.
}

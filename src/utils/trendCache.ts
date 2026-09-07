type TrendCachePayload<T> = {
  categories: T[];
  updatedAt: string | null;
  savedAt: number;
};

const keyFor = (language: string) => `picks_trend_categories_${language || 'ko'}`;

export function readTrendCache<T>(language: string): TrendCachePayload<T> | null {
  try {
    const raw = localStorage.getItem(keyFor(language));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrendCachePayload<T>;
    return Array.isArray(parsed.categories) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeTrendCache<T>(language: string, categories: T[], updatedAt: string | null): void {
  try {
    localStorage.setItem(keyFor(language), JSON.stringify({
      categories,
      updatedAt,
      savedAt: Date.now(),
    }));
  } catch {}
}

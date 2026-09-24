import { getStore } from "@netlify/blobs";

interface ManualCursor {
  media: Record<string, string | null>;
  updatedAt: string;
}

const store = () => getStore({ name: "dm-manual-cursors", consistency: "strong" });
const keyOf = (username: string, batchKey: string) => `${username.toLowerCase()}/${batchKey}`;

export async function loadManualCursor(
  username: string,
  batchKey: string,
): Promise<Record<string, string | null>> {
  const saved = (await store().get(keyOf(username, batchKey), { type: "json" })) as ManualCursor | null;
  if (!saved || Date.now() - Date.parse(saved.updatedAt) > 7 * 24 * 60 * 60 * 1000) return {};
  return saved.media && typeof saved.media === "object" ? saved.media : {};
}

export async function saveManualCursor(
  username: string,
  batchKey: string,
  media: Record<string, string | null>,
): Promise<void> {
  await store().setJSON(keyOf(username, batchKey), { media, updatedAt: new Date().toISOString() });
}

export async function clearManualCursor(username: string, batchKey: string): Promise<void> {
  await store().delete(keyOf(username, batchKey));
}

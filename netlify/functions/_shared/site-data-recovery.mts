import { getStore } from "@netlify/blobs";

type Database = {
  sql: (strings: TemplateStringsArray, ...values: any[]) => any;
};

const LEGACY_SITE_DATA_ALIASES: Record<string, string[]> = {
  dnwlsdnwls: ["dnwlsdnwls123"],
  dnwlsdnwls123: ["dnwlsdnwls"],
};

export function generateProfileCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function siteDataBlobKeys(username: string): string[] {
  const clean = username.trim().toLowerCase();
  const aliases = LEGACY_SITE_DATA_ALIASES[clean] || [];
  const keys = [
    clean,
    `site_${clean}`,
    `site-data/${clean}`,
    `user/${clean}`,
    ...aliases,
    ...aliases.map((alias) => `site_${alias}`),
    ...aliases.map((alias) => `site-data/${alias}`),
    ...aliases.map((alias) => `user/${alias}`),
  ];
  return Array.from(new Set(keys.filter(Boolean)));
}

export function hasConnectedSiteContent(data: Record<string, any>): boolean {
  return (
    (Array.isArray(data.blocks) && data.blocks.length > 0) ||
    (Array.isArray(data.portfolio) && data.portfolio.length > 0) ||
    (Array.isArray(data.productFolders) && data.productFolders.length > 0)
  );
}

export async function createUniqueProfileCode(db: Database): Promise<string> {
  let profileCode = generateProfileCode();
  let attempts = 0;
  while (attempts < 10) {
    const dup = await db.sql`
      SELECT 1 FROM site_data WHERE profile_code = ${profileCode}
    `;
    if (dup.length === 0) break;
    profileCode = generateProfileCode();
    attempts++;
  }
  return profileCode;
}

export async function recoverSiteDataFromBlob(db: Database, username: string): Promise<Record<string, any> | null> {
  const clean = username.trim().toLowerCase();
  const blobStore = getStore({ name: "site-data", consistency: "strong" });

  for (const key of siteDataBlobKeys(clean)) {
    const blobData = await blobStore.get(key, { type: "json" }) as Record<string, any> | null;
    if (!blobData || Object.keys(blobData).length === 0) continue;

    const existing = await db.sql`
      SELECT profile_code FROM site_data WHERE username = ${clean}
    `;
    const profileCode = existing[0]?.profile_code || await createUniqueProfileCode(db);

    await db.sql`
      INSERT INTO site_data (username, data, profile_code)
      VALUES (${clean}, ${JSON.stringify(blobData)}::jsonb, ${profileCode})
      ON CONFLICT (username) DO UPDATE
      SET data = ${JSON.stringify(blobData)}::jsonb,
          updated_at = NOW()
    `;

    if (key !== clean) {
      await blobStore.setJSON(clean, blobData);
    }

    return blobData;
  }

  return null;
}

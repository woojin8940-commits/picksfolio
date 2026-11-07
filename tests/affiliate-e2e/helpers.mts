// 어필리에이트 e2e 테스트 공용 준비: PGlite 에 마이그레이션 전체를 올리고 API 핸들러를 부른다.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "netlify/database/migrations");

export async function setupDatabase() {
  // node-postgres 처럼 bigint · numeric 은 문자열로 받는다(운영 드라이버와 같게).
  const pg = new PGlite({ parsers: { 20: (v: string) => v, 1700: (v: string) => v } });
  for (const dir of fs.readdirSync(MIGRATIONS).sort()) {
    const file = path.join(MIGRATIONS, dir, "migration.sql");
    if (fs.existsSync(file)) await pg.exec(fs.readFileSync(file, "utf8"));
  }
  (globalThis as any).__AFFILIATE_TEST_PG = pg;
  return pg;
}

type Handler = (req: Request) => Promise<Response>;

export async function loadHandlers() {
  const store = (await import("../../netlify/functions/api-affiliate-store.mts")).default as Handler;
  const ops = (await import("../../netlify/functions/api-affiliate-store-ops.mts")).default as Handler;
  const payouts = (await import("../../netlify/functions/api-affiliate-payouts.mts")).default as Handler;
  return { store, ops, payouts };
}

export interface CallResult { status: number; body: any }

/** 핸들러를 부른다. as = 로그인 아이디(운영자는 "아이디:admin"). */
export async function call(handler: Handler, as: string | null, method: "GET" | "POST", pathAndQuery: string, body?: unknown): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as) headers.authorization = `Bearer test:${as}`;
  const req = new Request(`http://localhost${pathAndQuery}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const res = await handler(req);
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* CSV 등 */ }
  return { status: res.status, body: parsed };
}

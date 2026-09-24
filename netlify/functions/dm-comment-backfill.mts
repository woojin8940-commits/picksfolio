import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { graphHostFor, linkFeatureOff, type MetaLink } from "./_shared/instagram-metrics.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { processWebhookPayload } from "./instagram-webhook.mts";

const GRAPH_VERSION = "v21.0";
const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WORK_BUDGET_MS = 12 * 60 * 1000;
const MAX_MEDIA = 400;
const MAX_COMMENT_PAGES_PER_MEDIA = 20;

type Rule = {
  id: string;
  enabled: boolean;
  sendMode?: string;
  scheduledAt?: string;
  mediaScope?: string;
  mediaIds?: string[];
};

type Settings = MetaLink & {
  enabled?: boolean;
  igUserId?: string;
  igAccountId?: string;
  igUsername?: string;
  accessToken?: string;
  tokenSource?: string;
  ownerAuthUserId?: string;
  automations?: Rule[];
};

async function graphPage(host: string, path: string, token: string, params: URLSearchParams) {
  const response = await fetch(`https://${host}/${GRAPH_VERSION}/${path}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || !Array.isArray(body?.data)) {
    throw new Error(String(body?.error?.message || `Instagram HTTP ${response.status}`));
  }
  return body;
}

async function mediaForRule(host: string, igId: string, token: string, rule: Rule, deadline: number) {
  if (rule.mediaScope === "selected") {
    return { ids: [...new Set((rule.mediaIds || []).filter(Boolean))].slice(0, 50), incomplete: false };
  }

  const ids: string[] = [];
  let after = "";
  let incomplete = false;
  while (ids.length < MAX_MEDIA && Date.now() < deadline) {
    const params = new URLSearchParams({ fields: "id", limit: "50" });
    if (after) params.set("after", after);
    const page = await graphPage(host, `${encodeURIComponent(igId)}/media`, token, params);
    ids.push(...page.data.map((item: any) => String(item?.id || "")).filter(Boolean));
    const next = page?.paging?.next ? String(page?.paging?.cursors?.after || "") : "";
    if (!next) return { ids: ids.slice(0, MAX_MEDIA), incomplete: false };
    if (next === after) break;
    after = next;
  }
  incomplete = Boolean(after);
  return { ids: ids.slice(0, MAX_MEDIA), incomplete };
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const username = String(context.params.username || "").toLowerCase();
  if (!username) return new Response(null, { status: 400 });

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const ruleId = String(body.ruleId || "");
  if (!ruleId) return new Response(null, { status: 400 });

  const settings = await getStore({ name: "dm-automation", consistency: "strong" })
    .get(`dm_${username}`, { type: "json" }) as Settings | null;
  const rule = settings?.automations?.find((item) => item.id === ruleId);
  const scheduledAt = Date.parse(rule?.scheduledAt || "");
  if (!settings?.enabled || !settings.accessToken || !rule?.enabled ||
    rule.sendMode !== "scheduled" || Number.isNaN(scheduledAt) ||
    linkFeatureOff(settings, "dm") ||
    !(await dmAutomationAllowed(username, settings.ownerAuthUserId))) {
    return new Response(null, { status: 204 });
  }

  const igId = String(settings.igUserId || settings.igAccountId || "");
  if (!igId) return new Response(null, { status: 204 });
  const host = graphHostFor(settings.tokenSource);
  const deadline = Date.now() + WORK_BUDGET_MS;
  const media = await mediaForRule(host, igId, settings.accessToken, rule, deadline);
  let incomplete = media.incomplete;
  let queued = 0;

  for (const mediaId of media.ids) {
    let after = "";
    let pages = 0;
    while (pages < MAX_COMMENT_PAGES_PER_MEDIA && Date.now() < deadline) {
      const params = new URLSearchParams({
        fields: "id,text,from,username,timestamp",
        limit: "100",
      });
      if (after) params.set("after", after);
      const page = await graphPage(host, `${encodeURIComponent(mediaId)}/comments`, settings.accessToken, params);
      const sendAt = Math.max(scheduledAt, Date.now());
      const changes = page.data.flatMap((comment: any) => {
        const commentId = String(comment?.id || "");
        const commentAt = Date.parse(String(comment?.timestamp || ""));
        const authorId = String(comment?.from?.id || "");
        const authorName = String(comment?.from?.username || comment?.username || "");
        if (!commentId || Number.isNaN(commentAt) || commentAt > Date.now() ||
          commentAt + REPLY_WINDOW_MS <= sendAt + 60_000 ||
          authorId === igId ||
          (authorName && authorName.toLowerCase() === String(settings.igUsername || "").toLowerCase())) {
          return [];
        }
        return [{
          field: "comments",
          value: {
            id: commentId,
            text: String(comment?.text || ""),
            from: { id: authorId, username: authorName },
            media: { id: mediaId },
            timestamp: comment?.timestamp,
          },
        }];
      });
      if (changes.length > 0) {
        const result = await processWebhookPayload({ entry: [{ id: igId, changes }] }, false, ruleId);
        if (result.retryable) throw new Error(result.error || "Comment scheduling failed");
        queued += changes.length;
      }
      pages += 1;
      const next = page?.paging?.next ? String(page?.paging?.cursors?.after || "") : "";
      if (!next) {
        after = "";
        break;
      }
      if (next === after) {
        incomplete = true;
        break;
      }
      after = next;
    }
    if (after || Date.now() >= deadline) incomplete = true;
    if (Date.now() >= deadline) break;
  }

  if (incomplete) console.warn("[dm-backfill] scan incomplete", username, ruleId, queued);
  return new Response(null, { status: 204 });
};

export const config: Config = {
  path: "/api/dm-comment-backfill/:username",
  background: true,
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: "ip" },
};

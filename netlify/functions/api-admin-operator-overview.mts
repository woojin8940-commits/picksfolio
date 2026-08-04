import { getDatabase } from '@picks/netlify-database'
import { getStore } from '@netlify/blobs'
import { getSupabaseServer } from './_shared/supabase.mts'
import { requireAdmin } from './_shared/admin-auth.mts'
import type { Config, Context } from '@netlify/functions'

/**
 * 운영자 전체 현황 집계 — GET /api/admin/operator-overview
 *
 * 운영자가 대시보드를 열었을 때 제일 먼저 답이 필요한 세 가지를 한 번에 계산한다.
 *
 *   1) 브랜드 매칭에 지원한 인플루언서가 몇 명이고 어디까지 검토됐는지
 *   2) 픽스폴리오에 가입한 계정이 몇 개인지 (인플루언서 / 비즈니스)
 *   3) 광고비가 들어가는 캠페인의 예산과 우리 수익이 얼마인지
 *
 * 캠페인 수익을 이 서버에서 계산하는 이유가 있다. 우리 수익은 "브랜드에게 제시한
 * 금액(campaign_listups.quoted_fee) − 인플루언서에게 지급하는 금액(offer.fee)"의
 * 차액인데, 두 값은 후보 한 행에 나란히 들어 있다. 화면에서 계산하려면 모든 캠페인의
 * 모든 후보를 브라우저로 내려야 하고, 후보가 늘어날수록 첫 화면이 느려진다.
 *
 * 값이 비어 있는 행을 마진 합계에 넣지 않는 것도 중요하다. 견적을 아직 적지 않은
 * 행(quoted_fee = 0)을 함께 더하면 마진이 인플루언서 단가만큼 마이너스로 찍혀서,
 * 실제로는 이익이 나는 캠페인이 손실처럼 보인다. 그래서 두 값이 모두 있는 행만
 * 마진으로 세고, 빠진 행 수를 따로 돌려준다 — 숫자가 부분집계임을 화면이 말할 수 있게.
 */

const num = (raw: unknown) => {
  const n = Number(raw || 0)
  return Number.isFinite(n) ? n : 0
}

/** AI(클로드) 지갑 집계. 결제액과 실제 추론 원가의 차이가 순이익이다. */
async function aiRevenue() {
  const empty = {
    chargedKrw: 0,
    refundedKrw: 0,
    netChargedKrw: 0,
    rawCostKrw: 0,
    netProfitKrw: 0,
    paidWallets: 0,
    activePlans: 0,
    requests: 0,
  }
  try {
    const store = getStore({ name: 'claude-credits', consistency: 'strong' })
    const { blobs } = await store.list({ prefix: 'credits_' })
    // 지갑은 계정당 한 개다. 계정이 늘어도 첫 화면이 느려지지 않도록 상한을 둔다.
    const keys = (blobs || []).slice(0, 600).map((b: any) => b.key)
    const wallets = await Promise.all(
      keys.map((key) => store.get(key, { type: 'json' }).catch(() => null)),
    )
    const out = { ...empty }
    for (const w of wallets as any[]) {
      if (!w) continue
      const charged = num(w.lifetimeChargedKrw)
      const refunded = num(w.lifetimeRefundedKrw)
      out.chargedKrw += charged
      out.refundedKrw += refunded
      if (charged > 0) out.paidWallets++
      if (w.planActive) out.activePlans++
      for (const u of Array.isArray(w.usage) ? w.usage : []) {
        out.rawCostKrw += num(u?.costKrw)
        out.requests++
      }
    }
    out.netChargedKrw = Math.max(0, out.chargedKrw - out.refundedKrw)
    out.rawCostKrw = Math.round(out.rawCostKrw)
    out.netProfitKrw = Math.round(out.netChargedKrw - out.rawCostKrw)
    return out
  } catch {
    // 스토어가 아직 비어 있거나 조회에 실패해도 나머지 집계는 보여 줘야 한다.
    return empty
  }
}

/** 가입 계정 수. Supabase profiles 가 원본이다. */
async function accountCounts() {
  const empty = {
    influencers: 0,
    businesses: 0,
    total: 0,
    today: 0,
    last7d: 0,
    last30d: 0,
    available: false,
  }
  try {
    const supabase = getSupabaseServer()
    const [{ data: infRows }, { data: bizRows }] = await Promise.all([
      supabase.from('profiles').select('created_at').or('role.is.null,role.eq.user'),
      supabase.from('profiles').select('created_at').eq('role', 'business'),
    ])
    const now = Date.now()
    const todayStr = new Date(now).toISOString().slice(0, 10)
    const d7 = now - 7 * 24 * 60 * 60 * 1000
    const d30 = now - 30 * 24 * 60 * 60 * 1000
    const all = [...(infRows || []), ...(bizRows || [])] as any[]
    return {
      influencers: (infRows || []).length,
      businesses: (bizRows || []).length,
      total: all.length,
      today: all.filter((p) => String(p.created_at || '').startsWith(todayStr)).length,
      last7d: all.filter((p) => p.created_at && new Date(p.created_at).getTime() >= d7).length,
      last30d: all.filter((p) => p.created_at && new Date(p.created_at).getTime() >= d30).length,
      available: true,
    }
  } catch {
    return empty
  }
}

export default async (req: Request, _context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const db = getDatabase()

  try {
    const [
      accounts,
      ai,
      directoryRows,
      directoryRecent,
      campaignRows,
      listupRows,
      collabRows,
      applicationRows,
    ] = await Promise.all([
      accountCounts(),
      aiRevenue(),

      // 브랜드 매칭 지원 현황. 역할·검토 상태별로 세고, 지표가 연동된 계정 수까지
      // 함께 본다 — 지표가 없는 지원자는 담당자가 손으로 확인해야 하는 대기 작업이다.
      db.sql`
        SELECT role,
               COALESCE(NULLIF(status, ''), 'pending') AS status,
               COUNT(*)::int AS cnt,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS recent7d,
               COUNT(*) FILTER (WHERE COALESCE(NULLIF(instagram_followers, 0), follower_count) > 0)::int AS with_followers,
               COALESCE(SUM(COALESCE(NULLIF(instagram_followers, 0), follower_count)), 0)::bigint AS follower_sum
        FROM collab_directory_applications
        GROUP BY role, COALESCE(NULLIF(status, ''), 'pending')
      ` as Promise<any[]>,

      db.sql`
        SELECT id, role, applicant_username, name, category, status, created_at,
               COALESCE(NULLIF(instagram_followers, 0), follower_count) AS followers
        FROM collab_directory_applications
        WHERE role = 'influencer'
        ORDER BY created_at DESC
        LIMIT 6
      ` as Promise<any[]>,

      // 캠페인 예산. reward_amount 는 TEXT(1인 단가)라서 총 예산은 budget_krw 를 쓴다.
      db.sql`
        SELECT status,
               COUNT(*)::int AS cnt,
               COALESCE(SUM(COALESCE(budget_krw, 0)), 0)::bigint AS budget_sum,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS recent30d
        FROM campaigns
        GROUP BY status
      ` as Promise<any[]>,

      // 리스트업 단계별 금액. 브랜드 제시가(quoted)와 인플루언서 지급가(offer)를
      // 나란히 합쳐 두면 차액이 곧 우리 수익이 된다.
      //
      // offer JSONB 의 금액은 담당자 폼을 거쳐 들어오므로 숫자가 아닌 값이 섞일 수
      // 있다. 바로 ::numeric 으로 캐스팅하면 그 한 행 때문에 집계 전체가 500 으로
      // 죽는다. 그래서 숫자 타입이거나 숫자 문자열일 때만 더한다.
      db.sql`
        WITH priced AS (
          SELECT outreach_status,
                 brand_decision,
                 COALESCE(quoted_fee, 0) + COALESCE(quoted_second_use_fee, 0) AS brand_amount,
                 CASE
                   WHEN jsonb_typeof(offer->'fee') = 'number' THEN (offer->>'fee')::numeric
                   WHEN offer->>'fee' ~ '^[0-9]+$' THEN (offer->>'fee')::numeric
                   ELSE 0
                 END AS offer_fee,
                 CASE
                   WHEN jsonb_typeof(offer->'secondUseFee') = 'number' THEN (offer->>'secondUseFee')::numeric
                   WHEN offer->>'secondUseFee' ~ '^[0-9]+$' THEN (offer->>'secondUseFee')::numeric
                   ELSE 0
                 END AS offer_second_fee
          FROM campaign_listups
        )
        SELECT outreach_status,
               brand_decision,
               COUNT(*)::int AS cnt,
               COALESCE(SUM(brand_amount), 0)::bigint AS brand_amount,
               COALESCE(SUM(offer_fee + offer_second_fee), 0)::bigint AS influencer_cost,
               COUNT(*) FILTER (WHERE brand_amount > 0 AND offer_fee > 0)::int AS priced_both,
               COALESCE(SUM(
                 CASE WHEN brand_amount > 0 AND offer_fee > 0
                   THEN brand_amount - (offer_fee + offer_second_fee)
                   ELSE 0 END
               ), 0)::bigint AS margin_amount
        FROM priced
        GROUP BY outreach_status, brand_decision
      ` as Promise<any[]>,

      db.sql`
        SELECT status, COUNT(*)::int AS cnt
        FROM campaign_collabs
        GROUP BY status
      ` as Promise<any[]>,

      db.sql`
        SELECT COALESCE(NULLIF(source, ''), 'apply') AS source,
               status,
               COUNT(*)::int AS cnt
        FROM campaign_applications
        GROUP BY COALESCE(NULLIF(source, ''), 'apply'), status
      ` as Promise<any[]>,
    ])

    // ── 브랜드 매칭 지원자 ────────────────────────────────────────────────
    const directory = {
      influencer: { total: 0, pending: 0, reviewed: 0, contacted: 0, archived: 0, recent7d: 0, withFollowers: 0, followerSum: 0 },
      brand: { total: 0, pending: 0, recent7d: 0 },
      recent: (directoryRecent as any[]).map((r) => ({
        id: r.id,
        username: r.applicant_username || '',
        name: r.name || '',
        category: r.category || '',
        status: r.status || 'pending',
        followers: num(r.followers),
        createdAt: r.created_at,
      })),
    }
    for (const row of directoryRows as any[]) {
      const cnt = num(row.cnt)
      const status = String(row.status || 'pending')
      if (row.role === 'influencer') {
        const d = directory.influencer
        d.total += cnt
        d.recent7d += num(row.recent7d)
        d.withFollowers += num(row.with_followers)
        d.followerSum += num(row.follower_sum)
        if (status === 'pending') d.pending += cnt
        else if (status === 'reviewed') d.reviewed += cnt
        else if (status === 'contacted') d.contacted += cnt
        else if (status === 'archived') d.archived += cnt
      } else {
        directory.brand.total += cnt
        directory.brand.recent7d += num(row.recent7d)
        if (status === 'pending') directory.brand.pending += cnt
      }
    }
    const avgFollowers = directory.influencer.withFollowers > 0
      ? Math.round(directory.influencer.followerSum / directory.influencer.withFollowers)
      : 0

    // ── 캠페인 ────────────────────────────────────────────────────────────
    const campaigns = {
      total: 0,
      pendingApproval: 0,
      active: 0,
      rejected: 0,
      closed: 0,
      recent30d: 0,
      budgetTotal: 0,
      activeBudget: 0,
      pendingBudget: 0,
    }
    for (const row of campaignRows as any[]) {
      const cnt = num(row.cnt)
      const budget = num(row.budget_sum)
      const status = String(row.status || '')
      campaigns.total += cnt
      campaigns.budgetTotal += budget
      campaigns.recent30d += num(row.recent30d)
      if (status === 'pending_approval') {
        campaigns.pendingApproval += cnt
        campaigns.pendingBudget += budget
      } else if (status === 'active') {
        campaigns.active += cnt
        campaigns.activeBudget += budget
      } else if (status === 'admin_rejected') {
        campaigns.rejected += cnt
      } else {
        campaigns.closed += cnt
      }
    }

    // ── 리스트업 퍼널 + 캠페인 순수익 ────────────────────────────────────
    const funnel = { listed: 0, picked: 0, passed: 0, sent: 0, accepted: 0, declined: 0, expired: 0 }
    // confirmed = 인플루언서가 수락한 건(확정 수익), pipeline = 제안했으나 응답 대기(예상 수익).
    const blank = () => ({ count: 0, brandAmount: 0, influencerCost: 0, margin: 0, pricedCount: 0 })
    const profit = { confirmed: blank(), pipeline: blank(), listed: blank() }

    for (const row of listupRows as any[]) {
      const cnt = num(row.cnt)
      const bucket = {
        count: cnt,
        brandAmount: num(row.brand_amount),
        influencerCost: num(row.influencer_cost),
        margin: num(row.margin_amount),
        pricedCount: num(row.priced_both),
      }
      const add = (target: any) => {
        target.count += bucket.count
        target.brandAmount += bucket.brandAmount
        target.influencerCost += bucket.influencerCost
        target.margin += bucket.margin
        target.pricedCount += bucket.pricedCount
      }

      funnel.listed += cnt
      if (row.brand_decision === 'pick') funnel.picked += cnt
      if (row.brand_decision === 'pass') funnel.passed += cnt
      const outreach = String(row.outreach_status || 'not_sent')
      if (outreach === 'sent') funnel.sent += cnt
      if (outreach === 'accepted') funnel.accepted += cnt
      if (outreach === 'declined') funnel.declined += cnt
      if (outreach === 'expired') funnel.expired += cnt

      add(profit.listed)
      if (outreach === 'accepted') add(profit.confirmed)
      else if (outreach === 'sent') add(profit.pipeline)
    }
    // 견적이나 단가가 비어 마진을 셀 수 없는 행. 숫자가 부분집계임을 화면이 알려야 한다.
    const marginUnknown = {
      confirmed: profit.confirmed.count - profit.confirmed.pricedCount,
      pipeline: profit.pipeline.count - profit.pipeline.pricedCount,
    }

    const collabs = { total: 0, inProgress: 0, completed: 0, cancelled: 0 }
    for (const row of collabRows as any[]) {
      const cnt = num(row.cnt)
      collabs.total += cnt
      const status = String(row.status || '')
      if (status === 'in_progress') collabs.inProgress += cnt
      else if (status === 'completed') collabs.completed += cnt
      else if (status === 'cancelled') collabs.cancelled += cnt
    }

    const applications = { total: 0, pending: 0, accepted: 0, rejected: 0, fromApply: 0, fromListup: 0 }
    for (const row of applicationRows as any[]) {
      const cnt = num(row.cnt)
      applications.total += cnt
      const status = String(row.status || '')
      if (status === 'pending') applications.pending += cnt
      else if (status === 'accepted') applications.accepted += cnt
      else if (status === 'rejected') applications.rejected += cnt
      if (row.source === 'apply') applications.fromApply += cnt
      else applications.fromListup += cnt
    }

    return Response.json({
      accounts,
      directory: { ...directory, avgFollowers },
      campaigns,
      funnel,
      collabs,
      applications,
      campaignProfit: { ...profit, marginUnknown },
      ai,
      generatedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    return Response.json(
      { error: err?.message || '현황을 집계하지 못했습니다.' },
      { status: 500 },
    )
  }
}

export const config: Config = {
  path: '/api/admin/operator-overview',
  method: ['GET'],
}

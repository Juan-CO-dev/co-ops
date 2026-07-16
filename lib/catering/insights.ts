/**
 * Catering insights data layer — Wave 1 slice 1F (feedback + trends).
 *
 * SERVER-ONLY. A READ surface (no writes) over the capture artifacts the other slices
 * produce — pipeline leads, live quotes, booked orders, and customer feedback. Per the
 * read-surface-over-workflow principle, this adds no new workflow.
 *
 * The money rollups come from the catering_insights() RPC — SQL SUM server-side, never a
 * client reduce over loaded rows (the GLOBAL server-side-SUM rule / 1000-row truncation
 * bug class). Recent feedback is a bounded list query (not an aggregation).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";

export const INSIGHTS_READ_MIN = 5;

function locActor(actor: AuthContext): { role: AuthContext["user"]["role"]; locations: string[] } {
  return { role: actor.user.role, locations: actor.locations };
}

export interface PipelineStageCount {
  stage: string;
  count: number;
}
export interface QuoteStatusCount {
  status: string;
  count: number;
  totalCents: number;
}
export interface CateringRevenue {
  pipelineValueCents: number;
  wonValueCents: number;
  orderRevenueCents: number;
}
export interface FeedbackItem {
  id: string;
  rating: number | null;
  category: string | null;
  comment: string | null;
  submittedAt: string | null;
  followUpNeeded: boolean;
}
export interface CateringInsights {
  pipeline: PipelineStageCount[];
  quotes: QuoteStatusCount[];
  revenue: CateringRevenue;
  averageRating: number | null;
  feedbackCount: number;
  recentFeedback: FeedbackItem[];
}

interface RawInsights {
  pipeline?: Array<{ stage: string; count: number }>;
  quotes?: Array<{ status: string; count: number; total_cents: number }>;
  revenue?: { pipeline_value_cents?: number; won_value_cents?: number; order_revenue_cents?: number };
  feedback?: { average_rating?: number | null; count?: number };
}

export async function loadCateringInsights(actor: AuthContext): Promise<CateringInsights> {
  if (getRoleLevel(actor.user.role) < INSIGHTS_READ_MIN) {
    throw new Error("loadCateringInsights: insufficient role level");
  }
  const sb = getServiceRoleClient();
  const scope = isAllLocationsAccess(locActor(actor)) ? null : actor.locations;

  const { data, error } = await sb.rpc("catering_insights", { p_location_ids: scope });
  if (error) throw new Error(`loadCateringInsights rpc: ${error.message}`);
  const raw = (data ?? {}) as RawInsights;

  // Recent catering feedback (bounded list — not an aggregation).
  let fq = sb
    .from("customer_feedback")
    .select("id, rating, category, comment, submitted_at, follow_up_needed")
    .not("catering_order_id", "is", null);
  if (scope) fq = fq.in("location_id", scope);
  const { data: fbRows, error: fErr } = await fq
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(20)
    .returns<Array<{ id: string; rating: number | null; category: string | null; comment: string | null; submitted_at: string | null; follow_up_needed: boolean | null }>>();
  if (fErr) throw new Error(`loadCateringInsights feedback: ${fErr.message}`);

  return {
    pipeline: (raw.pipeline ?? []).map((p) => ({ stage: p.stage, count: p.count })),
    quotes: (raw.quotes ?? []).map((q) => ({ status: q.status, count: q.count, totalCents: q.total_cents })),
    revenue: {
      pipelineValueCents: raw.revenue?.pipeline_value_cents ?? 0,
      wonValueCents: raw.revenue?.won_value_cents ?? 0,
      orderRevenueCents: raw.revenue?.order_revenue_cents ?? 0,
    },
    averageRating: raw.feedback?.average_rating ?? null,
    feedbackCount: raw.feedback?.count ?? 0,
    recentFeedback: (fbRows ?? []).map((r) => ({
      id: r.id,
      rating: r.rating,
      category: r.category,
      comment: r.comment,
      submittedAt: r.submitted_at,
      followUpNeeded: r.follow_up_needed ?? false,
    })),
  };
}

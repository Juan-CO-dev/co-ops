/**
 * Catering insights data layer — v2 (catering-truth arc, 2026-09-05).
 *
 * SERVER-ONLY. A READ surface (no writes) over the capture artifacts the other slices
 * produce — pipeline leads, live quotes, and customer feedback.
 *
 * WHY v2 REPLACED v1. The 0121 `catering_insights` RPC counted every lead all-time (so a
 * purged test lead and a live ezCater order weighed the same), and it read revenue from
 * `catering_orders` (never written) plus accepted quotes (none exist) — it rendered $0
 * against ≈$2,800 of confirmed Toast/ezCater catering. 0194's `catering_insights_v2` cuts
 * FOUR windows (Juan 2026-09-05: this week · this month · last 30 · all time), counts MONEY
 * BY EVENT DATE and LEAD FLOW BY CREATED DATE, values a lead at its live accepted quote else
 * its `estimated_revenue_cents` (the platform actual), and returns the booked-event calendar.
 *
 * The money rollups stay SQL SUM server-side, never a client reduce over loaded rows (the
 * GLOBAL server-side-SUM rule / 1000-row truncation bug class). Recent feedback is a bounded
 * list query (not an aggregation) — the one thing the RPC does not carry.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import type { CalendarEvent, WindowKey, WindowStats } from "@/lib/catering/insights-shared";

export const INSIGHTS_READ_MIN = 5;

export interface FeedbackItem {
  id: string;
  rating: number | null;
  category: string | null;
  comment: string | null;
  submittedAt: string | null;
  followUpNeeded: boolean;
}

export interface CateringInsightsV2 {
  /** The ET calendar date the windows were cut on (the client renders the calendar around it). */
  today: string;
  windows: Record<WindowKey, WindowStats>;
  calendar: CalendarEvent[];
  averageRating: number | null;
  feedbackCount: number;
  recentFeedback: FeedbackItem[];
}

interface RawWindow {
  leads_new?: number;
  by_source?: Record<string, number>;
  by_stage?: Record<string, number>;
  booked_events?: number;
  /** bigint — PostgREST hands bigints back as strings; Number() at the boundary. */
  booked_value_cents?: number | string;
  /** Money split (0195) — REQUIRED at runtime; see the guard in `win()`. */
  confirmed_events?: number;
  confirmed_value_cents?: number | string;
  completed_events?: number;
  completed_value_cents?: number | string;
  lost?: number;
  win_rate_bps?: number | null;
  avg_headcount?: number | null;
  pipeline_open_value_cents?: number | string;
}

interface RawV2 {
  this_week?: RawWindow;
  this_month?: RawWindow;
  last_30?: RawWindow;
  all_time?: RawWindow;
  calendar?: Array<{
    id: string;
    event_date: string;
    time_window: string | null;
    name: string;
    headcount: number | null;
    source: string | null;
    stage: CalendarEvent["stage"];
    location_id: string;
    value_cents: number | string;
  }>;
  feedback?: { average_rating?: number | null; count?: number };
}

/**
 * One window's stats. `r` is REQUIRED — a missing window is a broken RPC contract, not a
 * quiet zero (see the throw in the loader). The per-FIELD `?? 0` below is different in kind
 * and stays: an absent aggregate inside a window the RPC did return is a real empty set,
 * because `count(*)`/`coalesce(sum(…), 0)` cannot come back missing for a window it built.
 * The four 0195 money-split keys are the exception — they CAN be missing (a pre-0195 function),
 * so they are checked and thrown on. See the guard.
 */
function win(key: WindowKey, r: RawWindow): WindowStats {
  // THE FOUR MONEY-SPLIT KEYS (0195) ARE THE ONE EXCEPTION TO THE `?? 0` ABOVE. They are absent
  // exactly when the deployed function is still 0194's — a real, reachable state (this loader
  // ships in the same PR as the migration, and prod runs the old function until it is applied).
  // Defaulting them would render a confident "Confirmed $0 · Completed $0" over real booked
  // money: the same fabrication v2 exists to end. Absence is an RPC contract error, not a zero.
  if (
    r.confirmed_events === undefined || r.confirmed_value_cents === undefined ||
    r.completed_events === undefined || r.completed_value_cents === undefined
  ) {
    throw new Error(`loadCateringInsightsV2: window "${key}" is missing the money-split keys (migration 0195 not applied?)`);
  }
  return {
    leadsNew: r.leads_new ?? 0,
    bySource: r.by_source ?? {},
    byStage: r.by_stage ?? {},
    bookedEvents: r.booked_events ?? 0,
    bookedValueCents: Number(r.booked_value_cents ?? 0),
    confirmedEvents: r.confirmed_events,
    confirmedValueCents: Number(r.confirmed_value_cents),
    completedEvents: r.completed_events,
    completedValueCents: Number(r.completed_value_cents),
    lost: r.lost ?? 0,
    winRateBps: r.win_rate_bps ?? null,
    avgHeadcount: r.avg_headcount ?? null,
    pipelineOpenValueCents: Number(r.pipeline_open_value_cents ?? 0),
  };
}

/** `todayEt` = the ET calendar date (caller passes `etCalendarDate(new Date().toISOString())`). */
export async function loadCateringInsightsV2(actor: AuthContext, todayEt: string): Promise<CateringInsightsV2> {
  if (getRoleLevel(actor.user.role) < INSIGHTS_READ_MIN) {
    throw new Error("loadCateringInsightsV2: insufficient role level");
  }
  const sb = getServiceRoleClient();
  const scope = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations }) ? null : actor.locations;

  const { data, error } = await sb.rpc("catering_insights_v2", { p_location_ids: scope, p_today: todayEt });
  if (error) throw new Error(`loadCateringInsightsV2 rpc: ${error.message}`);
  const raw = (data ?? {}) as RawV2;
  // A MISSING WINDOW IS A FAILURE, NOT A ZERO. Defaulting to zeros here renders a confident
  // "$0 booked · 0 leads" — indistinguishable from a genuinely quiet week, and exactly the
  // fabrication v2 exists to end (v1's $0 against ≈$2,800 of real catering).
  if (!raw.this_week || !raw.this_month || !raw.last_30 || !raw.all_time) {
    throw new Error("loadCateringInsightsV2: RPC returned no windows");
  }

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
  if (fErr) throw new Error(`loadCateringInsightsV2 feedback: ${fErr.message}`);

  return {
    today: todayEt,
    windows: {
      this_week: win("this_week", raw.this_week),
      this_month: win("this_month", raw.this_month),
      last_30: win("last_30", raw.last_30),
      all_time: win("all_time", raw.all_time),
    },
    calendar: (raw.calendar ?? []).map((e) => ({
      id: e.id,
      eventDate: e.event_date,
      timeWindow: e.time_window,
      name: e.name,
      headcount: e.headcount,
      source: e.source,
      stage: e.stage,
      locationId: e.location_id,
      valueCents: Number(e.value_cents ?? 0),
    })),
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

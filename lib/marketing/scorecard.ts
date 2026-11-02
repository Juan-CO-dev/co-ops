import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { mapBounded } from "@/lib/sales-reports";
import type { CateringValuesRaw } from "@/lib/sales-reports-shared";
import { landingTenantConfig } from "@/config/tenant/landing";
import { landingRateLimit } from "@/lib/landing/rate-limit";
import { loadConsentOverview } from "@/lib/customers/customers";
import { canReadMarketing } from "./access-shared";
import { marketingReadiness } from "./readiness-shared";
import { baselineDrift, computeScorecard, computeOrderTaps, costPerTap, costPerExtraDirectOnlineOrder,
  manualMetric, scorecardWindows, type ScorecardInput, type SalesChannel, type DateWindow, type ScorecardWeek, type TapDay } from "./scorecard-shared";

type Viewer = Pick<AuthContext, "role" | "level" | "locations">;
type Client = Pick<SupabaseClient, "from" | "rpc">;
export interface Milestone { id: string; kind: string; milestone_date: string; corrects_id: string | null }
export interface ManualEntry { id: string; kind: string; location_id: string | null; platform: string | null; period_start: string; period_end: string; amount_cents: number | null; list_count: number | null; note: string | null; corrects_id: string | null }
export type Score = ReturnType<typeof computeScorecard>;
export interface BaselineSnapshot { id: string; milestone_id: string; window_from: string; window_to: string; payload: Score & { byLocation?: Record<string, Score> }; coverage: Score["coverage"]; corrects_id: string | null }
export interface MarketingLocation { id: string; name: string; code: string }
export interface MarketingDeps { client?: Client; now?: Date; env?: NodeJS.ProcessEnv }
export interface MarketingSeries { window: ScorecardWeek; score: Score; taps: ReturnType<typeof computeOrderTaps>; metaSpend: ReturnType<typeof manualMetric>; costPerTap: ReturnType<typeof costPerTap>; costPerExtraOrder: ReturnType<typeof costPerExtraDirectOnlineOrder> }
export type MarketingScorecard = { state: "unavailable"; reason: "not_switched_on" | "counter_not_installed" | "no_capture" } | {
  state: "ok"; windows: ReturnType<typeof scorecardWindows>; locations: MarketingLocation[]; selectedLocationId: string | null;
  series: MarketingSeries[]; baseline: Score | null; baselineSeries: { window: DateWindow; score: Score }[];
  milestones: Milestone[]; entries: ManualEntry[]; snapshots: BaselineSnapshot[]; taps: ReturnType<typeof computeOrderTaps>;
  baselineDrift: boolean; readiness: ReturnType<typeof marketingReadiness>; consentEnabled?: boolean; consent: { optedIn: number; lastImportDate: string | null } | null;
};
export function marketingHeads<T extends { id: string; corrects_id: string | null }>(rows: T[]): T[] {
  const corrected = new Set(rows.flatMap(row => row.corrects_id ? [row.corrects_id] : []));
  return rows.filter(row => !corrected.has(row.id));
}
export function marketingBaselineDrift(live: Score, locked: Score): boolean {
  const money = (s: Score) => [s.classifiedCents, s.toastDeliveryServices.cents, s.directCatering.cents, s.pipeline.cents, s.ezcater.cents, s.ezcater.averageTicket];
  const shares = (s: Score) => [s.onlineDirectShare, s.onlineDirectOrderShare, s.totalDirectShare, s.dineInPoints];
  const changed = (left: ReturnType<typeof money>, right: ReturnType<typeof money>, share: boolean) => left.some((metric, index) => {
    const other = right[index];
    return metric.value !== null && other?.value != null && (share ? baselineDrift(0, 0, metric.value, other.value) : baselineDrift(metric.value, other.value, 0, 0));
  });
  if (changed(money(live), money(locked), false) || changed(shares(live), shares(locked), true)) return true;
  const providers = new Set([...live.marketplace, ...locked.marketplace].map(row => row.provider));
  return [...providers].some(provider => {
    const a = live.marketplace.find(row => row.provider === provider);
    const b = locked.marketplace.find(row => row.provider === provider);
    return baselineDrift(a?.cents.value ?? 0, b?.cents.value ?? 0, a?.share.value ?? 0, b?.share.value ?? 0);
  });
}
function check(error: { code?: string } | null) { if (error) throw error; }
async function readRows<T>(sb: Client, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await sb.from(table).select(columns).order("id").range(offset, offset + 499);
    check(result.error);
    rows.push(...(result.data ?? []) as T[]);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}
interface RawDays {
  channels: { business_date: string; channel: SalesChannel; provider: string | null; checks: number; orders: number; cents: number; amount_missing: number }[];
  direct_online_orders: { business_date: string; orders: number }[];
  large_checks: { business_date: string; channel: SalesChannel; amount_cents: number }[];
  unknown_labels: { business_date: string; label: string; checks: number; cents: number; amount_missing: number }[];
  ezcater: { business_date: string; status: string; orders: number; subtotal_cents: number; amount_missing: number; large_orders: number }[];
  captured_days: string[];
}
/** Both calls per task run sequentially, so the global fan-out stays at two. */
async function readWindow(sb: Client, locations: MarketingLocation[], window: DateWindow): Promise<Score> {
  const parts = await mapBounded(locations, 2, async location => {
    const args = { p_location_id: location.id, p_from: window.from, p_to: window.to };
    const result = await sb.rpc("marketing_scorecard_days", args); check(result.error);
    const raw = result.data as RawDays;
    const pipeline = await sb.rpc("sales_report_catering_values", args);
    const p = pipeline.data as CateringValuesRaw | null;
    const locationId = location.id;
    return {
      channels: raw.channels.map(r => ({ locationId, day: r.business_date, channel: r.channel, provider: r.provider, checks: Number(r.checks), orders: Number(r.orders), cents: Number(r.cents), amountMissing: Number(r.amount_missing) > 0 })),
      capturedDays: raw.captured_days.map(day => ({ locationId, day })),
      directOnlineOrders: raw.direct_online_orders.map(r => ({ locationId, day: r.business_date, orders: Number(r.orders) })),
      largeChecks: raw.large_checks.map(r => ({ locationId, day: r.business_date, channel: r.channel, amountCents: Number(r.amount_cents) })),
      unknownLabels: raw.unknown_labels.map(r => ({ locationId, day: r.business_date, label: r.label, checks: Number(r.checks), cents: Number(r.cents), amountMissing: Number(r.amount_missing) > 0 })),
      ezcater: raw.ezcater.map(r => ({ locationId, day: r.business_date, orders: Number(r.orders), cents: Number(r.subtotal_cents), amountMissing: Number(r.amount_missing) > 0, largeOrders: Number(r.large_orders), reconciliation: { [r.status]: Number(r.orders) } })),
      pipeline: pipeline.error || !p ? null : [{ locationId, day: window.from, completedEvents: Number(p.completed_events), cents: Number(p.completed_unvalued) > 0 ? null : Number(p.completed_value_cents) }],
    };
  });
  const input: ScorecardInput = { window, locationIds: locations.map(r => r.id),
    channels: parts.flatMap(p => p.channels), capturedDays: parts.flatMap(p => p.capturedDays), directOnlineOrders: parts.flatMap(p => p.directOnlineOrders),
    largeChecks: parts.flatMap(p => p.largeChecks), unknownLabels: parts.flatMap(p => p.unknownLabels), ezcater: parts.flatMap(p => p.ezcater),
    pipeline: parts.some(p => p.pipeline === null) ? null : parts.flatMap(p => p.pipeline ?? []) };
  return computeScorecard(input);
}

export async function loadMarketingScorecard(viewer: Viewer, locationId: string | null = null, deps: MarketingDeps = {}): Promise<MarketingScorecard> {
  if (!canReadMarketing(viewer.role)) throw new Error("role_not_allowed");
  const env = deps.env ?? process.env;
  if (env.MARKETING_SCORECARD !== "1") return { state: "unavailable", reason: "not_switched_on" };
  try {
    const sb = deps.client ?? getServiceRoleClient();
    const milestones = marketingHeads(await readRows<Milestone>(sb, "marketing_milestones", "id,kind,milestone_date,corrects_id"));
    const entries = marketingHeads(await readRows<ManualEntry>(sb, "marketing_manual_entries", "id,kind,location_id,platform,period_start,period_end,amount_cents,list_count,note,corrects_id"));
    const snapshots = marketingHeads(await readRows<BaselineSnapshot>(sb, "marketing_baseline_snapshots", "id,milestone_id,window_from,window_to,payload,coverage,corrects_id"));
    const locations = await readRows<MarketingLocation>(sb, "locations", "id,name,code");
    if (locationId !== null && !locations.some(r => r.id === locationId)) throw new Error("invalid_location");
    const selected = locations.filter(r => locationId === null || locationId === r.id);
    const first = milestones.find(r => r.kind === "first_ad_spend");
    const windows = scorecardWindows(first?.milestone_date ?? null, (deps.now ?? new Date()).toISOString());
    // Sequential windows, two shops at a time: never multiply nested concurrency.
    const liveBaseline = windows.baseline ? await readWindow(sb, selected, windows.baseline) : null;
    const snapshot = snapshots.find(r => r.milestone_id === first?.id);
    const lockedBaseline = locationId === null ? snapshot?.payload : snapshot?.payload.byLocation?.[locationId];
    const baseline = lockedBaseline ?? liveBaseline;
    const baselineSeries = [];
    for (const window of windows.baselineWeeks) baselineSeries.push({ window, score: await readWindow(sb, selected, window) });
    const storeKeys = landingTenantConfig.stores.filter(store => selected.some(shop => shop.code === store.locationCode)).map(store => store.key);
    const counterOn = milestones.find(r => r.kind === "counter_on")?.milestone_date ?? null;
    const series: MarketingSeries[] = [];
    for (const window of windows.weeks) {
      const measuredWindow = window.complete ? window : { from: window.from, to: windows.today };
      const score = await readWindow(sb, selected, measuredWindow);
      const result = await sb.rpc("marketing_order_taps", { p_from: measuredWindow.from, p_to: measuredWindow.to });
      const installed = !result.error;
      const rows: TapDay[] = (result.data ?? []).map((r: { day: string; store_key: string; ad_code: string; active: boolean; click_count: number }) => ({ day: r.day, storeKey: r.store_key, adCode: r.ad_code, active: r.active, clickCount: Number(r.click_count) }));
      const taps = computeOrderTaps({ window: measuredWindow, installed, counterOn, rows, storeKeys });
      // Meta spend has no shop allocation. Never divide all-shop spend by one shop's taps.
      const meta = locationId === null ? entries.find(r => r.kind === "meta_spend" && r.location_id === null && r.period_start === window.from && r.period_end === window.to) : undefined;
      const metaSpend = manualMetric(meta?.amount_cents === undefined || meta.amount_cents === null ? null : Number(meta.amount_cents));
      series.push({ window, score, taps, metaSpend, costPerTap: costPerTap(metaSpend, taps.coded), costPerExtraOrder: costPerExtraDirectOnlineOrder(metaSpend, score.directOnlineOrdersPerDay, baseline?.directOnlineOrdersPerDay ?? null, window.complete && window.compare) });
    }
    const drift = liveBaseline !== null && lockedBaseline !== undefined && marketingBaselineDrift(liveBaseline, lockedBaseline);
    const readiness = marketingReadiness({ rulesRecorded: Boolean(env.LANDING_WAF_RULE_IDS), burstPhasesPassed: false,
      evidenceReviewedByCc: false, evidenceApprovedByJuan: false, rateLimitAllowed: landingRateLimit(env) === "allowed",
      pixelIdsMatch: Boolean(env.META_PIXEL_ID) && env.META_PIXEL_ID === env.NEXT_PUBLIC_META_PIXEL_ID,
      tokenPresent: Boolean(env.META_CAPI_ACCESS_TOKEN), graphVersionCorrect: env.META_GRAPH_API_VERSION === "v25.0",
      noTestCodeInProduction: env.VERCEL_ENV !== "production" || !env.META_TEST_EVENT_CODE,
      uaApproved: env.LANDING_META_UA_APPROVED === "true", previewDedupAllThree: false, productionBrowserAndServer: false,
      consentSuppressionProven: false, staffIsolationProven: false, rollbackTested: false });
    let consent: { optedIn: number; lastImportDate: string | null } | null = null;
    if (env.CUSTOMER_PROFILES === "1") {
      try {
        if (viewer.level >= 9) {
          const overview = await loadConsentOverview({ ...viewer, userId: "" }, { client: sb });
          consent = { optedIn: overview.optedIn, lastImportDate: overview.imports[0]?.exportDate ?? null };
        } else {
          // MoO may see these aggregate marketing numbers, never the contact-level
          // rows returned by loadConsentOverview (whose level-9 gate stays intact).
          const count = await sb.from("customer_consent_current").select("customer_id", { count: "exact", head: true }).eq("channel", "email").eq("status", "opted_in");
          check(count.error);
          const imports = await sb.from("customer_consent_imports").select("export_date").order("created_at", { ascending: false }).limit(1);
          check(imports.error);
          consent = { optedIn: count.count ?? 0, lastImportDate: imports.data?.[0]?.export_date ?? null };
        }
      } catch { /* Independent source stays unavailable. */ }
    }
    return { state: "ok", windows, locations, selectedLocationId: locationId, series, baseline, baselineSeries,
      milestones, entries, snapshots, taps: series[series.length - 1]!.taps, baselineDrift: drift, readiness, consentEnabled: env.CUSTOMER_PROFILES === "1", consent };
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_location") throw error;
    const code = (error as { code?: string })?.code;
    return { state: "unavailable", reason: ["42P01", "42883", "PGRST202"].includes(code ?? "") ? "counter_not_installed" : "no_capture" };
  }
}

/** Snapshot payload is always recomputed on the server, never accepted from the form. */
export async function buildMarketingBaseline(viewer: Viewer) {
  const data = await loadMarketingScorecard(viewer);
  if (data.state !== "ok" || !data.baseline || !data.windows.baseline) return null;
  const milestone = data.milestones.find(r => r.kind === "first_ad_spend");
  if (!milestone) return null;
  try {
  const sb = getServiceRoleClient();
  // Recompute even during a correction; the displayed baseline may be locked.
  const live = await readWindow(sb, data.locations, data.windows.baseline);
  const byLocation: Record<string, Score> = {};
  for (const location of data.locations) byLocation[location.id] = await readWindow(sb, [location], data.windows.baseline);
  return { milestoneId: milestone.id, from: data.windows.baseline.from, to: data.windows.baseline.to,
    kpiVersion: 1, payload: { ...live, byLocation }, coverage: live.coverage };
  } catch { return null; }
}

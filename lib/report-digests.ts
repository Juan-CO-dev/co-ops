/**
 * Report digests — the server I/O (service-role reads, Resend, audit, ops alerts). Builds the
 * DigestIO the engine runs on (lib/report-digests-engine.ts) and exposes the two entry points:
 *   runDigestTick()                       — /api/cron/digest-tick (the desktop pinger, 03-22 ET)
 *   runClosingDigests(locationId, day)    — after() in /api/checklist/confirm for a closing
 * Pure rules live in lib/report-digests-shared.ts and lib/report-digests-compose.ts.
 *
 * SENDER (risk R1): digests go out FROM teamFrom() (EMAIL_FROM_TEAM, else EMAIL_FROM). While
 * EMAIL_FROM is still onboarding@resend.dev, Resend 422s every recipient except the account owner;
 * that is a 'failed' row + an immediate ops alert, never a silent loss. The switch ships OFF.
 */
import "server-only";
import { createHash } from "node:crypto";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { sendEmail, teamFrom } from "@/lib/email";
import { appUrl } from "@/lib/email-templates/_layout";
import { DEFAULT_OPS_ALERT_EMAIL } from "@/lib/jobs-registry";
import { easternBoundary, easternDay } from "@/lib/job-watch";
import { listReports } from "@/lib/reports-hub";
import { loadShopV2Facts } from "@/lib/report-digests-v2";
import { selectAllRows } from "@/lib/supabase-paginate";
import { etCalendarDate } from "@/lib/operational-day";
import { readNotInToast } from "@/lib/catering/not-in-toast";
import { resolveRefs } from "@/lib/catering/prep-demand";
import { serverT } from "@/lib/i18n/server";
import { isTaskType, type TaskType } from "@/lib/assignments-shared";
import {
  addDays,
  etDayRange,
  parseDigestSettings,
  type DigestDirectory,
  type DigestSettings,
  type RecipientOverride,
  type SendLogRow,
} from "@/lib/report-digests-shared";
import type { CateringFacts, CateringLeadFact, PrepLoadLine, ShopDayFacts } from "@/lib/report-digests-compose";
import type { Loaded } from "@/lib/report-digests-v2-shared";
import {
  countAnchoredBalances,
  paymentState,
  readinessFrom,
  specialInstructions,
  stationRoster,
  type CateringReadiness,
  type StaffRoster,
  type StaffSource,
  type ToastCrossCheckOrder,
  type ToastCrossCheckOrphan,
} from "@/lib/report-digests-catering-shared";
import type { StationEvent } from "@/lib/assignments-shared";
import { deriveCateringSkuDemand } from "@/lib/catering/sku-demand";
import { deriveOnHand } from "@/lib/counts";
import {
  runClosingDigestsWith,
  runDigestTickWith,
  type DigestAlert,
  type DigestIO,
  type DigestRunSummary,
  type SendStore,
} from "@/lib/report-digests-engine";
import { packageIO } from "@/lib/report-package";

type Sb = ReturnType<typeof getServiceRoleClient>;

const auditBase = { actorId: null, actorRole: null, resourceId: null, ipAddress: null, userAgent: null } as const;

/** The system viewer for report reads: level 8 sees every shop and the cash numbers (KH+). */
const SYSTEM_VIEWER = { userId: "00000000-0000-0000-0000-000000000000", level: 8 };
const FINALIZED_CLOSING = ["confirmed", "incomplete_confirmed", "auto_finalized"];

/**
 * Preview mode delivers ONLY to the operator's own account: the single active CGS (level 10) user
 * with an email, read from the users table. Anything else — none, several, no email — is null and
 * preview FAILS CLOSED. Deliberately no env-var fallback (Astra P2: OPS_ALERT_EMAIL is an alert
 * destination, not an identity, and a distribution list there would receive every shop's digest).
 */
export async function loadPreviewRecipient(sb: Sb): Promise<string | null> {
  const { data, error } = await sb.from("users").select("id, email").eq("role", "cgs").eq("active", true);
  if (error) throw new Error(`preview recipient: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; email: string | null }>;
  if (rows.length !== 1) return null;
  const email = rows[0]!.email?.trim().toLowerCase();
  return email ? email : null;
}

export async function loadDigestSettings(sb: Sb): Promise<DigestSettings> {
  const { data, error } = await sb.from("report_settings").select("key, value");
  if (error) throw new Error(`report_settings: ${error.message}`);
  return parseDigestSettings((data ?? []) as Array<{ key: string; value: unknown }>);
}

interface RecipientRow {
  id: string; kind: "internal" | "external"; user_id: string | null; email: string | null; display_name: string;
  active: boolean; catering_digest: boolean; shop_digest: boolean; location_ids: string[] | null;
}

export function mapOverride(r: RecipientRow): RecipientOverride {
  return {
    id: r.id, kind: r.kind, userId: r.user_id, email: r.email, displayName: r.display_name, active: r.active,
    cateringDigest: r.catering_digest, shopDigest: r.shop_digest, locationIds: r.location_ids,
  };
}

export async function loadDigestDirectory(sb: Sb): Promise<{ dir: DigestDirectory; locations: Array<{ id: string; name: string }> }> {
  const [users, memberships, overrides, locations] = await Promise.all([
    selectAllRows<{ id: string; name: string; email: string | null; role: string; language: string | null; active: boolean }>((from, to) =>
      sb.from("users").select("id, name, email, role, language, active").order("id").range(from, to)),
    selectAllRows<{ user_id: string; location_id: string }>((from, to) =>
      sb.from("user_locations").select("user_id, location_id").eq("active", true).order("user_id").order("location_id").range(from, to)),
    selectAllRows<RecipientRow>((from, to) =>
      sb.from("report_recipients").select("id, kind, user_id, email, display_name, active, catering_digest, shop_digest, location_ids").order("id").range(from, to)),
    selectAllRows<{ id: string; name: string }>((from, to) =>
      sb.from("locations").select("id, name").eq("active", true).order("name").order("id").range(from, to)),
  ]);
  return {
    dir: {
      users,
      memberships: memberships.map((m) => ({ userId: m.user_id, locationId: m.location_id })),
      overrides: overrides.map(mapOverride),
      locationIds: locations.map((l) => l.id),
    },
    locations,
  };
}

async function loadSendLog(sb: Sb, days: string[]): Promise<SendLogRow[]> {
  return selectAllRows<SendLogRow>((from, to) =>
    sb.from("report_digest_sends")
      .select("id, recipient_ref, kind, business_day, location_id, revision, mode, outcome, skip_reason, attempted_at, first_attempt_at, provider_message_id")
      .in("business_day", days).order("id").range(from, to));
}

async function loadFinalizedClosings(sb: Sb, days: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(days.map((d) => [d, new Set<string>()]));
  const { data: templates, error: tErr } = await sb.from("checklist_templates").select("id").eq("type", "closing");
  if (tErr) throw new Error(`closing templates: ${tErr.message}`);
  const ids = (templates ?? []).map((t: { id: string }) => t.id);
  if (ids.length === 0) return out;
  const rows = await selectAllRows<{ location_id: string; date: string }>((from, to) =>
    sb.from("checklist_instances").select("location_id, date").in("template_id", ids).in("date", days)
      .in("status", FINALIZED_CLOSING).order("id").range(from, to));
  for (const r of rows) out.get(r.date)?.add(r.location_id);
  return out;
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return n ?? 0;
}

export async function loadShopDayFacts(sb: Sb, location: { id: string; name: string }, day: string, now: Date = new Date()): Promise<ShopDayFacts> {
  const [reports, deliveries, tosses, storeRunsPending, tasks, v2] = await Promise.all([
    listReports(sb, { viewer: SYSTEM_VIEWER, locationId: location.id, dateFrom: day, dateTo: day }),
    selectAllRows<{ match_state: string; receipt_url: string | null }>((from, to) =>
      sb.from("vendor_deliveries").select("match_state, receipt_url").eq("location_id", location.id).eq("delivery_date", day).order("id").range(from, to)),
    count(sb.from("prep_batch_sessions").select("instance_id", { count: "exact", head: true })
      .eq("location_id", location.id).eq("business_date", day).gt("tossed_qty", 0), "tosses"),
    count(sb.from("vendor_items").select("id", { count: "exact", head: true })
      .eq("location_id", location.id).eq("pending_review", true).eq("active", true), "store runs"),
    selectAllRows<{ report_type: string }>((from, to) =>
      sb.from("report_assignments").select("report_type").eq("location_id", location.id).eq("operational_date", day).eq("active", true).order("id").range(from, to)),
    // Digest v2 (GO 2026-10-08): fail-soft per area, never throws, never writes.
    loadShopV2Facts(sb, location.id, day, now),
  ]);
  // PM findings (Astra P2): the list loader carries no PM signals, so read the live evaluations of
  // the day's PM report(s) here. A failed read is "not assessed", never "All good".
  let pmFindings: ShopDayFacts["pmFindings"] = null;
  const pmIds = reports.filter((r) => r.type === "pm").map((r) => r.id);
  if (pmIds.length > 0) {
    try {
      const evals = await selectAllRows<{ arrived_ready: string; attitude: string; production: string; team_player: string }>((from, to) =>
        sb.from("pm_employee_evals").select("arrived_ready, attitude, production, team_player")
          .in("pm_report_id", pmIds).is("superseded_at", null).order("id").range(from, to));
      pmFindings = {
        evaluations: evals.length,
        needsWork: evals.reduce((n, e) => n + [e.arrived_ready, e.attitude, e.production, e.team_player].filter((g) => g === "needs_work").length, 0),
      };
    } catch {
      pmFindings = null;
    }
  }
  return {
    location, day, reports, pmFindings, v2,
    receiving: {
      deliveries: deliveries.length,
      discrepant: deliveries.filter((d) => d.match_state === "discrepant").length,
      missingReceipt: deliveries.filter((d) => !d.receipt_url).length,
    },
    tosses, storeRunsPending,
    tasks: [...new Set(tasks.map((t) => t.report_type).filter((x): x is TaskType => isTaskType(x)))],
  };
}

interface LeadRow {
  id: string; contact_name: string; company: string | null; event_date: string | null; time_window: string | null;
  headcount: number | null; stage: string; lead_source: string | null; location_id: string | null; created_at: string;
  follow_up_date: string | null; external_ref: string | null; delivery_address: string | null; estimated_revenue_cents: number | null;
  notes: string | null;
}
// notes is read ONLY to lift the machine special-instruction lines (specialInstructions); the free
// text itself never reaches an email.
const LEAD_SELECT = "id, contact_name, company, event_date, time_window, headcount, stage, lead_source, location_id, created_at, follow_up_date, external_ref, delivery_address, estimated_revenue_cents, notes";

export async function loadCateringFacts(sb: Sb, today: string, now: Date): Promise<CateringFacts> {
  const activeShops = await selectAllRows<{ id: string }>((from, to) =>
    sb.from("locations").select("id").eq("active", true).order("id").range(from, to));
  const toRingInToast = await readNotInToast(sb, activeShops.map((shop) => shop.id), { from: today, through: today });
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  // Two independent Eastern midnights (Astra P2): 23 h / 25 h on the DST transition days.
  const y = etDayRange(yesterday);
  const leads = new Map<string, LeadRow>();
  const add = (rows: LeadRow[]) => { for (const r of rows) leads.set(r.id, r); };
  const leadsQuery = () => sb.from("catering_pipeline").select(LEAD_SELECT);

  const [events, lostEvents] = await Promise.all([
    Promise.all([
      selectAllRows<LeadRow>((from, to) => leadsQuery().gte("event_date", yesterday).lte("event_date", tomorrow).order("id").range(from, to)),
      selectAllRows<LeadRow>((from, to) => leadsQuery().gte("created_at", y.startIso).lt("created_at", y.endExclusiveIso).order("id").range(from, to)),
      selectAllRows<LeadRow>((from, to) => leadsQuery().in("stage", ["inquiry", "quote_sent"]).lt("follow_up_date", today).order("id").range(from, to)),
    ]),
    selectAllRows<{ pipeline_id: string }>((from, to) =>
      sb.from("catering_pipeline_events").select("pipeline_id").eq("to_stage", "lost")
        .gte("created_at", y.startIso).lt("created_at", y.endExclusiveIso).order("id").range(from, to)),
  ]);
  for (const rows of events) add(rows);
  const lostIds = [...new Set(lostEvents.map((e) => e.pipeline_id))];
  const missingLost = lostIds.filter((id) => !leads.has(id));
  if (missingLost.length > 0) add(await selectAllRows<LeadRow>((from, to) => leadsQuery().in("id", missingLost).order("id").range(from, to)));

  const leadIds = [...leads.keys()];
  const accepted = new Map<string, { id: string; total_cents: number; is_delivery: boolean; version: number }>();
  const due = new Map<string, number>();
  const paymentsByLead = new Map<string, Array<{ status: string; amountCents: number }>>();
  const prep = new Map<string, PrepLoadLine[]>();
  if (leadIds.length > 0) {
    const quotes = await selectAllRows<{ id: string; pipeline_id: string; total_cents: number; is_delivery: boolean; version: number }>((from, to) =>
      sb.from("catering_quotes").select("id, pipeline_id, total_cents, is_delivery, version").in("pipeline_id", leadIds)
        .eq("status", "accepted").is("superseded_at", null).order("id").range(from, to));
    for (const q of quotes) {
      const prev = accepted.get(q.pipeline_id);
      if (!prev || q.version > prev.version) accepted.set(q.pipeline_id, q);
    }
    const quoteIds = [...accepted.values()].map((q) => q.id);
    const pipelineByQuote = new Map([...accepted].map(([pid, q]) => [q.id, pid]));
    const [payments, demand] = await Promise.all([
      quoteIds.length === 0 ? Promise.resolve([]) : selectAllRows<{ quote_id: string; amount_cents: number; status: string }>((from, to) =>
        sb.from("catering_payments").select("quote_id, amount_cents, status").in("quote_id", quoteIds).in("status", ["due", "paid"]).order("id").range(from, to)),
      selectAllRows<DemandRow>((from, to) =>
        sb.from("catering_prep_demand").select("pipeline_id, need_date, item_id, menu_item_id, choice_package_item_id, portion, qty")
          .in("pipeline_id", leadIds).in("status", ["reserved", "consumed"]).order("id").range(from, to)),
    ]);
    for (const p of payments) {
      const pid = pipelineByQuote.get(p.quote_id);
      if (!pid) continue;
      if (p.status === "due") due.set(pid, (due.get(pid) ?? 0) + p.amount_cents);
      paymentsByLead.set(pid, [...(paymentsByLead.get(pid) ?? []), { status: p.status, amountCents: p.amount_cents }]);
    }
    for (const [pid, lines] of await summarizePrepDemand(sb, demand)) prep.set(pid, lines);
  }

  const [sentYesterday, openQuotes, refunds] = await Promise.all([
    selectAllRows<{ id: string; location_id: string; total_cents: number }>((from, to) =>
      sb.from("catering_quotes").select("id, location_id, total_cents").gte("sent_at", y.startIso).lt("sent_at", y.endExclusiveIso).order("id").range(from, to)),
    selectAllRows<{ id: string; location_id: string; expires_at: string | null }>((from, to) =>
      sb.from("catering_quotes").select("id, location_id, expires_at").eq("status", "sent").is("superseded_at", null).order("id").range(from, to)),
    selectAllRows<{ quote_id: string; amount_cents: number }>((from, to) =>
      sb.from("catering_payments").select("quote_id, amount_cents").eq("status", "refunded")
        .gte("paid_at", y.startIso).lt("paid_at", y.endExclusiveIso).order("id").range(from, to)),
  ]);
  const refundQuoteIds = [...new Set(refunds.map((r) => r.quote_id))];
  const refundLoc = new Map<string, string>();
  if (refundQuoteIds.length > 0) {
    const { data, error } = await sb.from("catering_quotes").select("id, location_id").in("id", refundQuoteIds);
    if (error) throw new Error(`refund quotes: ${error.message}`);
    for (const q of (data ?? []) as Array<{ id: string; location_id: string }>) refundLoc.set(q.id, q.location_id);
  }

  const facts: CateringLeadFact[] = [...leads.values()].map((l) => {
    const q = accepted.get(l.id);
    return {
      id: l.id, contactName: l.contact_name, company: l.company, eventDate: l.event_date, timeWindow: l.time_window,
      headcount: l.headcount, stage: l.stage, leadSource: l.lead_source, locationId: l.location_id,
      createdDay: etCalendarDate(l.created_at), followUpDate: l.follow_up_date, externalRef: l.external_ref,
      isDelivery: !!l.delivery_address?.trim() || !!q?.is_delivery,
      valueCents: q?.total_cents ?? l.estimated_revenue_cents ?? 0,
      dueCents: due.get(l.id) ?? 0,
      prep: prep.get(l.id) ?? null,
      instructions: specialInstructions(l.notes),
      payment: paymentState(l.lead_source, paymentsByLead.get(l.id) ?? []),
      deliveryAddress: l.delivery_address,
    };
  });
  // The shops with orders booked today get inventory readiness + staff (GO addendum 10-08).
  const todayShops = [...new Set(facts.filter((l) => l.eventDate === today && (l.stage === "confirmed" || l.stage === "out") && l.locationId).map((l) => l.locationId!))];
  const readiness: NonNullable<CateringFacts["readiness"]> = {};
  const staff: NonNullable<CateringFacts["staff"]> = {};
  await Promise.all(todayShops.map(async (loc) => {
    [readiness[loc], staff[loc]] = await Promise.all([loadCateringReadiness(loc, today), loadStaffRoster(sb, loc, today)]);
  }));
  const [reconciliation, orphans] = await Promise.all([
    selectAllRows<ToastCrossCheckOrder>((from, to) => sb.from("ezcater_reconciliation_status")
      .select("order_id,location_id,event_date,order_number,status,rule").eq("event_date", yesterday)
      .order("order_id").range(from, to)),
    selectAllRows<ToastCrossCheckOrphan>((from, to) => sb.from("ezcater_toast_orphans")
      .select("location_id,business_date,order_guid,check_guid,amount_cents").eq("business_date", yesterday)
      .order("location_id").order("order_guid").order("check_guid").range(from, to)),
  ]);
  return {
    toastCrossCheck: { orders: reconciliation, orphans },
    toRingInToast,
    today, leads: facts, lostYesterdayIds: lostIds,
    quotesSentYesterday: sentYesterday.map((q) => ({ id: q.id, locationId: q.location_id, totalCents: q.total_cents })),
    openQuotes: openQuotes.filter((q) => !q.expires_at || Date.parse(q.expires_at) > now.getTime()).map((q) => ({ id: q.id, locationId: q.location_id })),
    refundsYesterday: refunds.map((r) => ({ locationId: refundLoc.get(r.quote_id) ?? null, amountCents: r.amount_cents })),
    readiness, staff,
  };
}

/**
 * Today's catering ingredients vs on-hand at one shop: the W4b actor-less core (read-only; the
 * same flatten + advisory on-hand the prep-demand surface shows) plus which SKUs were EVER counted
 * here, so an uncounted SKU says so instead of showing invented stock. Never throws.
 */
async function loadCateringReadiness(locationId: string, day: string): Promise<Loaded<CateringReadiness>> {
  try {
    // Demand: the W4b flatten (oz per SKU). Stock: the counts reader's count-anchored balance —
    // read-only (seedBaselines: false never persists an inferred baseline).
    const [w4b, onHand] = await Promise.all([
      deriveCateringSkuDemand({ locationId, from: day, to: day }),
      deriveOnHand(locationId, Date.now()),
    ]);
    return { kind: "ok", value: readinessFrom(w4b, countAnchoredBalances(onHand.rows)) };
  } catch (error) {
    console.error("[digests] catering readiness failed:", error instanceof Error ? error.message : String(error));
    return { kind: "error" };
  }
}

/** The stations StaffSource: today's assignments + claims. A schedule (7shifts) plugs in beside it. */
export const stationsStaffSource = (sb: Sb): StaffSource => ({
  async roster(locationId, businessDate) {
    const events = await selectAllRows<{ id: string; sequence: number | string; location_id: string; business_date: string; user_id: string; station_id: string | null; position_id: string | null; kind: StationEvent["kind"]; actor_id: string; at: string; source: StationEvent["source"] }>((from, to) =>
      sb.from("station_events").select("id, sequence, location_id, business_date, user_id, station_id, position_id, kind, actor_id, at, source")
        .eq("location_id", locationId).eq("business_date", businessDate).order("sequence").range(from, to));
    const userIds = [...new Set(events.map((e) => e.user_id))];
    const stationIds = [...new Set(events.map((e) => e.station_id).filter((x): x is string => !!x))];
    const [users, stations] = await Promise.all([
      userIds.length === 0 ? [] : selectAllRows<{ id: string; name: string }>((from, to) => sb.from("users").select("id, name").in("id", userIds).order("id").range(from, to)),
      stationIds.length === 0 ? [] : selectAllRows<{ id: string; name: string }>((from, to) => sb.from("stations").select("id, name").in("id", stationIds).order("id").range(from, to)),
    ]);
    const mapped: StationEvent[] = events.map((e) => ({
      id: e.id, sequence: String(e.sequence), locationId: e.location_id, businessDate: e.business_date, userId: e.user_id,
      stationId: e.station_id, positionId: e.position_id, kind: e.kind, actorId: e.actor_id, actorName: null, at: e.at, source: e.source,
    }));
    return { source: "stations", scheduleConnected: false, onStation: stationRoster(mapped, new Map(users.map((u) => [u.id, u.name])), new Map(stations.map((st) => [st.id, st.name]))) };
  },
});

async function loadStaffRoster(sb: Sb, locationId: string, day: string): Promise<Loaded<StaffRoster>> {
  try {
    return { kind: "ok", value: await stationsStaffSource(sb).roster(locationId, day) };
  } catch (error) {
    console.error("[digests] staff roster failed:", error instanceof Error ? error.message : String(error));
    return { kind: "error" };
  }
}

interface DemandRow {
  pipeline_id: string; need_date: string; item_id: string | null; menu_item_id: string | null;
  choice_package_item_id: string | null; portion: "quarter" | "half" | "whole" | null; qty: number | string;
}

/**
 * The W4a ledger per lead, aggregated by (need date, ref, portion) with QUANTITIES and units — not
 * row counts (Astra P2). Names come from the same resolver the prep-demand surface uses.
 */
export async function summarizePrepDemand(sb: Sb, rows: DemandRow[]): Promise<Map<string, PrepLoadLine[]>> {
  const out = new Map<string, PrepLoadLine[]>();
  if (rows.length === 0) return out;
  const itemIds = new Set<string>(); const menuIds = new Set<string>(); const choiceIds = new Set<string>();
  const groups = new Map<string, { pid: string; needDate: string; kind: "item" | "menu_item" | "choice"; id: string; portion: DemandRow["portion"]; qty: number }>();
  for (const r of rows) {
    const kind = r.item_id ? "item" as const : r.menu_item_id ? "menu_item" as const : "choice" as const;
    const id = (r.item_id ?? r.menu_item_id ?? r.choice_package_item_id)!;
    (kind === "item" ? itemIds : kind === "menu_item" ? menuIds : choiceIds).add(id);
    const key = `${r.pipeline_id}|${r.need_date}|${kind}:${id}|${r.portion ?? ""}`;
    const g = groups.get(key) ?? { pid: r.pipeline_id, needDate: r.need_date, kind, id, portion: r.portion, qty: 0 };
    g.qty += typeof r.qty === "string" ? Number(r.qty) : r.qty;
    groups.set(key, g);
  }
  const refs = await resolveRefs(sb, itemIds, menuIds, choiceIds);
  for (const g of groups.values()) {
    const defn = g.kind === "item" ? refs.itemDefns.get(g.id) : undefined;
    const line: PrepLoadLine = {
      needDate: g.needDate, name: refs.name(g.kind, g.id), nameEs: defn?.nameEs ?? null, qty: g.qty,
      unit: g.kind === "item" ? defn?.defaultParUnit ?? null : null, portion: g.portion,
    };
    out.set(g.pid, [...(out.get(g.pid) ?? []), line]);
  }
  for (const list of out.values()) list.sort((x, y) => x.needDate.localeCompare(y.needDate) || x.name.localeCompare(y.name));
  return out;
}

export function supabaseSendStore(sb: Sb): SendStore {
  return {
    async claim(row) {
      const { data, error } = await sb.from("report_digest_sends").insert({ ...row, outcome: "claimed" }).select("id").single<{ id: string }>();
      if (error) {
        if ((error as { code?: string }).code === "23505") return "duplicate";
        throw new Error(`digest claim: ${error.message}`);
      }
      return { id: data.id };
    },
    async markAttempt(id, patch) {
      const { data, error } = await sb.from("report_digest_sends").update(patch)
        .eq("id", id).eq("outcome", "claimed").is("first_attempt_at", null).select("id");
      if (error) throw new Error(`digest attempt: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async recordAccepted(id, patch) {
      const { data, error } = await sb.from("report_digest_sends").update(patch)
        .eq("id", id).in("outcome", ["claimed", "ambiguous"]).select("id");
      if (error) throw new Error(`digest accepted: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async reclaim(id, patch, observed) {
      // The retry lock: the same "claimed" state a fresh send holds. A compare-and-set on the row
      // version this tick observed (attempted_at), never on a row whose acceptance is recorded.
      const { data, error } = await sb.from("report_digest_sends").update({ ...patch, outcome: "claimed" })
        .eq("id", id).eq("outcome", "ambiguous").eq("attempted_at", observed.attempted_at)
        .is("provider_message_id", null).select("id");
      if (error) throw new Error(`digest reclaim: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async finish(id, from, patch, guard) {
      const terminal = patch.outcome !== "ambiguous";
      let q = sb.from("report_digest_sends")
        .update({ ...patch, ...(terminal ? { completed_at: new Date().toISOString() } : {}) })
        .eq("id", id).in("outcome", from);
      if (guard?.noMessageId) q = q.is("provider_message_id", null);
      if (guard?.neverAttempted) q = q.is("first_attempt_at", null);
      if (guard?.observedAttemptedAt) q = q.eq("attempted_at", guard.observedAttemptedAt);
      if (guard?.staleBefore) q = q.lt("attempted_at", guard.staleBefore);
      const { data, error } = await q.select("id");
      if (error) throw new Error(`digest finish: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async skip(row) {
      const { error } = await sb.from("report_digest_sends").insert({ ...row, outcome: "skipped", completed_at: new Date().toISOString() });
      if (error) throw new Error(`digest skip: ${error.message}`);
    },
  };
}

/**
 * The ops alert, job-watch shaped (one bilingual email to OPS_ALERT_EMAIL + a cron.failure row
 * with job digest-<kind>), claimed once per detector × kind × business day × ET day through the
 * same atomic RPC job-watch uses. Fails closed on a claim error (no duplicate storm) but never
 * throws: the failed send row and digest-watch remain the record.
 */
export async function alertDigestProblem(sb: Sb, a: DigestAlert, now: Date): Promise<boolean> {
  try {
    const etDay = easternDay(now);
    const claim = await sb.rpc("portal_rate_limit_hit", {
      p_bucket_key: `${a.detector}:${a.kind}:${a.day}:${etDay}`,
      p_window_start: easternBoundary(etDay, 0).toISOString(),
      p_max: 1,
    });
    if (claim.error || claim.data !== true) return false;
    const params = { kind: a.kind, day: a.day, n: a.missing?.length ?? 0, refs: (a.missing ?? []).slice(0, 10).join(", "), ref: a.ref ?? "", error: a.error ?? "" };
    const messages = (["en", "es"] as const).map((language) => ({
      subject: serverT(language, a.detector === "digest-send" ? "digestWatch.send_failed_subject" : a.detector === "digest-preview" ? "digestWatch.preview_subject" : "digestWatch.subject", params),
      body: serverT(language, a.detector === "digest-send" ? "digestWatch.send_failed_body" : a.detector === "digest-preview" ? "digestWatch.preview_body" : "digestWatch.body", params),
    }));
    const text = messages.map((m) => m.body).join("\n\n");
    let emailError: string | null = null;
    const sent = await sendEmail({
      to: process.env.OPS_ALERT_EMAIL?.trim() || DEFAULT_OPS_ALERT_EMAIL, from: teamFrom(),
      subject: messages[0]!.subject, text,
      html: `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n\n", "</p><p>")}</p>`,
    });
    if ("error" in sent) emailError = sent.error.slice(0, 500);
    await audit({ ...auditBase, action: "cron.failure", resourceTable: "report_digest_sends", metadata: {
      job: `digest-${a.kind}`, detector: a.detector, business_day: a.day,
      missing: a.missing ?? null, recipient_ref: a.ref ?? null, error: a.error ?? null, email_error: emailError,
    } });
    return true;
  } catch {
    return false;
  }
}

function buildIO(now: Date): DigestIO {
  const sb = getServiceRoleClient();
  return {
    now,
    baseUrl: appUrl(),
    previewRecipient: () => loadPreviewRecipient(sb),
    settings: () => loadDigestSettings(sb),
    directory: () => loadDigestDirectory(sb),
    sendLog: (days) => loadSendLog(sb, days),
    finalizedClosings: (days) => loadFinalizedClosings(sb, days),
    shopFacts: (location, day) => loadShopDayFacts(sb, location, day, now),
    cateringFacts: (today) => loadCateringFacts(sb, today, now),
    store: supabaseSendStore(sb),
    sendEmail: (m) => sendEmail({ ...m, from: teamFrom() }),
    sha: (content) => createHash("sha256").update(content).digest("hex"),
    alert: (a) => alertDigestProblem(sb, a, now),
    // Exports PR: the scheduled CSV/PDF package (Pete at close; the accountant once enabled).
    packages: packageIO(sb, now),
    async recordRun(summary: DigestRunSummary) {
      await audit({ ...auditBase, action: "digest.run", resourceTable: "report_digest_sends", metadata: { ...summary } });
    },
  };
}

/** The pinger tick. Throws on a read failure (the route records cron.failure); null when OFF. */
export async function runDigestTick(now: Date = new Date()): Promise<DigestRunSummary | null> {
  return runDigestTickWith(buildIO(now));
}

/**
 * The closing hook. NEVER throws: it runs inside after() beside the sales pull, and the tick
 * reconciles anything it misses (a closing finalized with no sent row is sent on the next tick).
 */
export async function runClosingDigests(locationId: string, day: string): Promise<void> {
  try {
    await runClosingDigestsWith(buildIO(new Date()), locationId, day);
  } catch (error) {
    console.error("[digests] closing hook failed; the next digest-tick reconciles:", error instanceof Error ? error.message : String(error));
  }
}

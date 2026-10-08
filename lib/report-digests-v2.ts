/**
 * Digest v2 — the server READS behind the management summary (service role, read-only: never a
 * write on a read path). Each area loads fail-soft into `Loaded<T>`: a failed read is `error`
 * (the digest says "could not load"), a missing source is `unavailable` (never $0), and the rest
 * of the digest still goes out. The pure math lives in lib/report-digests-v2-shared.ts.
 */
import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { readNotInToast } from "@/lib/catering/not-in-toast";
import { loadCapturedToastDay } from "@/lib/toast/captured-day";
import { summarizeLabor, weekStart, type LaborEntryFact, type LaborSummary } from "@/lib/toast/labor-shared";
import { laborPullEnabled, runToastLaborPull } from "@/lib/toast/labor";
import { addDays, etDayRange } from "@/lib/report-digests-shared";
import {
  cutoffsTomorrow,
  deliveriesLookahead,
  dollarsToCents,
  etDayOf,
  failed,
  groupWaste,
  lookaheadDay,
  ok,
  orderingForDay,
  summarizeSalesDay,
  sumKnown,
  unavailable,
  walkSnapshot,
  type CateringNightFacts,
  type DeliveryFact,
  type InventoryFacts,
  type Loaded,
  type PeopleFacts,
  type PoFact,
  type ReceivingFacts,
  type SalesFacts,
  type SalesSummaryInput,
  type ShopV2Facts,
  type VendorCutoff,
  type VendorFact,
  type WalkFact,
  type WalkLineFact,
} from "@/lib/report-digests-v2-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;

/** Chunked `.in()` reads: an id list in the request line must stay bounded (the 414 lesson). */
async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...await read(ids.slice(i, i + 100)));
  return out;
}

async function settle<T>(fn: () => Promise<Loaded<T>>, area: string): Promise<Loaded<T>> {
  try { return await fn(); }
  catch (e) {
    console.error(`[digest v2] ${area} read failed:`, e instanceof Error ? e.message : String(e));
    return failed();
  }
}

// ── Sales ────────────────────────────────────────────────────────────────────────────────────

async function salesDay(sb: Sb, locationId: string, day: string): Promise<SalesSummaryInput | null> {
  const captured = await loadCapturedToastDay(locationId, day);
  if (!captured) return null;
  const ids = captured.orders.map((o) => o.snapshotId);
  const discounts = await inChunks(ids, (chunk) => selectAllRows<{ snapshot_id: string; check_guid: string; name: string | null; amount_cents: number | string | null }>((from, to) =>
    sb.from("toast_check_discounts").select("snapshot_id, check_guid, name, amount_cents").in("snapshot_id", chunk)
      .order("snapshot_id").order("check_guid").order("ordinal").range(from, to)));
  return {
    orders: captured.orders,
    discounts: discounts.map((d) => ({ snapshotId: d.snapshot_id, checkGuid: d.check_guid, name: d.name, amountCents: d.amount_cents === null ? null : Number(d.amount_cents) })),
    configDegraded: captured.coverage.configDegraded,
  };
}

export async function loadSales(sb: Sb, locationId: string, day: string): Promise<Loaded<SalesFacts>> {
  const [today, lastWeek] = await Promise.all([salesDay(sb, locationId, day), salesDay(sb, locationId, addDays(day, -7))]);
  if (!today) return unavailable("no_capture");
  try {
    return ok({
      today: summarizeSalesDay(day, today.orders, today.discounts, today.configDegraded),
      lastWeek: lastWeek ? summarizeSalesDay(addDays(day, -7), lastWeek.orders, lastWeek.discounts, lastWeek.configDegraded) : null,
    });
  } catch (e) {
    // The pulse's own refusal: a live check with no amount is unknown money, never $0.
    if (e instanceof Error && e.message === "capture_pulse_amount_missing") return unavailable("amount_missing");
    throw e;
  }
}

// ── Catering (0195 split for D, booked for D+1) ──────────────────────────────────────────────

export async function loadCateringNight(sb: Sb, locationId: string, day: string): Promise<Loaded<CateringNightFacts>> {
  const tomorrow = lookaheadDay(day);
  const leads = await selectAllRows<{ id: string; contact_name: string; company: string | null; event_date: string; time_window: string | null; headcount: number | null; stage: string; delivery_address: string | null; estimated_revenue_cents: number | null }>((from, to) =>
    sb.from("catering_pipeline").select("id, contact_name, company, event_date, time_window, headcount, stage, delivery_address, estimated_revenue_cents")
      .eq("location_id", locationId).in("event_date", [day, tomorrow]).in("stage", ["confirmed", "out", "completed"]).order("id").range(from, to));
  const ids = leads.map((l) => l.id);
  const quotes = await inChunks(ids, (chunk) => selectAllRows<{ pipeline_id: string; total_cents: number; is_delivery: boolean; version: number }>((from, to) =>
    sb.from("catering_quotes").select("pipeline_id, total_cents, is_delivery, version").in("pipeline_id", chunk)
      .eq("status", "accepted").is("superseded_at", null).order("id").range(from, to)));
  const accepted = new Map<string, { total_cents: number; is_delivery: boolean; version: number }>();
  for (const q of quotes) { const p = accepted.get(q.pipeline_id); if (!p || q.version > p.version) accepted.set(q.pipeline_id, q); }
  const value = (l: (typeof leads)[number]) => accepted.get(l.id)?.total_cents ?? l.estimated_revenue_cents ?? 0;
  const onDay = leads.filter((l) => l.event_date === day);
  return ok({
    toRingInToast: await readNotInToast(sb, [locationId], { from: tomorrow, through: tomorrow }),
    day: {
      orders: onDay.length,
      completedCents: onDay.filter((l) => l.stage === "completed").reduce((a, l) => a + value(l), 0),
      confirmedCents: onDay.filter((l) => l.stage !== "completed").reduce((a, l) => a + value(l), 0),
    },
    tomorrow: leads.filter((l) => l.event_date === tomorrow && l.stage !== "completed").map((l) => ({
      id: l.id, name: l.company ? `${l.contact_name} (${l.company})` : l.contact_name, timeWindow: l.time_window, headcount: l.headcount,
      isDelivery: !!l.delivery_address?.trim() || !!accepted.get(l.id)?.is_delivery,
    })),
  });
}

// ── Shared reads (vendors, walks, POs) ───────────────────────────────────────────────────────

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
}

function sharedReads(sb: Sb, locationId: string, day: string) {
  const vendors = memo(async (): Promise<VendorFact[]> => (await selectAllRows<{ id: string; name: string; source_kind: "vendor" | "store"; active: boolean }>((from, to) =>
    sb.from("vendors").select("id, name, source_kind, active").order("id").range(from, to))).map((v) => ({ id: v.id, name: v.name, sourceKind: v.source_kind, active: v.active })));
  // Walks from D-1 00:00 ET through D+1: every cutoff on D looks back 24 h, and D's own walks
  // are the inventory snapshot.
  const walks = memo(async () => {
    const from = etDayRange(addDays(day, -1)).startIso;
    const to = etDayRange(lookaheadDay(day)).endExclusiveIso;
    const events = await selectAllRows<{ id: string; walked_at: string }>((f, t) =>
      sb.from("par_pass_events").select("id, walked_at").eq("location_id", locationId).eq("status", "submitted")
        .gte("walked_at", from).lt("walked_at", to).order("id").range(f, t));
    const lines = await inChunks(events.map((e) => e.id), (chunk) => selectAllRows<{ event_id: string; vendor_id: string | null; sku_id: string; order_qty: number | string; par_qty: number | string | null; implied_on_hand_oz: number | string | null }>((f, t) =>
      sb.from("par_pass_lines").select("event_id, vendor_id, sku_id, order_qty, par_qty, implied_on_hand_oz").in("event_id", chunk).order("id").range(f, t)));
    const skuIds = [...new Set(lines.map((l) => l.sku_id))];
    const skus = await inChunks(skuIds, (chunk) => selectAllRows<{ id: string; name: string }>((f, t) =>
      sb.from("vendor_items").select("id, name").in("id", chunk).order("id").range(f, t)));
    const skuName = new Map(skus.map((s) => [s.id, s.name]));
    const num = (v: number | string | null) => v === null ? null : Number(v);
    return {
      walks: events.map((e): WalkFact => ({ eventId: e.id, walkedAt: e.walked_at })),
      lines: lines.map((l): WalkLineFact => ({
        eventId: l.event_id, skuId: l.sku_id, vendorId: l.vendor_id, orderQty: Number(l.order_qty) || 0, parQty: num(l.par_qty),
        impliedOnHandOz: num(l.implied_on_hand_oz), skuName: skuName.get(l.sku_id) ?? "—",
      })),
    };
  });
  // POs: everything created in the last 21 days at the shop (covers D-1..D+1 and every still-open
  // order a rhythm could land tomorrow; a 14-day lead cap + a week of slack).
  const pos = memo(async (): Promise<PoFact[]> => {
    const rows = await selectAllRows<{ id: string; display_code: string; vendor_id: string; status: string; created_at: string; confirmed_at: string | null; placed_at: string | null; placed_by: string | null }>((f, t) =>
      sb.from("purchase_orders").select("id, display_code, vendor_id, status, created_at, confirmed_at, placed_at, placed_by")
        .eq("location_id", locationId).gte("created_at", etDayRange(addDays(day, -21)).startIso).order("id").range(f, t));
    const lines = await inChunks(rows.map((r) => r.id), (chunk) => selectAllRows<{ po_id: string; order_qty: number | string; price_cents_at_order: number | null }>((f, t) =>
      sb.from("po_lines").select("po_id, order_qty, price_cents_at_order").in("po_id", chunk).order("id").range(f, t)));
    const userIds = [...new Set(rows.map((r) => r.placed_by).filter((x): x is string => !!x))];
    const users = userIds.length === 0 ? [] : await inChunks(userIds, (chunk) => selectAllRows<{ id: string; name: string }>((f, t) =>
      sb.from("users").select("id, name").in("id", chunk).order("id").range(f, t)));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => {
      const mine = lines.filter((l) => l.po_id === r.id);
      const priced = mine.filter((l) => l.price_cents_at_order !== null);
      return {
        id: r.id, displayCode: r.display_code, vendorId: r.vendor_id, status: r.status, createdAt: r.created_at,
        confirmedAt: r.confirmed_at, placedAt: r.placed_at, placedByName: r.placed_by ? userName.get(r.placed_by) ?? null : null,
        totalCents: priced.length === 0 ? null : Math.round(priced.reduce((a, l) => a + Number(l.order_qty) * l.price_cents_at_order!, 0)),
        unpricedLines: mine.length - priced.length,
      };
    });
  });
  return { vendors, walks, pos };
}

// ── Ordering ─────────────────────────────────────────────────────────────────────────────────

async function loadOrdering(sb: Sb, s: ReturnType<typeof sharedReads>, locationId: string, day: string, now: Date): Promise<ShopV2Facts["ordering"]> {
  const [vendors, walks, pos, cutoffs, rhythm, skips] = await Promise.all([
    s.vendors(), s.walks(), s.pos(),
    selectAllRows<{ vendor_id: string; location_id: string | null; order_day: number; cutoff_time: string }>((f, t) =>
      sb.from("vendor_cutoffs").select("vendor_id, location_id, order_day, cutoff_time").eq("active", true)
        .or(`location_id.is.null,location_id.eq.${locationId}`).order("id").range(f, t)),
    selectAllRows<{ vendor_id: string; location_id: string; order_dow: number; lead_days: number }>((f, t) =>
      sb.from("vendor_delivery_rhythm").select("vendor_id, location_id, order_dow, lead_days").eq("active", true).eq("location_id", locationId).order("id").range(f, t)),
    selectAllRows<{ vendor_id: string; skip_from: string; skip_through: string }>((f, t) =>
      sb.from("vendor_rhythm_skips").select("vendor_id, skip_from, skip_through").eq("active", true).eq("location_id", locationId).order("id").range(f, t)),
  ]);
  const open = pos.filter((p) => ["confirmed", "placed", "invoiced"].includes(p.status)).map((p) => p.id);
  const received = await inChunks(open, (chunk) => selectAllRows<{ purchase_order_id: string }>((f, t) =>
    sb.from("vendor_deliveries").select("purchase_order_id").in("purchase_order_id", chunk).order("id").range(f, t)));
  const input = {
    day, locationId, now, pos, vendors,
    cutoffs: cutoffs.map((c): VendorCutoff => ({ vendorId: c.vendor_id, locationId: c.location_id, orderDay: c.order_day, cutoffTime: c.cutoff_time })),
    walks: walks.walks, walkLines: walks.lines,
    rhythm: rhythm.map((r) => ({ vendorId: r.vendor_id, locationId: r.location_id, orderDow: r.order_dow, leadDays: r.lead_days })),
    skips: skips.map((x) => ({ vendorId: x.vendor_id, skipFrom: x.skip_from, skipThrough: x.skip_through })),
    receivedPoIds: new Set(received.map((r) => r.purchase_order_id)),
  };
  return ok({
    day: orderingForDay(input),
    deliveries: deliveriesLookahead(input),
    cutoffsTomorrow: cutoffsTomorrow(input),
    vendorNames: Object.fromEntries(vendors.map((v) => [v.id, v.name])),
  });
}

// ── Receiving + inventory ────────────────────────────────────────────────────────────────────

async function loadDeliveries(sb: Sb, s: ReturnType<typeof sharedReads>, locationId: string, day: string): Promise<DeliveryFact[]> {
  const [vendors, rows, pos] = await Promise.all([
    s.vendors(),
    selectAllRows<{ id: string; vendor_id: string; invoice_total: number | string | null; match_state: string; receipt_url: string | null; purchase_order_id: string | null }>((f, t) =>
      sb.from("vendor_deliveries").select("id, vendor_id, invoice_total, match_state, receipt_url, purchase_order_id")
        .eq("location_id", locationId).eq("delivery_date", day).order("id").range(f, t)),
    s.pos(),
  ]);
  const items = await inChunks(rows.map((r) => r.id), (chunk) => selectAllRows<{ delivery_id: string; qty_received: number | string; unit_price: number | string | null; discrepancy_type: string | null }>((f, t) =>
    sb.from("vendor_delivery_items").select("delivery_id, qty_received, unit_price, discrepancy_type").in("delivery_id", chunk).order("id").range(f, t)));
  const vendor = new Map(vendors.map((v) => [v.id, v]));
  const poCode = new Map(pos.map((p) => [p.id, p.displayCode]));
  return rows.map((r) => {
    const mine = items.filter((i) => i.delivery_id === r.id);
    const lineCents = mine.every((i) => i.unit_price !== null) && mine.length > 0
      ? Math.round(mine.reduce((a, i) => a + Number(i.qty_received) * Number(i.unit_price) * 100, 0)) : null;
    const count = (k: string) => mine.filter((i) => i.discrepancy_type === k).length;
    return {
      id: r.id, vendorId: r.vendor_id, vendorName: vendor.get(r.vendor_id)?.name ?? "—", sourceKind: vendor.get(r.vendor_id)?.sourceKind ?? "vendor",
      cents: dollarsToCents(r.invoice_total) ?? lineCents, matchState: r.match_state, hasReceipt: !!r.receipt_url,
      poDisplayCode: r.purchase_order_id ? poCode.get(r.purchase_order_id) ?? null : null,
      discrepancies: { short: count("short"), over: count("over"), damaged: count("damaged"), substitution: count("substitution") },
    };
  });
}

async function loadReceiving(sb: Sb, deliveries: () => Promise<DeliveryFact[]>, s: ReturnType<typeof sharedReads>, locationId: string, day: string): Promise<Loaded<ReceivingFacts>> {
  const range = etDayRange(day);
  const [list, vendors, credits, invoices] = await Promise.all([
    deliveries(), s.vendors(),
    selectAllRows<{ vendor_id: string; reason: string; amount_cents: number | null }>((f, t) =>
      sb.from("vendor_credits").select("vendor_id, reason, amount_cents").eq("location_id", locationId)
        .gte("created_at", range.startIso).lt("created_at", range.endExclusiveIso).order("id").range(f, t)),
    sb.from("email_receipts").select("id", { count: "exact", head: true })
      .eq("location_id", locationId).is("linked_delivery_id", null).eq("doc_kind", "invoice"),
  ]);
  if (invoices.error) throw new Error(`invoices pending: ${invoices.error.message}`);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  return ok({
    deliveries: list,
    credits: credits.map((c) => ({ vendorName: vendorName.get(c.vendor_id) ?? "—", reason: c.reason, amountCents: c.amount_cents })),
    invoicesPendingReview: invoices.count ?? 0,
  });
}

async function loadInventory(sb: Sb, deliveries: () => Promise<DeliveryFact[]>, s: ReturnType<typeof sharedReads>, locationId: string, day: string): Promise<Loaded<InventoryFacts>> {
  const [walks, list, tosses] = await Promise.all([
    s.walks(), deliveries(),
    selectAllRows<{ item_id: string; tossed_qty: number | string; tossed_par_unit: string | null }>((f, t) =>
      sb.from("prep_batch_sessions").select("item_id, tossed_qty, tossed_par_unit").eq("location_id", locationId)
        .eq("business_date", day).gt("tossed_qty", 0).order("instance_id").order("template_item_id").range(f, t)),
  ]);
  const itemIds = [...new Set(tosses.map((r) => r.item_id))];
  const items = await inChunks(itemIds, (chunk) => selectAllRows<{ id: string; name: string }>((f, t) =>
    sb.from("items").select("id, name").in("id", chunk).order("id").range(f, t)));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const stores = list.filter((d) => d.sourceKind === "store");
  const storeMoney = sumKnown(stores.map((d) => d.cents));
  return ok({
    walk: walkSnapshot(walks.walks.filter((w) => etDayOf(w.walkedAt) === day), walks.lines),
    waste: groupWaste(tosses.map((r) => ({ name: itemName.get(r.item_id) ?? "—", qty: Number(r.tossed_qty) || 0, unit: r.tossed_par_unit }))),
    storeRuns: { runs: stores.length, cents: storeMoney.cents, unknownCents: storeMoney.unknown },
  });
}

// ── People ───────────────────────────────────────────────────────────────────────────────────

async function loadPeople(sb: Sb, locationId: string, day: string): Promise<Loaded<PeopleFacts>> {
  const range = etDayRange(day);
  const [assigned, open] = await Promise.all([
    sb.from("recipe_yield_retrain_notes").select("id", { count: "exact", head: true }).eq("location_id", locationId)
      .gte("created_at", range.startIso).lt("created_at", range.endExclusiveIso),
    sb.from("recipe_yield_retrain_notes").select("id", { count: "exact", head: true }).eq("location_id", locationId).eq("status", "open"),
  ]);
  if (assigned.error || open.error) throw new Error(`retrains: ${(assigned.error ?? open.error)!.message}`);
  return ok({ retrains: { assignedToday: assigned.count ?? 0, open: open.count ?? 0 } });
}

// ── Labor (Toast time entries, 0224) ─────────────────────────────────────────────────────────

/**
 * Day D's labor for the digest (Astra r2 P1). Closing digests and the 03:00 fallback send BEFORE the
 * 09:00 UTC nightly, so the digest pulls D for this shop itself, bounded (20 s) and fail-soft, just
 * before composing; the nightly pull stays the backstop. A pull that is off or fails = "labor not
 * available yet" — never zero, never yesterday's partial rows dressed as the day.
 */
export const DIGEST_LABOR_PULL_MS = 20_000;
export async function laborForDigest(
  locationId: string, day: string,
  deps: { enabled: () => boolean; pull: (day: string, locationId: string) => Promise<{ ok: boolean }>; read: () => Promise<Loaded<LaborSummary>> },
): Promise<Loaded<LaborSummary>> {
  if (!deps.enabled()) return unavailable("labor_off");
  let pulled = false;
  try { pulled = (await deps.pull(day, locationId)).ok; } catch { pulled = false; }
  if (!pulled) return unavailable("labor_pull_failed");
  return deps.read();
}

export async function loadLabor(sb: Sb, locationId: string, day: string, sales: Loaded<SalesFacts>): Promise<Loaded<LaborSummary>> {
  // Week-to-date (Mon..D) for the 40 h flag; D for everything else.
  const rows = await selectAllRows<{ employee_guid: string; employee_first_name: string | null; job_name: string | null; business_date: string; hours: number | string | null; overtime_hours: number | string | null; out_at: string | null }>((f, t) =>
    sb.from("toast_time_entries").select("employee_guid, employee_first_name, job_name, business_date, hours, overtime_hours, out_at")
      .eq("location_id", locationId).eq("deleted", false).gte("business_date", weekStart(day)).lte("business_date", day)
      .order("business_date").order("time_entry_guid").range(f, t));
  if (!rows.some((r) => r.business_date === day)) return unavailable("no_labor");
  const entries: LaborEntryFact[] = rows.map((r) => ({
    employeeGuid: r.employee_guid, firstName: r.employee_first_name, jobName: r.job_name, businessDate: r.business_date,
    hours: r.hours === null ? null : Number(r.hours), overtimeHours: r.overtime_hours === null ? null : Number(r.overtime_hours), open: r.out_at === null,
  }));
  return ok(summarizeLabor(day, entries, sales.kind === "ok" ? sales.value.today.netCents : null));
}

/** Every v2 area for one shop and business day. Never throws. */
export async function loadShopV2Facts(sb: Sb, locationId: string, day: string, now: Date): Promise<ShopV2Facts> {
  const s = sharedReads(sb, locationId, day);
  const deliveries = memo(() => loadDeliveries(sb, s, locationId, day));
  const [sales, catering, ordering, receiving, inventory, people] = await Promise.all([
    settle(() => loadSales(sb, locationId, day), "sales"),
    settle(() => loadCateringNight(sb, locationId, day), "catering"),
    settle(() => loadOrdering(sb, s, locationId, day, now), "ordering"),
    settle(() => loadReceiving(sb, deliveries, s, locationId, day), "receiving"),
    settle(() => loadInventory(sb, deliveries, s, locationId, day), "inventory"),
    settle(() => loadPeople(sb, locationId, day), "people"),
  ]);
  const labor = await settle(() => laborForDigest(locationId, day, {
    enabled: laborPullEnabled,
    pull: async (d, loc) => {
      const r = await runToastLaborPull([d], { deadlineMs: DIGEST_LABOR_PULL_MS, context: "digest", locationIds: [loc] });
      return { ok: r.ran && r.results.length > 0 && r.results.every((x) => x.ok) };
    },
    read: () => loadLabor(sb, locationId, day, sales),
  }), "labor");
  return { lookahead: lookaheadDay(day), sales, catering, ordering, receiving, inventory, people, labor };
}

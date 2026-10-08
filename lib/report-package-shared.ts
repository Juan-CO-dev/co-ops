/**
 * The accountant package — the PURE core (zero I/O). Reports hub v2 piece 3, "Accountant package".
 *
 * Juan, 2026-10-07: "design it without the accountants email, once we have it we can just plug it
 * in… assume what he would want… as granular as an accountant would theoretically want or need…
 * adjust as needed." So every section is granular by default (one row per shop per day, per
 * delivery, per event, per count line), money is integer cents written as dollars with a currency
 * column, and a section whose source does not exist says so instead of printing zeros.
 *
 * Sections: sales (NOT YET AVAILABLE: Toast checks/payments are piece 4), cash, catering (0195
 * money split), purchases (deliveries AND store runs, plus vendor credits), waste (tossed prep ×
 * cost), inventory (value at each physical count). Weekly and monthly packages add four rollups:
 * sales by tax category (not yet available), purchases by vendor, waste by category, cash variance.
 *
 * The loaders that produce the *Raw inputs are in lib/report-package.ts; the CSV/PDF writers are
 * lib/report-export-shared.ts and lib/report-pdf.ts; the scheduled send rides the digest engine.
 */
import {
  NOT_YET_AVAILABLE,
  dollarsToCents,
  moneyStatus,
  type ExportColumn,
  type ExportRow,
  type ShopRef,
} from "@/lib/report-export-shared";
import { PACKAGE_SECTIONS, type PackageCadence, type PackageFormat, type PackageSection } from "@/lib/report-recipients-shared";
import { addDays, etClock, normEmail, roleLevel, DIGEST_ALL_SHOPS_LEVEL, type DigestSkipReason, type DirectoryUser, type DirectoryMembership } from "@/lib/report-digests-shared";
import type { Language } from "@/lib/i18n/types";
import type { ComposedEmail, Envelope } from "@/lib/report-digests-compose";

export const ROLLUP_SECTIONS = ["rollup_sales_by_tax_category", "rollup_purchases_by_vendor", "rollup_waste_by_category", "rollup_cash_variance"] as const;
export type RollupSection = (typeof ROLLUP_SECTIONS)[number];
export type PackageTableKey = PackageSection | RollupSection;
export type PackageKind = "package_daily" | "package_weekly" | "package_monthly";
export const PACKAGE_KINDS: readonly PackageKind[] = ["package_daily", "package_weekly", "package_monthly"];

const col = (key: string, kind: ExportColumn["kind"] = "text"): ExportColumn => ({ key, kind });
/** Every per-day section row starts with these (spec: "per shop per day"). */
const DAY = [col("business_date", "date"), col("location_code"), col("location_name"), col("currency", "currency")];
const PERIOD = [col("period_start", "date"), col("period_end", "date"), col("location_code"), col("location_name"), col("currency", "currency")];

/**
 * THE ACCOUNTANT CONTRACT. Stable snake_case names, pinned by tests/report-package.test.ts.
 * Money columns: cents in, dollars out. `status` = not_yet_available where the source is missing.
 */
export const PACKAGE_COLUMNS: Record<PackageTableKey, readonly ExportColumn[]> = {
  sales: [
    ...DAY, col("status"), col("gross", "money"), col("discounts", "money"), col("comps", "money"), col("voids", "money"),
    col("refunds", "money"), col("net", "money"), col("sales_tax", "money"), col("tips", "money"), col("service_fees", "money"),
    col("delivery_fees", "money"), col("gift_cards", "money"), col("payment_type"), col("channel"),
  ],
  cash: [
    ...DAY, col("report_id"), col("projected", "money"), col("drawer_total", "money"), col("float", "money"),
    col("deposit", "money"), col("over_short", "money"), col("cash_tips", "money"), col("count_method"),
    col("paid_ins", "money"), col("paid_outs", "money"), col("paid_ins_outs_status"), col("closer"), col("signed_at", "datetime"),
    col("payment_type"),
  ],
  catering: [
    ...DAY, col("lead_id"), col("external_ref"), col("lead_source"), col("stage"), col("money_status"), col("customer"),
    col("headcount", "int"), col("quote_id"), col("quote_version", "int"), col("subtotal", "money"), col("delivery_fee", "money"),
    col("service_charge", "money"), col("gratuity", "money"), col("tax", "money"), col("total", "money"), col("deposit", "money"),
    col("value", "money"), col("value_basis"), col("paid_total", "money"), col("paid_stripe", "money"), col("paid_manual", "money"),
    col("paid_platform", "money"), col("refunded", "money"), col("outstanding", "money"), col("payment_type"),
  ],
  purchases: [
    ...DAY, col("kind"), col("delivery_id"), col("vendor_or_store"), col("invoice_number"), col("invoice_total", "money"),
    col("line_count", "int"), col("priced_line_count", "int"), col("lines_total", "money"), col("has_receipt_photo", "bool"),
    col("detail_link"), col("po_code"), col("match_state"), col("delivery_status"), col("received_by"),
    col("credit_count", "int"), col("credit_amount", "money"), col("credit_status"),
  ],
  waste: [
    ...DAY, col("item"), col("category"), col("tossed_qty", "number"), col("par_unit"), col("tossed_at", "datetime"),
    col("tossed_by"), col("source"), col("unit_cost", "money"), col("est_cost", "money"), col("cost_status"),
  ],
  inventory: [
    ...DAY, col("row_type"), col("count_event_id"), col("counted_at", "datetime"), col("counted_by"), col("sku_id"), col("sku"),
    col("level_label"), col("qty", "number"), col("resolved_oz", "number"), col("cost_per_oz", "number"), col("value", "money"),
    col("cost_status"),
  ],
  rollup_sales_by_tax_category: [...PERIOD, col("tax_category"), col("status"), col("net_sales", "money"), col("sales_tax", "money")],
  rollup_purchases_by_vendor: [
    ...PERIOD, col("kind"), col("vendor_or_store"), col("deliveries", "int"), col("invoice_total", "money"),
    col("lines_total", "money"), col("credits_total", "money"),
  ],
  rollup_waste_by_category: [
    ...PERIOD, col("category"), col("tosses", "int"), col("est_cost", "money"), col("uncosted_tosses", "int"),
  ],
  rollup_cash_variance: [
    ...PERIOD, col("cash_reports", "int"), col("deposits", "money"), col("over_short_total", "money"), col("over_total", "money"),
    col("short_total", "money"), col("cash_tips", "money"),
  ],
};

// ── Periods and due dates (ET) ──────────────────────────────────────────────────────────────

export function packageKindFor(cadence: PackageCadence): PackageKind {
  return cadence === "weekly_mon" ? "package_weekly" : cadence === "monthly_1st" ? "package_monthly" : "package_daily";
}

/**
 * The period a package covers, keyed by its send-log business_day:
 *   daily_close  — business_day D → D..D (the day that closed)
 *   weekly_mon   — business_day = the Monday it is sent → the prior Monday..Sunday
 *   monthly_1st  — business_day = the 1st it is sent → the whole prior month
 */
export function packagePeriod(cadence: PackageCadence, businessDay: string): { from: string; to: string } {
  if (cadence === "weekly_mon") return { from: addDays(businessDay, -7), to: addDays(businessDay, -1) };
  if (cadence === "monthly_1st") {
    const to = addDays(businessDay, -1);
    return { from: `${to.slice(0, 8)}01`, to };
  }
  return { from: businessDay, to: businessDay };
}

/** Weekly (Mon) and monthly (1st) packages go out at 06:00 ET (spec), inside the pinger window. */
export const PACKAGE_SEND_MINUTES_ET = 6 * 60;

export function periodicPackageDue(now: Date): Array<{ cadence: PackageCadence; day: string }> {
  const { day, minutes } = etClock(now);
  if (minutes < PACKAGE_SEND_MINUTES_ET) return [];
  const out: Array<{ cadence: PackageCadence; day: string }> = [];
  if (new Date(`${day}T12:00:00Z`).getUTCDay() === 1) out.push({ cadence: "weekly_mon", day });
  if (day.endsWith("-01")) out.push({ cadence: "monthly_1st", day });
  return out;
}

// ── Recipients ──────────────────────────────────────────────────────────────────────────────

export interface PackageRecipientRow {
  id: string; kind: "internal" | "external"; user_id: string | null; email: string | null; display_name: string;
  active: boolean; location_ids: string[] | null; packages: string[]; cadence: string | null; formats: string[];
}

export interface PackageRecipient {
  ref: string;
  /** user id for staff; the report_recipients row id for an external address. */
  userId: string;
  name: string;
  email: string | null;
  language: Language;
  locationIds: string[];
  skip: DigestSkipReason | null;
  allShops: boolean;
  external: boolean;
  sections: PackageSection[];
  formats: PackageFormat[];
}

/**
 * Who gets which package (CC answers Q3: "Pete only (CSV + PDF at close), plus the accountant row
 * created DISABLED until the email is plugged in"). Only report_recipients rows with packages and
 * a matching cadence; nobody gets a package by role alone.
 *   internal — the staff user's own email + language; shops = location_ids, else every shop for
 *              level ≥ 8, else their memberships.
 *   external — the row's email; shops = location_ids, else every shop. No email or active=false →
 *              a logged skip (the accountant row stays a recipient_disabled skip until it is enabled).
 */
export function resolvePackageRecipients(args: {
  rows: readonly PackageRecipientRow[]; users: readonly DirectoryUser[]; memberships: readonly DirectoryMembership[];
  locationIds: readonly string[]; cadence: PackageCadence;
}): PackageRecipient[] {
  const active = new Set(args.locationIds);
  const all = [...args.locationIds];
  const users = new Map(args.users.map((u) => [u.id, u]));
  const out: PackageRecipient[] = [];
  for (const row of args.rows) {
    if (row.cadence !== args.cadence) continue;
    const sections = PACKAGE_SECTIONS.filter((s) => row.packages.includes(s));
    if (sections.length === 0) continue;
    const formats = (["csv", "pdf"] as const).filter((f) => row.formats.includes(f));
    const pick = (ids: readonly string[]) => all.filter((id) => ids.includes(id) && active.has(id));
    if (row.kind === "external") {
      const shops = row.location_ids ? pick(row.location_ids) : all;
      const email = normEmail(row.email);
      out.push({
        ref: `ext:${row.id}`, userId: row.id, name: row.display_name, email, language: "en", locationIds: shops,
        skip: !row.active ? "recipient_disabled" : !email ? "no_email" : shops.length === 0 ? "no_locations" : null,
        allShops: all.length > 0 && shops.length === all.length, external: true, sections, formats,
      });
      continue;
    }
    const u = row.user_id ? users.get(row.user_id) : undefined;
    if (!u) continue;
    const memberships = args.memberships.filter((m) => m.userId === u.id).map((m) => m.locationId);
    const shops = row.location_ids ? pick(row.location_ids) : roleLevel(u.role) >= DIGEST_ALL_SHOPS_LEVEL ? all : pick(memberships);
    const email = normEmail(u.email);
    out.push({
      ref: `user:${u.id}`, userId: u.id, name: u.name, email, language: u.language === "es" ? "es" : "en", locationIds: shops,
      skip: !u.active ? "inactive" : !row.active ? "recipient_disabled" : !email ? "no_email" : shops.length === 0 ? "no_locations" : null,
      allShops: all.length > 0 && shops.length === all.length, external: false, sections, formats,
    });
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

// ── Raw inputs (what lib/report-package.ts loads) ───────────────────────────────────────────

export interface CashRaw {
  id: string; location_id: string; report_date: string; projected_cents: number; drawer_total_cents: number; float_cents: number;
  deposit_cents: number; over_short_cents: number; cash_tips_cents: number; count_method: string; closer: string | null; signed_at: string;
}
export interface LeadRaw {
  id: string; location_id: string | null; event_date: string; stage: string; lead_source: string | null; external_ref: string | null;
  contact_name: string | null; company: string | null; headcount: number | null; estimated_revenue_cents: number | null;
}
export interface QuoteRaw {
  id: string; pipeline_id: string; version: number; subtotal_cents: number; delivery_fee_cents: number; service_charge_cents: number;
  gratuity_cents: number; tax_cents: number; total_cents: number; deposit_cents: number;
}
export interface PaymentRaw { quote_id: string; status: string; provider: string | null; amount_cents: number }
export interface DeliveryRaw {
  id: string; location_id: string; delivery_date: string; vendor_name: string; source_kind: "vendor" | "store";
  invoice_number: string | null; invoice_total: number | null; match_state: string; delivery_status: string;
  receipt_url: string | null; received_by: string | null; po_code: string | null;
}
export interface DeliveryLineRaw { delivery_id: string; qty_received: number; unit_price: number | null }
export interface CreditRaw {
  id: string; location_id: string; delivery_id: string | null; vendor_name: string; source_kind: "vendor" | "store";
  amount_cents: number | null; status: string; created_day: string;
}
export interface WasteRaw {
  location_id: string; business_date: string; item: string; category: string | null; tossed_qty: number; par_unit: string | null;
  tossed_at: string | null; tossed_by: string | null; source: string;
  /** Cost of ONE par unit of the item in dollars (complete rollup only), else null + the reason. */
  unit_cost: number | null; cost_status: string;
}
export interface InventoryEventRaw { id: string; location_id: string; counted_at: string; counted_day: string; counted_by: string | null }
export interface InventoryLineRaw {
  count_event_id: string; sku_id: string; sku: string; level_label: string; qty: number; resolved_oz: number;
  /** Dollars per oz (current price ÷ content oz), null when unpriced or no pack basis. */
  cost_per_oz: number | null;
}

export interface PackageInput {
  shops: readonly ShopRef[];
  from: string;
  to: string;
  cash: readonly CashRaw[];
  leads: readonly LeadRaw[];
  quotes: readonly QuoteRaw[];
  payments: readonly PaymentRaw[];
  deliveries: readonly DeliveryRaw[];
  deliveryLines: readonly DeliveryLineRaw[];
  credits: readonly CreditRaw[];
  waste: readonly WasteRaw[];
  inventoryEvents: readonly InventoryEventRaw[];
  inventoryLines: readonly InventoryLineRaw[];
  /** Absolute app base URL for detail links (they require a login: a link never grants access). */
  baseUrl: string;
}

// ── Section builders ────────────────────────────────────────────────────────────────────────

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
const shopCells = (shop: ShopRef | undefined): ExportRow => ({ location_code: shop?.code ?? "", location_name: shop?.name ?? "" });
const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Sales: one not_yet_available row per shop per day — every money cell empty, never zero (Q7). */
export function salesSection(input: PackageInput): ExportRow[] {
  return eachDay(input.from, input.to).flatMap((day) => input.shops.map((s) => ({ business_date: day, ...shopCells(s), status: NOT_YET_AVAILABLE })));
}

/** Cash: the live (non-superseded) report per shop per day; paid-ins/outs are not captured yet. */
export function cashSection(input: PackageInput): ExportRow[] {
  const shops = new Map(input.shops.map((s) => [s.id, s]));
  return [...input.cash].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.location_id.localeCompare(b.location_id)).map((c) => ({
    business_date: c.report_date, ...shopCells(shops.get(c.location_id)), report_id: c.id, projected: c.projected_cents,
    drawer_total: c.drawer_total_cents, float: c.float_cents, deposit: c.deposit_cents, over_short: c.over_short_cents,
    cash_tips: c.cash_tips_cents, count_method: c.count_method, paid_ins: null, paid_outs: null,
    paid_ins_outs_status: NOT_YET_AVAILABLE, closer: c.closer, signed_at: c.signed_at, payment_type: "cash",
  }));
}

const PLATFORM_SOURCES = ["ezcater", "toast_catering"];

/**
 * Catering, per event (0195 money split): stage completed = earned, confirmed/out = to earn; lost
 * never enters money and is not listed. The value is the live accepted quote total, else the
 * lead's estimated_revenue_cents (the platform actual for ezCater/Toast orders).
 *   paid_* — catering_payments with status paid, split by provider (stripe | everything else);
 *   paid_platform — an ezCater/Toast order with no app quote is paid on the platform at order time;
 *   outstanding = quote total − paid_total (never below 0); 0 for platform orders; empty when
 *   there is no quote (an estimate has no balance).
 */
export function cateringSection(input: PackageInput): ExportRow[] {
  const shops = new Map(input.shops.map((s) => [s.id, s]));
  const quoteByLead = new Map<string, QuoteRaw>();
  for (const q of input.quotes) {
    const prev = quoteByLead.get(q.pipeline_id);
    if (!prev || q.version > prev.version) quoteByLead.set(q.pipeline_id, q);
  }
  const rows: ExportRow[] = [];
  const leads = input.leads.filter((l) => moneyStatus(l.stage) !== "none" && l.event_date >= input.from && l.event_date <= input.to)
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id.localeCompare(b.id));
  for (const l of leads) {
    const q = quoteByLead.get(l.id);
    const pays = q ? input.payments.filter((p) => p.quote_id === q.id) : [];
    const paid = pays.filter((p) => p.status === "paid");
    const paidStripe = sum(paid.filter((p) => p.provider === "stripe").map((p) => p.amount_cents));
    const paidManual = sum(paid.filter((p) => p.provider !== "stripe").map((p) => p.amount_cents));
    const refunded = sum(pays.filter((p) => p.status === "refunded").map((p) => p.amount_cents));
    const platform = !q && PLATFORM_SOURCES.includes(l.lead_source ?? "");
    const value = q?.total_cents ?? l.estimated_revenue_cents ?? null;
    const paidPlatform = platform ? value : null;
    const paidTotal = paidStripe + paidManual + (paidPlatform ?? 0);
    const types = [...new Set([
      ...paid.map((p) => p.provider === "stripe" ? "stripe" : (p.provider ?? "manual")),
      ...(platform ? [l.lead_source!] : []),
    ])];
    rows.push({
      business_date: l.event_date, ...shopCells(l.location_id ? shops.get(l.location_id) : undefined), lead_id: l.id,
      external_ref: l.external_ref, lead_source: l.lead_source, stage: l.stage, money_status: moneyStatus(l.stage),
      customer: l.company ? `${l.company}${l.contact_name ? ` (${l.contact_name})` : ""}` : l.contact_name, headcount: l.headcount,
      quote_id: q?.id ?? null, quote_version: q?.version ?? null, subtotal: q?.subtotal_cents ?? null, delivery_fee: q?.delivery_fee_cents ?? null,
      service_charge: q?.service_charge_cents ?? null, gratuity: q?.gratuity_cents ?? null, tax: q?.tax_cents ?? null,
      total: q?.total_cents ?? null, deposit: q?.deposit_cents ?? null, value, value_basis: q ? "accepted_quote" : "estimated_revenue",
      paid_total: paidTotal, paid_stripe: paidStripe, paid_manual: paidManual, paid_platform: paidPlatform, refunded,
      outstanding: q ? Math.max(0, q.total_cents - (paidStripe + paidManual)) : platform ? 0 : null,
      payment_type: types.length === 0 ? "none" : types.length === 1 ? types[0] : "mixed",
    });
  }
  return rows;
}

/** Purchases: every delivery AND store run (vendors.source_kind='store'), with its credits; plus credits filed with no delivery. */
export function purchasesSection(input: PackageInput): ExportRow[] {
  const shops = new Map(input.shops.map((s) => [s.id, s]));
  const rows: ExportRow[] = [];
  for (const d of [...input.deliveries].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.id.localeCompare(b.id))) {
    const lines = input.deliveryLines.filter((l) => l.delivery_id === d.id);
    const priced = lines.filter((l) => l.unit_price !== null);
    const credits = input.credits.filter((c) => c.delivery_id === d.id);
    rows.push({
      business_date: d.delivery_date, ...shopCells(shops.get(d.location_id)), kind: d.source_kind === "store" ? "store_run" : "vendor",
      delivery_id: d.id, vendor_or_store: d.vendor_name, invoice_number: d.invoice_number, invoice_total: dollarsToCents(d.invoice_total),
      line_count: lines.length, priced_line_count: priced.length,
      lines_total: priced.length ? Math.round(sum(priced.map((l) => l.qty_received * (l.unit_price ?? 0))) * 100) : null,
      has_receipt_photo: !!d.receipt_url, detail_link: `${input.baseUrl}/operations/receiving/${d.id}`, po_code: d.po_code,
      match_state: d.match_state, delivery_status: d.delivery_status, received_by: d.received_by,
      credit_count: credits.length, credit_amount: credits.length ? sum(credits.map((c) => c.amount_cents)) : null,
      credit_status: [...new Set(credits.map((c) => c.status))].sort().join("; ") || null,
    });
  }
  for (const c of input.credits.filter((x) => !x.delivery_id).sort((a, b) => a.created_day.localeCompare(b.created_day) || a.id.localeCompare(b.id))) {
    rows.push({
      business_date: c.created_day, ...shopCells(shops.get(c.location_id)), kind: "credit", delivery_id: null,
      vendor_or_store: c.vendor_name, credit_count: 1, credit_amount: c.amount_cents, credit_status: c.status,
    });
  }
  return rows;
}

/** Waste: each toss × the cost of one par unit of the item (complete rollup only; else empty + why). */
export function wasteSection(input: PackageInput): ExportRow[] {
  const shops = new Map(input.shops.map((s) => [s.id, s]));
  return [...input.waste].sort((a, b) => a.business_date.localeCompare(b.business_date) || (a.tossed_at ?? "").localeCompare(b.tossed_at ?? "")).map((w) => ({
    business_date: w.business_date, ...shopCells(shops.get(w.location_id)), item: w.item, category: w.category, tossed_qty: w.tossed_qty,
    par_unit: w.par_unit, tossed_at: w.tossed_at, tossed_by: w.tossed_by, source: w.source,
    unit_cost: dollarsToCents(w.unit_cost), est_cost: w.unit_cost === null ? null : Math.round(w.unit_cost * w.tossed_qty * 100),
    cost_status: w.cost_status,
  }));
}

/** Inventory value at each physical count: one row per count line plus one event_total row per count. */
export function inventorySection(input: PackageInput): ExportRow[] {
  const shops = new Map(input.shops.map((s) => [s.id, s]));
  const rows: ExportRow[] = [];
  for (const e of [...input.inventoryEvents].sort((a, b) => a.counted_at.localeCompare(b.counted_at))) {
    const base = { business_date: e.counted_day, ...shopCells(shops.get(e.location_id)), count_event_id: e.id, counted_at: e.counted_at, counted_by: e.counted_by };
    const lines = input.inventoryLines.filter((l) => l.count_event_id === e.id).sort((a, b) => a.sku.localeCompare(b.sku));
    let total = 0;
    let unpriced = 0;
    for (const l of lines) {
      const value = l.cost_per_oz === null ? null : Math.round(l.cost_per_oz * l.resolved_oz * 100);
      if (value === null) unpriced++; else total += value;
      rows.push({
        ...base, row_type: "line", sku_id: l.sku_id, sku: l.sku, level_label: l.level_label, qty: l.qty, resolved_oz: l.resolved_oz,
        cost_per_oz: l.cost_per_oz, value, cost_status: l.cost_per_oz === null ? "unpriced" : "priced",
      });
    }
    rows.push({ ...base, row_type: "event_total", value: total, cost_status: unpriced === 0 ? "complete" : `partial_${unpriced}_unpriced` });
  }
  return rows;
}

// ── Rollups (weekly + monthly) ──────────────────────────────────────────────────────────────

export function rollupSections(input: PackageInput): Record<RollupSection, ExportRow[]> {
  const period = { period_start: input.from, period_end: input.to };
  const out: Record<RollupSection, ExportRow[]> = {
    rollup_sales_by_tax_category: input.shops.map((s) => ({ ...period, ...shopCells(s), status: NOT_YET_AVAILABLE })),
    rollup_purchases_by_vendor: [], rollup_waste_by_category: [], rollup_cash_variance: [],
  };
  for (const shop of input.shops) {
    // Per shop, from the same section builders, so a rollup can never disagree with its detail.
    const purchases = purchasesSection({
      ...input, deliveries: input.deliveries.filter((d) => d.location_id === shop.id), credits: input.credits.filter((c) => c.location_id === shop.id),
    });
    const waste = wasteSection({ ...input, waste: input.waste.filter((w) => w.location_id === shop.id) });
    const groups = new Map<string, ExportRow[]>();
    for (const r of purchases) {
      const key = `${r.kind === "store_run" ? "store_run" : "vendor"}|${r.vendor_or_store}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [key, rs] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const [kind, vendor] = key.split("|");
      const deliveries = rs.filter((r) => r.kind !== "credit");
      out.rollup_purchases_by_vendor.push({
        ...period, ...shopCells(shop), kind, vendor_or_store: vendor, deliveries: deliveries.length,
        invoice_total: sum(deliveries.map((r) => r.invoice_total as number | null)),
        lines_total: sum(deliveries.map((r) => r.lines_total as number | null)),
        credits_total: sum(rs.map((r) => r.credit_amount as number | null)),
      });
    }
    const cats = new Map<string, ExportRow[]>();
    for (const r of waste) {
      const key = (r.category as string | null) ?? "uncategorized";
      cats.set(key, [...(cats.get(key) ?? []), r]);
    }
    for (const [category, rs] of [...cats].sort(([a], [b]) => a.localeCompare(b))) {
      out.rollup_waste_by_category.push({
        ...period, ...shopCells(shop), category, tosses: rs.length, est_cost: sum(rs.map((r) => r.est_cost as number | null)),
        uncosted_tosses: rs.filter((r) => r.est_cost === null).length,
      });
    }
    const cash = input.cash.filter((c) => c.location_id === shop.id);
    out.rollup_cash_variance.push({
      ...period, ...shopCells(shop), cash_reports: cash.length, deposits: sum(cash.map((c) => c.deposit_cents)),
      over_short_total: sum(cash.map((c) => c.over_short_cents)),
      over_total: sum(cash.map((c) => Math.max(0, c.over_short_cents))),
      short_total: sum(cash.map((c) => Math.min(0, c.over_short_cents))),
      cash_tips: sum(cash.map((c) => c.cash_tips_cents)),
    });
  }
  return out;
}

export interface PackageTable { key: PackageTableKey; columns: readonly ExportColumn[]; rows: ExportRow[] }

/** The tables of one package, in a fixed order: the recipient's sections, then (weekly/monthly) the rollups. */
export function buildPackageTables(input: PackageInput, sections: readonly PackageSection[], cadence: PackageCadence): PackageTable[] {
  const builders: Record<PackageSection, (i: PackageInput) => ExportRow[]> = {
    sales: salesSection, cash: cashSection, catering: cateringSection, purchases: purchasesSection, waste: wasteSection, inventory: inventorySection,
  };
  const tables: PackageTable[] = PACKAGE_SECTIONS.filter((s) => sections.includes(s))
    .map((key) => ({ key, columns: PACKAGE_COLUMNS[key], rows: builders[key](input) }));
  if (cadence !== "daily_close") {
    const rollups = rollupSections(input);
    for (const key of ROLLUP_SECTIONS) tables.push({ key, columns: PACKAGE_COLUMNS[key], rows: rollups[key] });
  }
  return tables;
}

/** Resend's limit is 40 MB per message; we stop well short of it and alert instead (plan: < 10 MB). */
export const PACKAGE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** `{name}_{scope}_{from}_{to}.{ext}` — scope = "all" or the shop codes. */
export function packageFilename(name: string, shops: readonly ShopRef[], allShops: boolean, from: string, to: string, ext: "csv" | "pdf"): string {
  const scope = allShops ? "all" : shops.map((s) => s.code ?? s.id.slice(0, 8)).join("-");
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "all";
  return `${safe(name)}_${safe(scope)}_${from}_${to}.${ext}`;
}

// ── The send seam (types only; the digest engine runs it) ───────────────────────────────────

export interface EmailAttachment { filename: string; content: Buffer; contentType: string }
/** A composed email; packages carry their CSV/PDF files as attachments. */
export type ComposedSend = ComposedEmail & { attachments?: EmailAttachment[] };

/**
 * The accountant / owner package (exports PR). Optional so a digest-only IO (and PR1's tests)
 * runs unchanged. The package rides THIS engine's claim → send → record path, so it shares the
 * idempotency key, the preview/live switch and the never-silent failure alert.
 */
export interface PackageIO {
  /** report_recipients rows with packages (read once per run). */
  recipients(): Promise<PackageRecipientRow[]>;
  compose(r: PackageRecipient, cadence: PackageCadence, day: string, env: Envelope): Promise<ComposedSend>;
  /** One report_package.send audit row per attempt that reached the sender. Never throws. */
  recordSend(entry: { kind: PackageKind; day: string; ref: string; outcome: "sent" | "failed" }): Promise<void>;
}

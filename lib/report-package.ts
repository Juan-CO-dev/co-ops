/**
 * The accountant / owner package — the server I/O (service-role reads, the CSV/PDF files, the
 * email). The pure rules (columns, sections, rollups, periods, recipients) are in
 * lib/report-package-shared.ts; the send rides the digest engine (lib/report-digests-engine.ts
 * Run.packages) so it shares the send log, the idempotency key, the off/preview/live switch and
 * the never-silent failure alert.
 *
 * SCOPE. A package covers exactly the shops its recipient row allows (location_ids, else every
 * shop for an external address or a level ≥ 8 staff user, else their memberships), and only the
 * sections the row lists. Spec: "external emails get files only for the shops/packages configured;
 * links in emails never grant app access without login." The email body carries NO app link; the
 * only links are the purchases detail_link cells, which open a login page for anyone without a
 * session.
 */
import "server-only";
import { audit } from "@/lib/audit";
import { escapeHtml } from "@/lib/email-templates/_layout";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { etCalendarDate } from "@/lib/operational-day";
import { reportTimestampBounds } from "@/lib/report-range";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { TENANT_NAME } from "@/lib/tenant";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph } from "@/lib/admin/menu-costing";
import { rollupItemCost } from "@/lib/menu-costing-shared";
import { loadMeasures, loadRecipeGraph, loadSkuPackChains } from "@/lib/prep-consumption";
import { skuContentOz, skuCostPerOz } from "@/lib/recipe-math";
import { toCsv, type ShopRef } from "@/lib/report-export-shared";
import { pdfHeaderLines, renderReportPdf } from "@/lib/report-pdf";
import {
  PACKAGE_MAX_ATTACHMENT_BYTES,
  buildPackageTables,
  packageFilename,
  packagePeriod,
  type CashRaw,
  type CreditRaw,
  type DeliveryLineRaw,
  type DeliveryRaw,
  type InventoryEventRaw,
  type InventoryLineRaw,
  type LeadRaw,
  type PackageInput,
  type PackageKind,
  type PackageRecipient,
  type PackageRecipientRow,
  type PackageTable,
  type PaymentRaw,
  type QuoteRaw,
  type WasteRaw,
  type ComposedSend,
  type EmailAttachment,
  type PackageIO,
} from "@/lib/report-package-shared";
import type { PackageCadence, PackageSection } from "@/lib/report-recipients-shared";
import type { Envelope } from "@/lib/report-digests-compose";

type Sb = ReturnType<typeof getServiceRoleClient>;

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

/** `.in()` in chunks: an unbounded id list in the request line is a 414 (AGENTS.md, DELIVERY_AT_LOCATION_EMBED). */
async function inChunks<T>(ids: readonly string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) out.push(...await load(unique.slice(i, i + 100)));
  return out;
}

/**
 * Child rows for a parent id list: chunked (the request line stays bounded) AND paginated inside
 * each chunk with a total order on id (the response stays complete past PostgREST's 1,000-row cap).
 */
export async function childRows<T>(
  sb: Sb, table: string, select: string, column: string, ids: readonly string[],
  filter?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T[]> {
  return inChunks(ids.filter(Boolean), (chunk) => selectAllRows<T>((f, t) => {
    let q = sb.from(table).select(select).in(column, chunk);
    if (filter) q = filter(q);
    // A runtime select string types as GenericStringError; the rows are T by the select above.
    return q.order("id").range(f, t) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  }));
}

async function names(sb: Sb, table: "users" | "vendors" | "purchase_orders" | "vendor_items", ids: readonly string[], column = "name"): Promise<Map<string, string>> {
  const rows = await inChunks(ids.filter(Boolean), async (chunk) => {
    const { data, error } = await sb.from(table).select(`id, ${column}`).in("id", chunk);
    if (error) throw new Error(`package ${table}: ${error.message}`);
    return (data ?? []) as unknown as Array<Record<string, string>>;
  });
  return new Map(rows.map((r) => [r.id!, r[column]!]));
}

export async function loadPackageRecipientRows(sb: Sb): Promise<PackageRecipientRow[]> {
  return selectAllRows<PackageRecipientRow>((from, to) =>
    sb.from("report_recipients").select("id, kind, user_id, email, display_name, active, location_ids, packages, cadence, formats")
      .not("cadence", "is", null).order("id").range(from, to));
}

/**
 * Every raw row the package's sections need, for these shops and this period. Only the sections
 * asked for are read. Each read throws on error: a dropped read would print "nothing" as a fact.
 */
export async function loadPackageInput(sb: Sb, args: {
  locationIds: string[]; includeUnassignedLeads: boolean; from: string; to: string; sections: readonly PackageSection[]; baseUrl: string;
}): Promise<PackageInput> {
  const { locationIds, from, to } = args;
  const want = (s: PackageSection) => args.sections.includes(s);
  const { data: shopRows, error: shopErr } = await sb.from("locations").select("id, code, name").in("id", locationIds).order("name");
  if (shopErr) throw new Error(`package locations: ${shopErr.message}`);
  const shops = (shopRows ?? []) as ShopRef[];
  const bounds = reportTimestampBounds(from, to);
  const input: PackageInput = {
    shops, from, to, cash: [], leads: [], quotes: [], payments: [], deliveries: [], deliveryLines: [], credits: [], waste: [],
    inventoryEvents: [], inventoryLines: [], baseUrl: args.baseUrl,
    // Sales has no source yet; it is "loaded" as the explicit not_yet_available section.
    loaded: want("sales") ? ["sales"] : [],
  };

  if (want("cash")) {
    const rows = await selectAllRows<Record<string, unknown>>((f, t) => sb.from("cash_reports")
      .select("id, location_id, report_date, projected_cents, drawer_total_cents, float_cents, deposit_cents, over_short_cents, cash_tips_cents, count_method, signed_by, signed_at")
      .in("location_id", locationIds).gte("report_date", from).lte("report_date", to).is("superseded_at", null).order("id").range(f, t));
    const who = await names(sb, "users", rows.map((r) => r.signed_by as string));
    input.cash = rows.map((r): CashRaw => ({
      id: r.id as string, location_id: r.location_id as string, report_date: r.report_date as string,
      projected_cents: r.projected_cents as number, drawer_total_cents: r.drawer_total_cents as number, float_cents: r.float_cents as number,
      deposit_cents: r.deposit_cents as number, over_short_cents: r.over_short_cents as number, cash_tips_cents: r.cash_tips_cents as number,
      count_method: r.count_method as string, closer: who.get(r.signed_by as string) ?? null, signed_at: r.signed_at as string,
    }));
    input.loaded.push("cash");
  }

  if (want("catering")) {
    const select = "id, location_id, event_date, stage, lead_source, external_ref, contact_name, company, headcount, estimated_revenue_cents";
    const leads = await selectAllRows<LeadRaw>((f, t) => sb.from("catering_pipeline").select(select)
      .gte("event_date", from).lte("event_date", to).in("stage", ["confirmed", "out", "completed"]).order("id").range(f, t));
    input.leads = leads.filter((l) => (l.location_id ? locationIds.includes(l.location_id) : args.includeUnassignedLeads));
    input.quotes = await childRows<QuoteRaw>(sb, "catering_quotes",
      "id, pipeline_id, version, subtotal_cents, delivery_fee_cents, service_charge_cents, gratuity_cents, tax_cents, total_cents, deposit_cents",
      "pipeline_id", input.leads.map((l) => l.id), (q) => q.eq("status", "accepted").is("superseded_at", null));
    input.payments = await childRows<PaymentRaw>(sb, "catering_payments", "id, quote_id, status, provider, amount_cents", "quote_id", input.quotes.map((q) => q.id));
    input.loaded.push("catering");
  }

  if (want("purchases")) {
    const rows = await selectAllRows<Record<string, unknown>>((f, t) => sb.from("vendor_deliveries")
      .select("id, location_id, vendor_id, delivery_date, invoice_number, invoice_total, match_state, delivery_status, receipt_url, received_by, purchase_order_id")
      .in("location_id", locationIds).gte("delivery_date", from).lte("delivery_date", to).order("id").range(f, t));
    // Credits are their OWN ledger rows, dated by when they were filed (Astra P2): every credit filed
    // in the period, linked to a delivery or not, keeping its delivery reference. A credit is never
    // folded into its delivery's row, so it appears in exactly one period and is never counted twice.
    const credits = await selectAllRows<Record<string, unknown>>((f, t) => sb.from("vendor_credits")
      .select("id, location_id, vendor_id, delivery_id, reason, amount_cents, status, created_at")
      .in("location_id", locationIds).gte("created_at", bounds.start).lt("created_at", bounds.end).order("id").range(f, t));
    const deliveryIds = rows.map((r) => r.id as string);
    // Children are PAGINATED inside each id chunk (Astra P1): 100 deliveries × 11 lines is past
    // PostgREST's 1,000-row cap, and an unpaginated read would silently drop lines and dollars.
    const lines = await childRows<{ id: string; delivery_id: string; vendor_item_id: string; qty_received: number | string; unit_price: number | string | null; received_level_label: string | null }>(
      sb, "vendor_delivery_items", "id, delivery_id, vendor_item_id, qty_received, unit_price, received_level_label", "delivery_id", deliveryIds);
    const creditDeliveryIds = credits.map((c) => c.delivery_id as string | null).filter((x): x is string => !!x);
    const vendorIds = [...rows.map((r) => r.vendor_id as string), ...credits.map((c) => c.vendor_id as string)];
    const [vendors, skus, creditDeliveries] = await Promise.all([
      inChunks(vendorIds, async (chunk) => {
        const { data, error } = await sb.from("vendors").select("id, name, source_kind").in("id", chunk);
        if (error) throw new Error(`package vendors: ${error.message}`);
        return (data ?? []) as Array<{ id: string; name: string; source_kind: "vendor" | "store" }>;
      }),
      names(sb, "vendor_items", lines.map((l) => l.vendor_item_id)),
      inChunks(creditDeliveryIds, async (chunk) => {
        const { data, error } = await sb.from("vendor_deliveries").select("id, delivery_date").in("id", chunk);
        if (error) throw new Error(`package credit deliveries: ${error.message}`);
        return (data ?? []) as Array<{ id: string; delivery_date: string }>;
      }),
    ]);
    const vendor = new Map(vendors.map((v) => [v.id, v]));
    const creditDeliveryDate = new Map(creditDeliveries.map((d) => [d.id, d.delivery_date]));
    const [who, po] = await Promise.all([
      names(sb, "users", rows.map((r) => r.received_by as string)),
      names(sb, "purchase_orders", rows.map((r) => r.purchase_order_id as string), "display_code"),
    ]);
    input.deliveries = rows.map((r): DeliveryRaw => ({
      id: r.id as string, location_id: r.location_id as string, delivery_date: r.delivery_date as string,
      vendor_name: vendor.get(r.vendor_id as string)?.name ?? "(vendor)", source_kind: vendor.get(r.vendor_id as string)?.source_kind ?? "vendor",
      invoice_number: (r.invoice_number as string | null) ?? null, invoice_total: num(r.invoice_total as number | string | null),
      match_state: r.match_state as string, delivery_status: r.delivery_status as string, receipt_url: (r.receipt_url as string | null) ?? null,
      received_by: who.get(r.received_by as string) ?? null, po_code: po.get(r.purchase_order_id as string) ?? null,
    }));
    input.deliveryLines = lines.map((l): DeliveryLineRaw => ({
      id: l.id, delivery_id: l.delivery_id, sku_id: l.vendor_item_id, sku: skus.get(l.vendor_item_id) ?? "(sku)",
      unit: l.received_level_label, qty_received: num(l.qty_received) ?? 0, unit_price: num(l.unit_price),
    }));
    input.credits = credits.map((c): CreditRaw => ({
      id: c.id as string, location_id: c.location_id as string, delivery_id: (c.delivery_id as string | null) ?? null,
      delivery_date: c.delivery_id ? (creditDeliveryDate.get(c.delivery_id as string) ?? null) : null,
      vendor_name: vendor.get(c.vendor_id as string)?.name ?? "(vendor)", source_kind: vendor.get(c.vendor_id as string)?.source_kind ?? "vendor",
      reason: (c.reason as string | null) ?? null,
      amount_cents: (c.amount_cents as number | null) ?? null, status: c.status as string, created_day: etCalendarDate(c.created_at as string),
    }));
    input.loaded.push("purchases");
  }

  if (want("waste")) {
    const rows = await selectAllRows<Record<string, unknown>>((f, t) => sb.from("prep_batch_sessions")
      .select("location_id, item_id, business_date, source, tossed_qty, tossed_par_unit, tossed_at, tossed_by")
      .in("location_id", locationIds).gte("business_date", from).lte("business_date", to).gt("tossed_qty", 0)
      .order("instance_id").order("template_item_id").range(f, t));
    if (rows.length > 0) {
      const itemIds = [...new Set(rows.map((r) => r.item_id as string))];
      const [items, who, graph] = await Promise.all([
        inChunks(itemIds, async (chunk) => {
          const { data, error } = await sb.from("items").select("id, name, section, default_par_unit").in("id", chunk);
          if (error) throw new Error(`package items: ${error.message}`);
          return (data ?? []) as Array<{ id: string; name: string; section: string | null; default_par_unit: string | null }>;
        }),
        names(sb, "users", rows.map((r) => r.tossed_by as string)),
        loadRecipeGraph(),
      ]);
      const costPerOz = costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()]));
      const item = new Map(items.map((i) => [i.id, i]));
      input.waste = rows.map((r): WasteRaw => {
        const it = item.get(r.item_id as string);
        const rollup = rollupItemCost(graph, r.item_id as string, costPerOz);
        const unit = (r.tossed_par_unit as string | null) ?? null;
        // rollupItemCost prices ONE par unit of the item; a toss counted in another unit has no honest price.
        const sameUnit = !unit || !it?.default_par_unit || unit.trim().toLowerCase() === it.default_par_unit.trim().toLowerCase();
        const costed = rollup.status === "costed" && rollup.cost !== null && sameUnit;
        return {
          location_id: r.location_id as string, business_date: r.business_date as string, item: it?.name ?? "(item)", category: it?.section ?? null,
          tossed_qty: num(r.tossed_qty as number | string) ?? 0, par_unit: unit, tossed_at: (r.tossed_at as string | null) ?? null,
          tossed_by: who.get(r.tossed_by as string) ?? null, source: r.source as string,
          unit_cost: costed ? rollup.cost : null, cost_status: costed ? "costed" : sameUnit ? rollup.status : "unit_mismatch",
        };
      });
    }
    input.loaded.push("waste");
  }

  if (want("inventory")) {
    const events = await selectAllRows<{ id: string; location_id: string; counted_at: string; counted_by: string | null }>((f, t) => sb.from("sku_count_events")
      .select("id, location_id, counted_at, counted_by").in("location_id", locationIds).eq("active", true)
      .gte("counted_at", bounds.start).lt("counted_at", bounds.end).order("id").range(f, t));
    if (events.length > 0) {
      const lines = await inChunks(events.map((e) => e.id), (chunk) => selectAllRows<Record<string, unknown>>((f, t) => sb.from("sku_count_lines")
        .select("count_event_id, sku_id, level_label, qty, resolved_oz").in("count_event_id", chunk).order("id").range(f, t)));
      const skuIds = [...new Set(lines.map((l) => l.sku_id as string))];
      const [skus, chains, measures, prices, who] = await Promise.all([
        inChunks(skuIds, async (chunk) => {
          const { data, error } = await sb.from("vendor_items").select("id, name, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", chunk);
          if (error) throw new Error(`package skus: ${error.message}`);
          return (data ?? []) as Array<{ id: string; name: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>;
        }),
        loadSkuPackChains(skuIds),
        loadMeasures(),
        loadCurrentSkuPrices(skuIds),
        names(sb, "users", events.map((e) => e.counted_by ?? "")),
      ]);
      // The same derivation the costing board uses: current price ÷ chain-aware content oz.
      const sku = new Map(skus.map((s) => [s.id, {
        name: s.name,
        costPerOz: skuCostPerOz(prices.get(s.id) ?? null, skuContentOz({
          unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each),
          packChain: chains.get(s.id) ?? null,
        }, measures)),
      }]));
      input.inventoryEvents = events.map((e): InventoryEventRaw => ({
        id: e.id, location_id: e.location_id, counted_at: e.counted_at, counted_day: etCalendarDate(e.counted_at), counted_by: e.counted_by ? (who.get(e.counted_by) ?? null) : null,
      }));
      input.inventoryLines = lines.map((l): InventoryLineRaw => ({
        count_event_id: l.count_event_id as string, sku_id: l.sku_id as string, sku: sku.get(l.sku_id as string)?.name ?? "(sku)",
        level_label: l.level_label as string, qty: num(l.qty as number | string) ?? 0, resolved_oz: num(l.resolved_oz as number | string) ?? 0,
        cost_per_oz: sku.get(l.sku_id as string)?.costPerOz ?? null,
      }));
    }
    input.loaded.push("inventory");
  }
  return input;
}

const SECTION_KEY: Record<PackageTable["key"], TranslationKey> = {
  sales: "reportPackage.section.sales",
  cash: "reportPackage.section.cash",
  catering: "reportPackage.section.catering",
  purchases: "reportPackage.section.purchases",
  waste: "reportPackage.section.waste",
  inventory: "reportPackage.section.inventory",
  rollup_sales_by_tax_category: "reportPackage.section.rollup_sales_by_tax_category",
  rollup_purchases_by_vendor: "reportPackage.section.rollup_purchases_by_vendor",
  rollup_waste_by_category: "reportPackage.section.rollup_waste_by_category",
  rollup_cash_variance: "reportPackage.section.rollup_cash_variance",
};
const CADENCE_KEY: Record<PackageCadence, TranslationKey> = {
  daily_close: "reportPackage.cadence.daily_close",
  weekly_mon: "reportPackage.cadence.weekly_mon",
  monthly_1st: "reportPackage.cadence.monthly_1st",
};

/** The files: one CSV per table (when csv is a format) and one PDF with every table (when pdf is). */
export async function renderPackageFiles(args: {
  tables: PackageTable[]; recipient: Pick<PackageRecipient, "formats" | "language" | "allShops" | "name">;
  shops: readonly ShopRef[]; from: string; to: string; cadence: PackageCadence; at: Date;
  /** Tests read the uncompressed content stream. */
  compress?: boolean;
}): Promise<EmailAttachment[]> {
  const { tables, recipient, shops, from, to } = args;
  const t = (key: TranslationKey, values?: Record<string, string | number>) => serverT(recipient.language, key, values);
  const files: EmailAttachment[] = [];
  if (recipient.formats.includes("csv")) {
    for (const table of tables) {
      files.push({ filename: packageFilename(table.key, shops, recipient.allShops, from, to, "csv"), content: Buffer.from(toCsv(table.columns, table.rows), "utf8"), contentType: "text/csv; charset=utf-8" });
    }
  }
  if (recipient.formats.includes("pdf")) {
    const shopLabel = recipient.allShops ? t("reports.export.header.all_shops") : shops.map((s) => s.name).join(", ");
    const pdf = await renderReportPdf(
      { title: t("reportPackage.pdf_title", { cadence: t(CADENCE_KEY[args.cadence]) }), lines: pdfHeaderLines(recipient.language, { shop: shopLabel, from, to, at: args.at, by: t("reportPackage.generated_by") }) },
      tables.map((table) => ({ heading: t(SECTION_KEY[table.key]), columns: table.columns, rows: table.rows, emptyText: t("reports.export.empty") })),
      { pageLabel: (n, total) => t("reports.export.page", { n, total }), partLabel: (i, n) => t("reports.export.part", { i, n }), compress: args.compress },
    );
    files.push({ filename: packageFilename("package", shops, recipient.allShops, from, to, "pdf"), content: pdf, contentType: "application/pdf" });
  }
  return files;
}

/**
 * The email around the files. No app links (externals have no login; spec: links never grant
 * access). Sales says "coming soon", never a number. Over the size cap → throws "too_large", which
 * the engine records as a failed send and alerts on.
 */
export function packageEmail(args: {
  recipient: Pick<PackageRecipient, "language">; cadence: PackageCadence; from: string; to: string; files: EmailAttachment[];
  sections: readonly PackageSection[]; env: Envelope;
}): ComposedSend {
  const t = (key: TranslationKey, values?: Record<string, string | number>) => serverT(args.recipient.language, key, values);
  const bytes = args.files.reduce((a, f) => a + f.content.length, 0);
  if (bytes > PACKAGE_MAX_ATTACHMENT_BYTES) throw new Error(`too_large: ${bytes} bytes of attachments`);
  const range = args.from === args.to ? args.from : t("reports.export.header.range", { from: args.from, to: args.to });
  const subject = `${args.env.previewFor ? `${t("reportPackage.preview_prefix")} ` : ""}${t("reportPackage.subject", { tenant: TENANT_NAME, cadence: t(CADENCE_KEY[args.cadence]), range })}`;
  const lines = [
    t("reportPackage.body.intro", { cadence: t(CADENCE_KEY[args.cadence]), range }),
    t("reportPackage.body.attached", { n: args.files.length }),
    ...args.files.map((f) => `• ${f.filename}`),
    ...(args.sections.includes("sales") ? [t("reportPackage.body.sales_coming")] : []),
    t("reportPackage.body.footer"),
  ];
  const preview = args.env.previewFor ? t("reportPackage.preview_banner", { name: args.env.previewFor.name, email: args.env.previewFor.email ?? "-" }) : null;
  const text = [...(preview ? [preview, ""] : []), ...lines].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">`
    + (preview ? `<p style="background:#FFF3D4;padding:8px;border-radius:6px"><strong>${escapeHtml(preview)}</strong></p>` : "")
    + `<p><strong>${escapeHtml(TENANT_NAME)}</strong></p>`
    + lines.map((l) => `<p style="margin:4px 0">${escapeHtml(l)}</p>`).join("")
    + `</div>`;
  return { subject, html, text, attachments: args.files };
}

/** The PackageIO the digest engine runs packages through. */
export function packageIO(sb: Sb, now: Date): PackageIO {
  return {
    recipients: () => loadPackageRecipientRows(sb),
    async compose(r, cadence, day, env) {
      const { from, to } = packagePeriod(cadence, day);
      const input = await loadPackageInput(sb, { locationIds: r.locationIds, includeUnassignedLeads: r.allShops, from, to, sections: r.sections, baseUrl: env.baseUrl });
      const tables = buildPackageTables(input, r.sections, cadence);
      const files = await renderPackageFiles({ tables, recipient: r, shops: input.shops, from, to, cadence, at: now });
      return packageEmail({ recipient: r, cadence, from, to, files, sections: r.sections, env });
    },
    async recordSend(entry: { kind: PackageKind; day: string; ref: string; outcome: "sent" | "failed" | "ambiguous" }) {
      await audit({
        actorId: null, actorRole: null, action: "report_package.send", resourceTable: "report_digest_sends", resourceId: null,
        metadata: { kind: entry.kind, business_day: entry.day, recipient_ref: entry.ref, outcome: entry.outcome },
        ipAddress: null, userAgent: null,
      });
    },
  };
}

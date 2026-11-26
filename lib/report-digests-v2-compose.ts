/**
 * Digest v2 — the PURE composer for the management sections (facts → lines; zero I/O). Every line
 * carries a deep link; every empty state is an explicit line ("No POs placed", "No deliveries");
 * every unknown says so ("not yet available", "could not load"), never zero.
 * Section order (GO 2026-10-08): headline · ordering · receiving · inventory · operations ·
 * sales detail · people · tomorrow (D+1). The catering money lives in the headline; the 07:00
 * catering morning digest stays the catering section.
 */
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatDateLabel, formatHourRange, formatTime } from "@/lib/i18n/format";
import { SALES_EMPTY_KEY, serverRef, type SalesView } from "@/lib/sales-reports-shared";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { timeWindowLabel, timeWindowMinutes } from "@/lib/midshift-shared";
import {
  allShopTotals,
  amountAllUnknown,
  busiestHours,
  cateringVsWalkIn,
  deliveryPlatforms,
  topServers,
  salesDeltaPct,
  type Coverage,
  sumKnown,
  type Loaded,
  type MoneyPart,
  type ShopV2Facts,
} from "@/lib/report-digests-v2-shared";
import { etWallTime } from "@/lib/report-digests-shared";
import { toastRingLines } from "@/lib/report-digests-toast-shared";
import { cutoffMinutes } from "@/lib/vendor-rhythm-shared";
import type { DigestLine, DigestSection, DigestTone } from "@/lib/report-digests-compose";
import { digestLink, type DigestTarget, type LinkViewer } from "@/lib/report-digests-links";
import { digestCan, type DigestAccess, type DigestCapability } from "@/lib/report-digests-access-shared";
import { capItems, finishSection, finishSections, LINE_ITEMS_MAX, SECTION_CAP_WIDE, type SectionDraft } from "@/lib/report-digests-layout-shared";

type Params = Record<string, string | number>;
export type T = (key: TranslationKey, params?: Params) => string;

export function translator(language: Language): T {
  return (key, params) => serverT(language, key, params);
}

/**
 * The house plural rule (lib/dashboard-status-shared.ts pluralKey): `_one` bakes the literal "1"
 * and `_other` carries {n}. Both keys are literals so TranslationKey still checks them. English
 * and Spanish share the rule (1 → one, everything else → other).
 */
export function plural(t: T, n: number, one: TranslationKey, other: TranslationKey, params: Params = {}): string {
  return n === 1 ? t(one, params) : t(other, { ...params, n });
}

interface Ctx { t: T; language: Language; baseUrl: string; locationId: string; day: string; viewer?: LinkViewer | null }

/** The first target of the chain this recipient can open (lib/report-digests-links.ts), or null. */
const link = (c: Ctx, ...chain: DigestTarget[]): string | null => digestLink({ baseUrl: c.baseUrl, viewer: c.viewer }, ...chain);
const money = (c: Ctx, cents: number) => formatCents(cents, c.language);
/** A bare "HH:MM[:SS]" cutoff → "10:00 AM" (house formatter, ET). */
function cutoffLabel(c: Ctx, time: string): string {
  const mins = cutoffMinutes(time);
  return mins === null ? time : formatTime(etWallTime(c.day, mins).toISOString(), c.language);
}

/**
 * The line every area shows when its read failed or its source is not there. Both are UNKNOWN (digests
 * round 3): a failed read is not an issue and never "All good"; it counts toward `? N not available`.
 */
function notLoaded(c: Ctx, label: string, href: string | null, l: Loaded<unknown>): DigestLine | null {
  if (l.kind === "error") return { label, text: c.t("digest.v2.could_not_load"), tone: "info", href, unknown: true };
  if (l.kind === "unavailable") {
    const key = l.reason === "no_capture" ? "digest.v2.sales.no_capture" : l.reason === "no_labor" || l.reason === "labor_off" || l.reason === "labor_pull_failed" ? "digest.v2.labor.no_entries" : "digest.v2.not_available";
    return { label, text: c.t(key as TranslationKey), tone: "info", href, unknown: true };
  }
  return null;
}

// ── 1. Headline ──────────────────────────────────────────────────────────────────────────────

export function headlineLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const salesHref = link(c, { to: "sales", location: c.locationId, day: c.day }, { to: "mid_shift", location: c.locationId });
  const label = c.t("digest.v2.sales.net_label");
  const lines: DigestLine[] = [];
  const nl = notLoaded(c, label, salesHref, v.sales);
  if (nl) lines.push(nl);
  else if (v.sales.kind === "ok") {
    const { today, lastWeek } = v.sales.value;
    const delta = salesDeltaPct(today, lastWeek);
    const parts = [
      money(c, today.netCents),
      delta === null ? c.t("digest.v2.sales.vs_unavailable")
        : c.t("digest.v2.sales.vs_last_week", { pct: `${delta > 0 ? "+" : ""}${delta}%`, weekday: formatDateLabel(c.day, c.language).split(",")[0]! }),
      plural(c.t, today.checks, "digest.v2.sales.checks_one", "digest.v2.sales.checks_other"),
      today.avgCheckCents === null ? null : c.t("digest.v2.sales.avg_check", { money: money(c, today.avgCheckCents) }),
      today.thirdPartySharePct === null ? null : c.t("digest.v2.sales.third_party", { pct: `${today.thirdPartySharePct}%` }),
      today.configDegraded ? c.t("digest.v2.sales.partial_channels") : null,
    ].filter((x): x is string => x !== null);
    // No completed capture for D-7: the comparison could not be checked (UNKNOWN).
    lines.push({ label, text: parts.join(" · "), tone: "info", href: salesHref, ...(lastWeek === null ? { unknown: true } : {}) });
  }
  const catHref = link(c, { to: "sales_catering", location: c.locationId, day: c.day }, { to: "pipeline" });
  const catLabel = c.t("digest.v2.catering.revenue_label");
  const cl = notLoaded(c, catLabel, catHref, v.catering);
  if (cl) lines.push(cl);
  else if (v.catering.kind === "ok") {
    const d = v.catering.value.day;
    lines.push(d.orders === 0
      ? { label: catLabel, text: c.t("digest.v2.catering.none_today"), tone: "info", href: catHref }
      : {
        label: catLabel, href: catHref, tone: d.confirmedCents > 0 ? "info" : "ok",
        text: `${plural(c.t, d.orders, "digest.v2.catering.orders_one", "digest.v2.catering.orders_other")} · ${c.t("digest.v2.catering.split", { completed: money(c, d.completedCents), confirmed: money(c, d.confirmedCents) })} · ${c.t("digest.v2.catering.not_in_pos")}`,
      });
  }
  return lines;
}

// ── 2. Ordering (day D) ──────────────────────────────────────────────────────────────────────

export function orderingLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const href = link(c, { to: "ordering", location: c.locationId });
  const poHref = (id: string) => link(c, { to: "ordering", location: c.locationId, po: id });
  const nl = notLoaded(c, c.t("digest.v2.ordering.label"), href, v.ordering);
  if (nl) return [nl];
  if (v.ordering.kind !== "ok") return [];
  const { day } = v.ordering.value;
  const lines: DigestLine[] = [];
  const amount = (cents: number | null, unpriced: number) => cents === null ? c.t("digest.v2.ordering.no_prices")
    : unpriced > 0 ? c.t("digest.v2.ordering.partial_price", { money: money(c, cents), n: unpriced }) : money(c, cents);
  if (day.placed.length === 0) lines.push({ label: c.t("digest.v2.ordering.placed_label"), text: c.t("digest.v2.ordering.none_placed"), tone: "info", href });
  else {
    const total = sumKnown(day.placed.map((p) => p.totalCents));
    lines.push({
      label: c.t("digest.v2.ordering.placed_label"), tone: "ok", href,
      text: `${plural(c.t, day.placed.length, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other")} · ${money(c, total.cents)}${total.unknown > 0 ? ` (${c.t("digest.v2.ordering.some_unpriced")})` : ""}`,
    });
    for (const p of day.placed) lines.push({
      label: vendorName(v, p.vendorId), href: poHref(p.id), tone: "ok",
      text: [p.displayCode, amount(p.totalCents, p.unpricedLines), p.placedByName ? c.t("digest.v2.ordering.placed_by", { name: p.placedByName }) : null].filter(Boolean).join(" · "),
    });
  }
  for (const p of day.unsent) lines.push({
    label: vendorName(v, p.vendorId), href: poHref(p.id), tone: "issue",
    text: `${p.displayCode} · ${c.t(p.status === "draft" ? "digest.v2.ordering.draft_not_sent" : "digest.v2.ordering.confirmed_not_sent")}`,
  });
  for (const m of day.missed) lines.push({
    label: m.vendorName, href, tone: "issue",
    text: `${c.t("digest.v2.ordering.missed_cutoff", { time: cutoffLabel(c, m.cutoffTime) })} · ${plural(c.t, m.suggestedLines, "digest.v2.ordering.walk_suggested_one", "digest.v2.ordering.walk_suggested_other")}`,
  });
  // A late order is a to-do (attention); a cutoff nothing can check is UNKNOWN.
  for (const m of day.late) lines.push({ label: m.vendorName, href, tone: "attention", text: c.t("digest.v2.ordering.ordered_late", { time: cutoffLabel(c, m.cutoffTime), code: m.displayCode }) });
  for (const m of day.unverified) lines.push({ label: m.vendorName, href, tone: "info", unknown: true, text: c.t("digest.v2.ordering.cutoff_unverified", { time: cutoffLabel(c, m.cutoffTime) }) });
  if (day.missed.length === 0 && day.unverified.length === 0) {
    lines.push({ label: c.t("digest.v2.ordering.cutoffs_label"), text: c.t("digest.v2.ordering.no_missed"), tone: "ok", href });
  }
  return lines;
}

function vendorName(v: ShopV2Facts, vendorId: string): string {
  return v.ordering.kind === "ok" ? v.ordering.value.vendorNames[vendorId] ?? "—" : "—";
}

// ── 3. Receiving ─────────────────────────────────────────────────────────────────────────────

export function receivingLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const href = link(c, { to: "receiving", location: c.locationId, anchor: "recent" });
  const creditsHref = link(c, { to: "receiving", location: c.locationId, anchor: "credits" });
  // Unlinked vendor invoices wait in the vendor mail inbox (GM / MoO+); everyone else gets receiving.
  const invoicesHref = link(c, { to: "vendor_mail", location: c.locationId }, { to: "receiving", location: c.locationId, anchor: "recent" });
  const nl = notLoaded(c, c.t("digest.family.receiving"), href, v.receiving);
  if (nl) return [nl];
  if (v.receiving.kind !== "ok") return [];
  const r = v.receiving.value;
  const lines: DigestLine[] = [];
  const regular = r.deliveries.filter((d) => d.sourceKind === "vendor");
  if (regular.length === 0) lines.push({ label: c.t("digest.family.receiving"), text: c.t("digest.receiving.none"), tone: "info", href });
  for (const d of regular) {
    const disc = ([["short", d.discrepancies.short], ["over", d.discrepancies.over], ["damaged", d.discrepancies.damaged], ["substitution", d.discrepancies.substitution]] as const)
      .filter(([, n]) => n > 0).map(([k, n]) => c.t(`digest.v2.receiving.${k}` as TranslationKey, { n }));
    const problems = [...disc, ...(d.matchState === "discrepant" && disc.length === 0 ? [c.t("digest.v2.receiving.discrepant")] : []), ...(!d.hasReceipt ? [c.t("digest.v2.receiving.no_receipt")] : [])];
    lines.push({
      label: d.vendorName, href: link(c, { to: "delivery", location: c.locationId, id: d.id }),
      tone: problems.length > 0 ? "issue" : "ok",
      text: [d.cents === null ? c.t("digest.v2.receiving.no_total") : money(c, d.cents), d.poDisplayCode, ...problems].filter(Boolean).join(" · "),
    });
  }
  const credits = sumKnown(r.credits.map((x) => x.amountCents));
  lines.push(r.credits.length === 0
    ? { label: c.t("digest.v2.receiving.credits_label"), text: c.t("digest.v2.receiving.no_credits"), tone: "ok", href: creditsHref }
    : {
      label: c.t("digest.v2.receiving.credits_label"), tone: "issue", href: creditsHref,
      // An unknown credit amount is never $0 (Astra r2 P2).
      text: [
        plural(c.t, r.credits.length, "digest.v2.receiving.credits_one", "digest.v2.receiving.credits_other"),
        credits.unknown === r.credits.length ? c.t("digest.v2.receiving.credit_amount_unknown") : money(c, credits.cents),
        credits.unknown > 0 && credits.unknown < r.credits.length ? plural(c.t, credits.unknown, "digest.v2.totals.unknown_one", "digest.v2.totals.unknown_other") : null,
      ].filter(Boolean).join(" · "),
    });
  lines.push(r.invoicesPendingReview === 0
    ? { label: c.t("digest.v2.receiving.invoices_label"), text: c.t("digest.v2.receiving.no_invoices"), tone: "ok", href: invoicesHref }
    : { label: c.t("digest.v2.receiving.invoices_label"), tone: "issue", href: invoicesHref, text: plural(c.t, r.invoicesPendingReview, "digest.v2.receiving.invoices_one", "digest.v2.receiving.invoices_other") });
  return lines;
}

// ── 4. Inventory ─────────────────────────────────────────────────────────────────────────────

/** At most 5 names inside a line, then "+N" (plan §2.6: `capItems`). */
const names = (xs: Array<{ name: string }>) => capItems(xs.map((x) => x.name));

export function inventoryLines(c: Ctx, v: ShopV2Facts, pendingItems: number): DigestLine[] {
  const countsHref = link(c, { to: "counts", location: c.locationId });
  const orderingHref = link(c, { to: "ordering", location: c.locationId });
  const receivingHref = link(c, { to: "receiving", location: c.locationId, anchor: "recent" });
  const nl = notLoaded(c, c.t("digest.v2.inventory.label"), countsHref, v.inventory);
  if (nl) return [nl];
  if (v.inventory.kind !== "ok") return [];
  const inv = v.inventory.value;
  const lines: DigestLine[] = [];
  const walkLabel = c.t("digest.v2.inventory.walk_label");
  if (inv.walk === null) lines.push({ label: walkLabel, text: c.t("digest.v2.inventory.no_walk"), tone: "info", href: orderingHref });
  else {
    lines.push(inv.walk.out.length > 0
      ? { label: c.t("digest.v2.inventory.out_label"), tone: "issue", href: orderingHref, text: `${plural(c.t, inv.walk.out.length, "digest.v2.inventory.out_one", "digest.v2.inventory.out_other")}: ${names(inv.walk.out)}` }
      : { label: c.t("digest.v2.inventory.out_label"), tone: "ok", href: orderingHref, text: c.t("digest.v2.inventory.none_out") });
    lines.push(inv.walk.belowPar.length > 0
      ? { label: walkLabel, tone: "info", href: orderingHref, text: `${plural(c.t, inv.walk.belowPar.length, "digest.v2.inventory.below_par_one", "digest.v2.inventory.below_par_other")}: ${names(inv.walk.belowPar)}` }
      : { label: walkLabel, tone: "ok", href: orderingHref, text: c.t("digest.v2.inventory.none_below_par") });
  }
  const qty = (n: number) => new Intl.NumberFormat(c.language === "es" ? "es-US" : "en-US", { maximumFractionDigits: 2 }).format(n);
  lines.push(inv.waste.length === 0
    ? { label: c.t("digest.family.tosses"), text: c.t("digest.tosses.none"), tone: "ok", href: countsHref }
    : {
      label: c.t("digest.family.tosses"), tone: "issue", href: countsHref,
      text: `${c.t("digest.v2.inventory.top_tossed", { items: inv.waste.slice(0, 3).map((w) => `${qty(w.qty)}${w.unit ? ` ${w.unit}` : ""} ${w.name}`).join(", ") })} · ${c.t("digest.v2.inventory.waste_cost_unavailable")}`,
    });
  const s = inv.storeRuns;
  lines.push(s.runs === 0
    ? { label: c.t("digest.v2.inventory.store_runs_label"), text: c.t("digest.v2.inventory.no_store_runs"), tone: "info", href: receivingHref }
    : { label: c.t("digest.v2.inventory.store_runs_label"), tone: "info", href: receivingHref, text: `${plural(c.t, s.runs, "digest.v2.inventory.store_runs_one", "digest.v2.inventory.store_runs_other")} · ${money(c, s.cents)}${s.unknownCents > 0 ? ` (${c.t("digest.v2.ordering.some_unpriced")})` : ""}` });
  lines.push(pendingItems > 0
    ? { label: c.t("digest.family.store_runs"), text: plural(c.t, pendingItems, "digest.store_runs.some_one", "digest.store_runs.some_other"), tone: "issue", href: receivingHref }
    : { label: c.t("digest.family.store_runs"), text: c.t("digest.store_runs.none"), tone: "ok", href: receivingHref });
  return lines;
}

// ── 6. Sales detail ──────────────────────────────────────────────────────────────────────────

/**
 * The Sales section. The pulse lines (top items, channel mix, discounts, voids) are EXACTLY what they always
 * were and carry no gate. The Sales-report lines of PR 3 (`salesReportLines`) are interleaved around them and
 * every one of them `needs: "sales_detail"`, so finishSection cuts them before anything is counted: a recipient
 * the Sales page refuses gets this section byte for byte as before PR 3 (lines, status, overflow, issue count).
 *
 * Order (the composer order inside each tier of finishSection's sort, which puts issues, unknowns and to-dos
 * first): the ladder, tips / tax / service, ezCater and total, DELIVERY PLATFORMS, then top items and the channel
 * mix, then busiest hours and catering vs walk-in, then discounts and voids, then the adjustments and servers.
 * Platform dollars sit before the top items (plan §9.2, CC ruling S5), so on a healthy day they print under the
 * cap and the later lines fold into "and N more".
 */
export function salesDetailLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const report = salesReportLines(c, v);
  const pulse = salesPulseLines(c, v);
  // A pulse that did not load is its one "not available" line.
  if (pulse.length < 4) return [...report.head, ...pulse, ...report.mid, ...report.tail];
  // pulse = [top items, channel mix, discounts, voids]; their relative order never changes.
  return [...report.head, ...pulse.slice(0, 2), ...report.mid, ...pulse.slice(2), ...report.tail];
}

function salesPulseLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const salesView = (view: "summary" | "items" | "channels" | "discounts") =>
    link(c, { to: "sales", location: c.locationId, day: c.day, view }, { to: "mid_shift", location: c.locationId });
  const href = salesView("summary");
  const nl = notLoaded(c, c.t("digest.v2.sales.detail_label"), href, v.sales);
  if (nl) return [nl];
  if (v.sales.kind !== "ok") return [];
  const s = v.sales.value.today;
  const lines: DigestLine[] = [];
  lines.push(s.topItems.length === 0
    ? { label: c.t("digest.v2.sales.top_items_label"), text: c.t("digest.v2.sales.no_items"), tone: "info", href: salesView("items") }
    : { label: c.t("digest.v2.sales.top_items_label"), tone: "info", href: salesView("items"), text: `${s.topItems.map((i) => `${i.name} ${i.units}`).join(", ")} · ${c.t("digest.v2.sales.item_dollars_unavailable")}` });
  const channel = (ch: string | null) => c.t(`digest.v2.channel.${ch ?? "unmapped"}` as TranslationKey);
  lines.push(s.channels.length === 0
    ? { label: c.t("digest.v2.sales.channels_label"), text: c.t("digest.v2.sales.no_channels"), tone: "info", href: salesView("channels") }
    : {
      label: c.t("digest.v2.sales.channels_label"), tone: "info", href: salesView("channels"),
      text: s.channels.map((ch) => `${channel(ch.channel)} ${money(c, ch.netCents)}${s.netCents > 0 ? ` (${Math.round((ch.netCents / s.netCents) * 100)}%)` : ""}`).join(", "),
    });
  lines.push(s.discounts.length === 0
    ? { label: c.t("digest.v2.sales.discounts_label"), text: c.t("digest.v2.sales.no_discounts"), tone: "ok", href: salesView("discounts") }
    : { label: c.t("digest.v2.sales.discounts_label"), tone: "info", href: salesView("discounts"), text: capItems(s.discounts.map((d) => `${d.name ?? c.t("digest.v2.sales.unnamed_discount")} ×${d.count} ${money(c, d.cents)}`)) });
  const voided = s.voids.orders + s.voids.checks + s.voids.units;
  lines.push(voided === 0
    ? { label: c.t("digest.v2.sales.voids_label"), text: c.t("digest.v2.sales.no_voids"), tone: "ok", href }
    : {
      label: c.t("digest.v2.sales.voids_label"), tone: "info", href,
      text: [
        s.voids.orders > 0 ? plural(c.t, s.voids.orders, "digest.v2.sales.void_orders_one", "digest.v2.sales.void_orders_other") : null,
        s.voids.checks > 0 ? plural(c.t, s.voids.checks, "digest.v2.sales.void_checks_one", "digest.v2.sales.void_checks_other") : null,
        s.voids.units > 0 ? plural(c.t, s.voids.units, "digest.v2.sales.void_units_one", "digest.v2.sales.void_units_other") : null,
      ].filter(Boolean).join(", "),
    });
  return lines;
}

// ── 6b. Sales report lines (digests round 3, PR 3): every one needs `sales_detail` ───────────

/**
 * The Sales page's server label (components/reports-hub/SalesParts.tsx `serverLabel`), same rule and same keys:
 * the order's server by first name; no name and an online channel = "Online / no server"; no server at all =
 * "No server on the order"; else "not matched" + a 4-character reference. Pinned equal by a parity test.
 */
export function salesServerLabel(t: T, key: string, name: string | null | undefined, online = false): string {
  if (!name?.trim() && online) return t("reports.sales.server.online");
  if (!key) return t("reports.sales.server.none");
  return name && name.trim() ? name : t("reports.sales.server.unmapped", { ref: serverRef(key) });
}

/**
 * The Sales report's figures for D, as digest lines. Each keeps the Sales page's rules: nothing unless the day's
 * capture is complete (one "not available" line, never $0); a missing amount is counted and said ("+ N amounts
 * not recorded") and marks its line unknown; a read that failed or stalled is its own "not available" line and
 * leaves every other line standing. EVERY line here carries `needs: "sales_detail"` — its status contribution and
 * its place in the overflow line go with it when it is cut.
 * `head` prints before the pulse lines (delivery platforms last in it), `mid` after the channel mix, `tail` after
 * the voids.
 */
function salesReportLines(c: Ctx, v: ShopV2Facts): { head: DigestLine[]; mid: DigestLine[]; tail: DigestLine[] } {
  const out: { head: DigestLine[]; mid: DigestLine[]; tail: DigestLine[] } = { head: [], mid: [], tail: [] };
  const d = v.salesDetail;
  if (!d) return out;
  const gated = (line: DigestLine): DigestLine => ({ ...line, needs: "sales_detail" });
  const view = (to?: SalesView) => link(c, { to: "sales", location: c.locationId, day: c.day, ...(to && to !== "summary" ? { view: to } : {}) });
  const summaryHref = view();
  const missing = (n: number) => n > 0 ? plural(c.t, n, "digest.v2.totals.unknown_one", "digest.v2.totals.unknown_other") : null;
  const join = (parts: Array<string | null>, sep = " · ") => parts.filter((x): x is string => x !== null).join(sep);
  const checks = (n: number) => plural(c.t, n, "digest.v2.sales.checks_one", "digest.v2.sales.checks_other");
  const orders = (n: number) => plural(c.t, n, "digest.v2.catering.orders_one", "digest.v2.catering.orders_other");
  /** The inline unknown wording (lowercase, mid-sentence): "amount unknown (2 orders)". Never a $0.00. */
  const amountUnknown = (count: string) => c.t("digest.v2.sales.amount_unknown", { count });
  /** A figure: unknown when every row of it has no amount; else its known $ with its own gap said beside it. */
  const figure = (p: MoneyPart, count: (n: number) => string) => amountAllUnknown(p) ? amountUnknown(count(p.checks))
    : join([money(c, p.cents), missing(p.amountMissing)], " ");
  const label = c.t("digest.v2.sales.report_label");

  // The whole area stands on the day's totals: loaded, and the day fully captured (the Sales page's coverage rule).
  const nl = notLoaded(c, label, summaryHref, d.totals);
  if (nl) { out.head.push(gated(nl)); return out; }
  if (d.totals.kind !== "ok") return out;
  const tot = d.totals.value;
  if (tot.coverage !== "complete") {
    out.head.push(gated({ label, text: c.t("digest.v2.sales.report_not_covered"), tone: "info", href: summaryHref, unknown: true }));
    return out;
  }

  // 1. The ladder: gross − discounts and comps − item voids − sales refunds = Toast net (summarizeSales' own figures).
  const { grossCents: gross, discountsCompsCents: disc, voidsCents: voids, salesRefundsCents: refunds, toastNetCents: net } = tot;
  out.head.push(gross !== null && disc !== null && voids !== null && refunds !== null && net !== null
    ? gated({ label, tone: "info", href: summaryHref, text: c.t("digest.v2.sales.ladder", { gross: money(c, gross), discounts: money(c, disc), voids: money(c, voids), refunds: money(c, refunds), net: money(c, net) }) })
    : gated({
      label, tone: "info", href: summaryHref, unknown: true,
      text: join([
        c.t("digest.v2.sales.net_unavailable"),
        tot.accountingMissing > 0 ? plural(c.t, tot.accountingMissing, "digest.v2.sales.accounting_missing_one", "digest.v2.sales.accounting_missing_other") : null,
        tot.salesRefundMissing > 0 ? plural(c.t, tot.salesRefundMissing, "digest.v2.sales.refund_missing_one", "digest.v2.sales.refund_missing_other") : null,
      ]),
    }));

  // 2. Tips · tax · service charges (one line). An unknown tip or tax amount is counted; service charges are the
  // exact component, null when any check's accounting is missing: then the inline unknown wording, mid-sentence.
  const sc = tot.serviceChargesCents;
  out.head.push(gated({
    label: c.t("digest.v2.sales.tips_tax_label"), tone: "info", href: summaryHref,
    ...(tot.tipMissing + tot.taxMissing > 0 || sc === null ? { unknown: true } : {}),
    text: c.t("digest.v2.sales.tips_tax", {
      tips: join([money(c, tot.tipCents), missing(tot.tipMissing)], " "),
      tax: join([money(c, tot.taxCents), missing(tot.taxMissing)], " "),
      service: sc === null ? c.t("digest.v2.sales.amount_unknown_bare") : money(c, sc),
    }),
  }));

  // 3. ezCater as sales, and the Sales page's total (Toast check totals + ezCater subtotals, before refunds). The
  // ezCater figure carries its OWN missing count (an unpriced order is never a $0 order); the total is unknown only
  // when every check and every order in it is.
  const ez: MoneyPart = { cents: tot.ezcaterCents, checks: tot.ezcaterOrders, amountMissing: tot.ezcaterMissing };
  const toastMissing = tot.amountMissing - tot.ezcaterMissing;
  const totalUnknown = tot.checks + tot.ezcaterOrders > 0 && toastMissing >= tot.checks && tot.ezcaterMissing >= tot.ezcaterOrders;
  out.head.push(gated({
    label: c.t("digest.v2.sales.ezcater_label"), tone: "info", href: summaryHref,
    ...(tot.amountMissing > 0 ? { unknown: true } : {}),
    text: join([
      tot.ezcaterOrders === 0 ? c.t("digest.v2.sales.no_ezcater")
        : amountAllUnknown(ez) ? c.t("digest.v2.sales.ezcater_unknown", { amount: amountUnknown(orders(ez.checks)) })
          : c.t("digest.v2.sales.ezcater", {
            money: money(c, ez.cents),
            orders: ez.amountMissing > 0 ? c.t("digest.v2.sales.with_missing", { count: orders(ez.checks), n: ez.amountMissing }) : orders(ez.checks),
          }),
      c.t("digest.v2.sales.total_before_refunds", {
        money: totalUnknown ? amountUnknown(join([tot.checks > 0 ? checks(tot.checks) : null, tot.ezcaterOrders > 0 ? orders(tot.ezcaterOrders) : null], ", ")) : money(c, tot.totalCents),
      }),
      totalUnknown ? null : missing(tot.amountMissing),
    ]),
  }));

  // 4. Busiest hours: top 3 with $ and checks; a check with no opened time is said apart, never ranked.
  const hoursHref = view("heatmap");
  const hoursLabel = c.t("digest.v2.sales.hours_label");
  const hl = notLoaded(c, hoursLabel, hoursHref, d.hours);
  if (hl) out.mid.push(gated(hl));
  else if (d.hours.kind === "ok") {
    const h = busiestHours(d.hours.value);
    const lost = d.hours.value.reduce((a, r) => a + r.amountMissing, 0);
    out.mid.push(gated(h.top.length === 0 && h.unknown.checks === 0
      ? { label: hoursLabel, text: c.t("digest.v2.sales.no_sales"), tone: "info", href: hoursHref }
      : {
        label: hoursLabel, tone: "info", href: hoursHref, ...(lost > 0 ? { unknown: true } : {}),
        text: join([
          h.top.length === 0 ? null : h.top.map((x) => c.t("digest.v2.sales.hour_item", { hour: formatHourRange(x.hour, c.language), money: money(c, x.cents), checks: checks(x.checks) })).join(", "),
          h.unknown.checks > 0 ? c.t("digest.v2.sales.hour_unknown", { checks: checks(h.unknown.checks), money: money(c, h.unknown.cents) }) : null,
          missing(lost),
        ]),
      }));
  }

  // 5. Delivery platforms with $ (counted third-party delivery sales by provider). In `head`: platform dollars print
  // before the top items (plan §9.2, CC ruling S5); a provider whose every check has no amount is "amount unknown".
  const platformsLabel = c.t("digest.v2.sales.platforms_label");
  const channelsHref = view("channels");
  const pl = notLoaded(c, platformsLabel, channelsHref, d.channels);
  if (pl) out.head.push(gated(pl));
  else if (d.channels.kind === "ok") {
    const rows = deliveryPlatforms(d.channels.value);
    const one = rows.length === 1 ? rows[0] : undefined;
    const href = link(c,
      ...(one ? [{ to: "sales_checks" as const, location: c.locationId, day: c.day, channel: "third_party" as const, provider: one.provider ?? SALES_EMPTY_KEY }] : []),
      { to: "sales_checks", location: c.locationId, day: c.day, channel: "third_party" },
      { to: "sales", location: c.locationId, day: c.day, view: "channels" });
    const lost = rows.reduce((a, r) => a + r.amountMissing, 0);
    // Each provider says its own gap; the gaps of providers folded into "+N" are counted at the end.
    const hiddenLost = rows.slice(LINE_ITEMS_MAX).reduce((a, r) => a + r.amountMissing, 0);
    const item = (r: (typeof rows)[number]) => {
      const name = r.provider?.trim() ? r.provider : c.t("reports.sales.provider.none");
      if (amountAllUnknown(r)) return `${name} ${amountUnknown(checks(r.checks))}`;
      return `${name} ${money(c, r.cents)} (${r.amountMissing > 0 ? c.t("digest.v2.sales.with_missing", { count: checks(r.checks), n: r.amountMissing }) : checks(r.checks)})`;
    };
    out.head.push(gated(rows.length === 0
      ? { label: platformsLabel, text: c.t("digest.v2.sales.no_platforms"), tone: "info", href }
      : { label: platformsLabel, tone: "info", href, ...(lost > 0 ? { unknown: true } : {}), text: join([capItems(rows.map(item)), missing(hiddenLost)]) }));
  }

  // 6. Catering vs walk-in (catering = Toast catering checks + ezCater orders; walk-in = every other counted sale).
  const cateringLabel = c.t("digest.v2.sales.catering_vs_label");
  const cateringHref = link(c, { to: "sales_catering", location: c.locationId, day: c.day });
  const cl = notLoaded(c, cateringLabel, cateringHref, d.channels);
  if (cl) out.mid.push(gated(cl));
  else if (d.channels.kind === "ok") {
    const split = cateringVsWalkIn(d.channels.value);
    const lost = split.catering.amountMissing + split.walkIn.amountMissing;
    out.mid.push(gated(split.catering.checks === 0 && split.walkIn.checks === 0
      ? { label: cateringLabel, text: c.t("digest.v2.sales.no_sales"), tone: "info", href: cateringHref }
      : {
        label: cateringLabel, tone: "info", href: cateringHref, ...(lost > 0 ? { unknown: true } : {}),
        // Each side says its own gap; a side whose every order / check has no amount is "amount unknown (N …)".
        text: c.t("digest.v2.sales.catering_vs", { catering: figure(split.catering, orders), walkin: figure(split.walkIn, checks) }),
      }));
  }

  // 7. Void $, the refunds captured so far ($ and count; the Sales page's "Refunds captured so far", not the
  // ladder's item-sales refunds), excluded checks. A refund that cannot be allocated to item sales (0247's
  // `sales_refund_missing`, which can come with a dated count of 0) is said in the Sales page's words and marks
  // the line unknown: "no refunds" is never printed while one is.
  const excluded = ([
    ["digest.v2.sales.excluded_gift", tot.giftCardChecks], ["digest.v2.sales.excluded_ezcater", tot.ezcaterLinkedChecks],
    ["digest.v2.sales.excluded_void", tot.voidChecks], ["digest.v2.sales.excluded_excess", tot.excessFoodChecks],
  ] as const).filter(([, n]) => n > 0);
  const excludedChecks = excluded.reduce((a, [, n]) => a + n, 0);
  const refundUnknown = tot.salesRefundMissing > 0;
  out.tail.push(gated({
    label: c.t("digest.v2.sales.adjustments_label"), tone: "info", href: summaryHref,
    ...(voids === null || refundUnknown ? { unknown: true } : {}),
    text: join([
      voids === null ? c.t("digest.v2.sales.item_voids_unavailable") : c.t("digest.v2.sales.item_voids", { money: money(c, voids) }),
      tot.refundCount > 0 ? plural(c.t, tot.refundCount, "digest.v2.sales.refunds_one", "digest.v2.sales.refunds_other", { money: money(c, tot.refundCents) })
        : refundUnknown ? null : c.t("digest.v2.sales.no_refunds"),
      refundUnknown ? plural(c.t, tot.salesRefundMissing, "digest.v2.sales.refund_missing_one", "digest.v2.sales.refund_missing_other") : null,
      excludedChecks === 0 ? c.t("digest.v2.sales.no_excluded")
        : plural(c.t, excludedChecks, "digest.v2.sales.excluded_one", "digest.v2.sales.excluded_other", { detail: excluded.map(([k, n]) => c.t(k, { n })).join(", ") }),
    ]),
  }));

  // 8. Servers: the top 3 of the Sales page's servers view, in its order. The gaps are counted across EVERY server
  // row before the top 3 are taken (as the hours line does): a check of unknown amount anywhere could move the
  // ranking, so it marks the line unknown even when its server is ranked below third.
  const serversLabel = c.t("digest.v2.sales.servers_label");
  const serversHref = view("servers");
  const sl = notLoaded(c, serversLabel, serversHref, d.servers);
  if (sl) out.tail.push(gated(sl));
  else if (d.servers.kind === "ok") {
    const lost = d.servers.value.reduce((a, r) => a + r.amountMissing, 0);
    const top = topServers(d.servers.value);
    out.tail.push(gated(top.length === 0
      ? { label: serversLabel, text: c.t("digest.v2.sales.no_sales"), tone: "info", href: serversHref }
      : {
        label: serversLabel, tone: "info", href: serversHref, ...(lost > 0 ? { unknown: true } : {}),
        text: join([top.map((r) => `${salesServerLabel(c.t, r.key, r.label, r.serverOnline)} ${money(c, r.cents)} (${checks(r.checks)})`).join(", "), missing(lost)]),
      }));
  }
  return out;
}

// ── 8. People ────────────────────────────────────────────────────────────────────────────────

export function peopleLines(c: Ctx, v: ShopV2Facts, who: { openedBy: string | null; closedBy: string | null; openingHref: string | null; closingHref: string | null }, pmLine: DigestLine | null): DigestLine[] {
  const lines: DigestLine[] = [
    { label: c.t("digest.v2.people.opened_label"), href: who.openingHref, ...(who.openedBy ? { text: who.openedBy, tone: "info" as const } : { text: c.t("digest.v2.people.no_name"), tone: "info" as const }) },
    { label: c.t("digest.v2.people.closed_label"), href: who.closingHref, ...(who.closedBy ? { text: who.closedBy, tone: "info" as const } : { text: c.t("digest.v2.people.no_name"), tone: "info" as const }) },
  ];
  if (pmLine) lines.push(pmLine);
  const href = link(c, { to: "yield", location: c.locationId });
  const nl = notLoaded(c, c.t("digest.v2.people.retrains_label"), href, v.people);
  if (nl) lines.push(nl);
  else if (v.people.kind === "ok") {
    const r = v.people.value.retrains;
    lines.push(r.assignedToday === 0 && r.open === 0
      ? { label: c.t("digest.v2.people.retrains_label"), text: c.t("digest.v2.people.no_retrains"), tone: "ok", href }
      : { label: c.t("digest.v2.people.retrains_label"), tone: r.open > 0 ? "issue" : "info", href, text: c.t("digest.v2.people.retrains", { assigned: r.assignedToday, open: r.open }) });
  }
  return lines;
}

// ── Tomorrow (D+1) ───────────────────────────────────────────────────────────────────────────

export function tomorrowLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const ordering = link(c, { to: "ordering", location: c.locationId });
  const tomorrowLabel = formatDateLabel(v.lookahead, c.language);
  const lines: DigestLine[] = [];
  const nl = notLoaded(c, c.t("digest.v2.tomorrow.deliveries_label"), ordering, v.ordering);
  if (nl) lines.push(nl);
  else if (v.ordering.kind === "ok") {
    const { deliveries, cutoffsTomorrow } = v.ordering.value;
    const poHref = (id: string) => link(c, { to: "ordering", location: c.locationId, po: id });
    if (deliveries.due.length === 0) lines.push({ label: c.t("digest.v2.tomorrow.deliveries_label"), text: c.t("digest.v2.tomorrow.no_deliveries"), tone: "info", href: ordering });
    for (const d of deliveries.due) lines.push({
      label: d.vendorName, href: poHref(d.po.id), tone: "info",
      text: [c.t("digest.v2.tomorrow.due_on", { date: tomorrowLabel }), d.po.displayCode, d.po.totalCents === null ? c.t("digest.v2.ordering.no_prices") : money(c, d.po.totalCents)].join(" · "),
    });
    for (const d of deliveries.overdue) lines.push({
      label: d.vendorName, href: poHref(d.po.id), tone: "issue",
      text: `${d.po.displayCode} · ${c.t("digest.v2.tomorrow.overdue", { date: formatDateLabel(d.deliveryDay, c.language) })}`,
    });
    if (deliveries.undated.length > 0) lines.push({
      label: c.t("digest.v2.tomorrow.deliveries_label"), href: ordering, tone: "info",
      text: plural(c.t, deliveries.undated.length, "digest.v2.tomorrow.undated_one", "digest.v2.tomorrow.undated_other", { vendors: [...new Set(deliveries.undated.map((u) => u.vendorName))].join(", ") }),
    });
    if (cutoffsTomorrow.length === 0) lines.push({ label: c.t("digest.v2.tomorrow.cutoffs_label"), text: c.t("digest.v2.tomorrow.no_cutoffs"), tone: "info", href: ordering });
    for (const x of cutoffsTomorrow) lines.push({
      // A draft waiting for tomorrow's cutoff is a to-do (send it); no draft at all is an issue.
      label: x.vendorName, href: ordering, tone: x.ordered ? "info" : x.hasDraft ? "attention" : "issue",
      text: `${c.t("digest.v2.tomorrow.cutoff_at", { time: cutoffLabel({ ...c, day: v.lookahead }, x.cutoffTime) })} · ${c.t(x.ordered ? "digest.v2.tomorrow.already_ordered" : x.hasDraft ? "digest.v2.tomorrow.draft_ready" : "digest.v2.tomorrow.no_draft")}`,
    });
  }
  const catHref = link(c, { to: "pipeline" });
  const cl = notLoaded(c, c.t("digest.v2.tomorrow.catering_label"), catHref, v.catering);
  if (cl) lines.push(cl);
  else if (v.catering.kind === "ok") {
    const list = [...v.catering.value.tomorrow].sort((a, b) => timeWindowMinutes(a.timeWindow) - timeWindowMinutes(b.timeWindow));
    if (list.length === 0) lines.push({ label: c.t("digest.v2.tomorrow.catering_label"), text: c.t("digest.v2.tomorrow.no_catering"), tone: "info", href: catHref });
    else {
      const heads = list.map((x) => x.headcount).filter((h): h is number => h !== null);
      const times = list.map((x) => timeWindowLabel(x.timeWindow, c.language) ?? c.t("digest.catering.time_unknown"));
      lines.push({
        label: c.t("digest.v2.tomorrow.catering_label"), href: catHref, tone: "info",
        text: [
          plural(c.t, list.length, "digest.v2.catering.orders_one", "digest.v2.catering.orders_other"),
          heads.length === 0 ? c.t("digest.catering.size_unknown") : plural(c.t, heads.reduce((a, b) => a + b, 0), "digest.catering.size_one", "digest.catering.size_other"),
          times.join(", "),
        ].join(" · "),
      });
    }
  }
  return lines;
}

// ── Labor (Toast time entries, D) ── appended to lib/report-digests-v2-compose.ts ────────────

export function laborLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  // The day-D lines open Team on that same day (digests round 3, plan §3.5).
  const href = link(c, { to: "team", location: c.locationId, day: c.day });
  const label = c.t("digest.v2.labor.label");
  if (!v.labor) return [];
  const nl = notLoaded(c, label, href, v.labor);
  if (nl) return [nl];
  if (v.labor.kind !== "ok") return [];
  const s = v.labor.value;
  const hours = (h: number) => new Intl.NumberFormat(c.language === "es" ? "es-US" : "en-US", { maximumFractionDigits: 1 }).format(h);
  const lines: DigestLine[] = [];
  // "No one clocked in" only when there are NO entries at all — unknown-hour shifts are still shifts.
  if (s.people.length === 0 && s.openEntries === 0 && s.unknownHoursEntries === 0) return [{ label, text: c.t("digest.v2.labor.none"), tone: "info", href }];
  lines.push({
    // Someone still clocked in is a to-do (attention): a punch to close out.
    label, href, tone: s.openEntries > 0 ? "attention" : "info",
    text: [
      c.t("digest.v2.labor.total", { hours: hours(s.totalHours) }),
      s.unknownHoursEntries > 0 ? plural(c.t, s.unknownHoursEntries, "digest.v2.labor.unknown_one", "digest.v2.labor.unknown_other") : null,
      s.unknownHoursEntries > 0 ? c.t("digest.v2.labor.splh_partial")
        : s.salesPerLaborHourCents === null ? c.t("digest.v2.labor.splh_unavailable") : c.t("digest.v2.labor.splh", { money: formatCents(s.salesPerLaborHourCents, c.language) }),
      s.openEntries > 0 ? plural(c.t, s.openEntries, "digest.v2.labor.open_one", "digest.v2.labor.open_other") : null,
    ].filter((x): x is string => x !== null).join(" · "),
  });
  if (s.byJob.length > 0) lines.push({ label: c.t("digest.v2.labor.by_job_label"), href, tone: "info", text: s.byJob.map((j) => `${j.job ?? c.t("digest.v2.labor.no_job")} ${hours(j.hours)} h`).join(", ") });
  if (s.people.length > 0) lines.push({ label: c.t("digest.v2.labor.people_label"), href, tone: "info", text: capItems(s.people.map((p) => `${p.firstName ?? "—"} ${hours(p.hours)} h${p.unknownShifts > 0 ? ` ${plural(c.t, p.unknownShifts, "digest.v2.labor.person_unknown_one", "digest.v2.labor.person_unknown_other")}` : ""}`)) });
  if (!s.dayOvertimeAssessed) {
    lines.push({ label: c.t("digest.v2.labor.overtime_label"), href, tone: "info", text: c.t("digest.v2.labor.overtime_partial"), unknown: true });
    return lines;
  }
  if (!s.weekOvertimeAssessed) {
    // An unknown earlier in the week leaves D's own over-10 h alert standing; only the 40 h figure is withheld.
    const weekPartial = c.t("digest.v2.labor.week_partial");
    lines.push(s.dayOvertime.length === 0
      ? { label: c.t("digest.v2.labor.overtime_label"), href, tone: "info", text: [c.t("digest.v2.labor.no_day_overtime"), weekPartial].join(" · "), unknown: true }
      : {
        // Issue AND unknown: D's alert stands, and the 40 h week still could not be checked.
        label: c.t("digest.v2.labor.overtime_label"), href, tone: "issue", unknown: true,
        text: [s.dayOvertime.map((p) => c.t("digest.v2.labor.over_day", { name: p.firstName ?? "—", hours: hours(p.hours) })).join(", "), weekPartial].join(" · "),
      });
    return lines;
  }
  lines.push(s.dayOvertime.length === 0 && s.weekOvertime.length === 0
    ? { label: c.t("digest.v2.labor.overtime_label"), href, tone: "ok", text: c.t("digest.v2.labor.no_overtime") }
    : {
      label: c.t("digest.v2.labor.overtime_label"), href, tone: "issue",
      text: [
        ...s.dayOvertime.map((p) => c.t("digest.v2.labor.over_day", { name: p.firstName ?? "—", hours: hours(p.hours) })),
        ...s.weekOvertime.map((p) => c.t("digest.v2.labor.over_week", { name: p.firstName ?? "—", hours: hours(p.hours) })),
      ].join(", "),
    });
  return lines;
}

// ── Assembly ─────────────────────────────────────────────────────────────────────────────────

export interface V2Extras {
  /** The Operations lines (report families + cash + tasks) from composeShopLines. */
  operations: DigestLine[];
  pmLine: DigestLine | null;
  pendingItems: number;
  who: { openedBy: string | null; closedBy: string | null; openingHref: string | null; closingHref: string | null };
}

/**
 * The screen each v2 section summarizes, for this recipient (the section's "Open this in the app" link).
 * Exported so the tests pin the section → link map.
 */
export function v2SectionLinks(c: Ctx): Record<"headline" | "ordering" | "receiving" | "inventory" | "operations" | "sales" | "labor" | "people" | "tomorrow" | "to_ring", string | null> {
  const loc = c.locationId;
  return {
    headline: link(c, { to: "sales", location: loc, day: c.day }, { to: "mid_shift", location: loc }),
    ordering: link(c, { to: "ordering", location: loc }),
    receiving: link(c, { to: "receiving", location: loc, anchor: "recent" }),
    inventory: link(c, { to: "counts", location: loc }, { to: "ordering", location: loc }),
    operations: link(c, { to: "reports_list", location: loc, day: c.day }),
    sales: link(c, { to: "sales", location: loc, day: c.day }, { to: "mid_shift", location: loc }),
    labor: link(c, { to: "team", location: loc, day: c.day }),
    people: link(c, { to: "team", location: loc, day: c.day }, { to: "reports_list", location: loc, day: c.day, type: "pm" }),
    tomorrow: link(c, { to: "ordering", location: loc }),
    to_ring: link(c, { to: "pipeline", anchor: "to_ring" }),
  };
}

/**
 * The shop's v2 sections, each FINISHED for this recipient (lib/report-digests-layout-shared.ts: cut →
 * count → cap) against this shop and day. `access` = the recipient's data gates; absent or null = no
 * gated line (fail closed). Sales and labor carry the wide cap.
 */
export function composeV2Sections(args: { shopName: string; locationId: string; day: string; v: ShopV2Facts; extras: V2Extras; prefix: boolean }, language: Language, baseUrl: string, viewer?: LinkViewer | null, access?: DigestAccess | null): DigestSection[] {
  const c: Ctx = { t: translator(language), language, baseUrl, locationId: args.locationId, day: args.day, viewer };
  const title = (key: TranslationKey, params?: Params) => (args.prefix ? `${args.shopName} · ` : "") + c.t(key, params);
  const toRing = toastRingLines(args.v.catering.kind === "ok" ? args.v.catering.value.toRingInToast ?? [] : [], args.locationId, args.v.lookahead, language, baseUrl, viewer);
  const href = v2SectionLinks(c);
  const can = (cap: DigestCapability) => digestCan(access, cap, { locationId: args.locationId, day: args.day });
  const drafts: SectionDraft[] = [
    { title: title("digest.v2.section.headline"), lines: headlineLines(c, args.v), href: href.headline },
    { title: title("digest.v2.section.ordering"), lines: orderingLines(c, args.v), href: href.ordering },
    { title: title("digest.v2.section.receiving"), lines: receivingLines(c, args.v), href: href.receiving },
    { title: title("digest.v2.section.inventory"), lines: inventoryLines(c, args.v, args.extras.pendingItems), href: href.inventory },
    { title: title("digest.v2.section.operations"), lines: args.extras.operations, href: href.operations },
    { title: title("digest.v2.section.sales"), lines: salesDetailLines(c, args.v), href: href.sales, cap: SECTION_CAP_WIDE },
    ...(args.v.labor ? [{ title: title("digest.v2.section.labor"), lines: laborLines(c, args.v), href: href.labor, cap: SECTION_CAP_WIDE }] : []),
    { title: title("digest.v2.section.people"), lines: peopleLines(c, args.v, args.extras.who, args.extras.pmLine), href: href.people },
    { title: title("digest.v2.section.tomorrow", { date: formatDateLabel(args.v.lookahead, language) }), lines: tomorrowLines(c, args.v), href: href.tomorrow },
    // Present only when a line is left for this recipient: finishSection decides from the allowed lines.
    { title: title("digest.catering.to_ring.tomorrow"), lines: toRing, href: href.to_ring },
  ];
  return finishSections(drafts, { t: c.t, can });
}

/**
 * The level-8+ all-shop totals section: "not available" / "partial (n of m shops)", never a false 0.
 * Finished like every section, against "all" shops and the business day; null = every line was cut.
 */
export function allShopsSection(shops: ReadonlyArray<{ v2?: ShopV2Facts }>, language: Language, baseUrl: string, day?: string, viewer?: LinkViewer | null, access?: DigestAccess | null): DigestSection | null {
  const t = translator(language);
  const m = (cents: number) => formatCents(cents, language);
  const tot = allShopTotals(shops.map((s) => s.v2));
  const ctx = { baseUrl, viewer };
  // Every shop for the business day (level 8+: the only recipients of this section).
  const href = day ? digestLink(ctx, { to: "reports_hub", location: "all", day }) : null;
  const salesHref = day ? digestLink(ctx, { to: "sales", location: "all", day }) ?? href : href;
  const cateringHref = day ? digestLink(ctx, { to: "sales_catering", location: "all", day }, { to: "pipeline" }) : digestLink(ctx, { to: "pipeline" });
  const lines: DigestLine[] = [];
  /** null = nothing covered; else the parts plus a "partial" note when some shops are missing. */
  const covered = (cov: Coverage, parts: Array<string | null>): string | null => cov.covered === 0 ? null
    : [...parts, cov.covered < cov.total ? t("digest.v2.totals.partial", { n: cov.covered, total: cov.total }) : null].filter((x): x is string => x !== null).join(" · ");
  const unknown = (n: number) => n > 0 ? plural(t, n, "digest.v2.totals.unknown_one", "digest.v2.totals.unknown_other") : null;
  /** `partial`: some shops are missing (or a comparison could not be made), so the figure is UNKNOWN in part. */
  const push = (label: string, text: string | null, tone: DigestTone, to: string | null = href, partial = false) =>
    lines.push(text === null ? { label, text: t("digest.v2.not_available"), tone: "info", href: to, unknown: true }
      : { label, text, tone, href: to, ...(partial ? { unknown: true } : {}) });
  const isPartial = (cov: Coverage) => cov.covered > 0 && cov.covered < cov.total;

  const s = tot.sales;
  const delta = s.lastWeekCents !== null && s.lastWeekCents > 0 ? Math.round(((s.netCents - s.lastWeekCents) / s.lastWeekCents) * 100) : null;
  push(t("digest.v2.sales.net_label"), covered(s, [
    m(s.netCents),
    delta === null ? t("digest.v2.sales.vs_unavailable") : t("digest.v2.totals.vs_last_week", { pct: `${delta > 0 ? "+" : ""}${delta}%` }),
    plural(t, s.checks, "digest.v2.sales.checks_one", "digest.v2.sales.checks_other"),
    s.checks > 0 ? t("digest.v2.sales.avg_check", { money: m(Math.round(s.netCents / s.checks)) }) : null,
    s.netCents > 0 ? t("digest.v2.sales.third_party", { pct: `${Math.round((s.thirdPartyCents / s.netCents) * 100)}%` }) : null,
  ]), "info", salesHref, isPartial(s) || s.lastWeekCents === null);
  push(t("digest.v2.catering.revenue_label"), covered(tot.catering, [
    t("digest.v2.catering.split", { completed: m(tot.catering.completedCents), confirmed: m(tot.catering.confirmedCents) }), t("digest.v2.catering.not_in_pos"),
  ]), "info", cateringHref, isPartial(tot.catering));
  const o = tot.ordering;
  push(t("digest.v2.ordering.placed_label"), covered(o, [
    plural(t, o.placed, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other"), m(o.placedCents), unknown(o.unpriced),
    plural(t, o.missed, "digest.v2.totals.missed_one", "digest.v2.totals.missed_other"),
  ]), o.missed > 0 ? "issue" : "info", href, isPartial(o));
  const r = tot.receiving;
  push(t("digest.family.receiving"), covered(r, [
    plural(t, r.deliveries, "digest.v2.totals.deliveries_one", "digest.v2.totals.deliveries_other"), m(r.cents), unknown(r.unknownCents),
  ]), "info", href, isPartial(r));
  push(t("digest.v2.tomorrow.deliveries_label"), covered(o, [plural(t, o.dueTomorrow, "digest.v2.totals.due_one", "digest.v2.totals.due_other")]), "info", href, isPartial(o));
  const can = (cap: DigestCapability) => digestCan(access, cap, { locationId: "all", day: day ?? "" });
  return finishSection({ title: t("digest.v2.section.all_shops"), lines, href }, { t, can });
}

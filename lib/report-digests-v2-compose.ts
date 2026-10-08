/**
 * Digest v2 — the PURE composer for the management sections (facts → lines; zero I/O). Every line
 * carries a deep link; every empty state is an explicit line ("No POs placed", "No deliveries");
 * every unknown says so ("not yet available", "could not load"), never zero.
 * Section order (GO 2026-10-08): headline · ordering · receiving · inventory · operations ·
 * sales detail · people · tomorrow (D+1). The catering money lives in the headline; the 07:00
 * catering morning digest stays the catering section.
 */
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { timeWindowLabel, timeWindowMinutes } from "@/lib/midshift-shared";
import {
  allShopTotals,
  salesDeltaPct,
  type Coverage,
  sumKnown,
  type Loaded,
  type ShopV2Facts,
} from "@/lib/report-digests-v2-shared";
import { etWallTime } from "@/lib/report-digests-shared";
import { cutoffMinutes } from "@/lib/vendor-rhythm-shared";
import type { DigestLine, DigestSection, DigestTone } from "@/lib/report-digests-compose";

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

interface Ctx { t: T; language: Language; baseUrl: string; locationId: string; day: string }

const q = (locationId: string) => `location=${encodeURIComponent(locationId)}`;
const money = (c: Ctx, cents: number) => formatCents(cents, c.language);
/** A bare "HH:MM[:SS]" cutoff → "10:00 AM" (house formatter, ET). */
function cutoffLabel(c: Ctx, time: string): string {
  const mins = cutoffMinutes(time);
  return mins === null ? time : formatTime(etWallTime(c.day, mins).toISOString(), c.language);
}

/** The line every area shows when its read failed or its source is not there. */
function notLoaded(c: Ctx, label: string, href: string, l: Loaded<unknown>): DigestLine | null {
  if (l.kind === "error") return { label, text: c.t("digest.v2.could_not_load"), tone: "issue", href };
  if (l.kind === "unavailable") {
    const key = l.reason === "no_capture" ? "digest.v2.sales.no_capture" : "digest.v2.not_available";
    return { label, text: c.t(key as TranslationKey), tone: "info", href };
  }
  return null;
}

// ── 1. Headline ──────────────────────────────────────────────────────────────────────────────

export function headlineLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const salesHref = `${c.baseUrl}/mid-shift?${q(c.locationId)}`;
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
    lines.push({ label, text: parts.join(" · "), tone: "info", href: salesHref });
  }
  const catHref = `${c.baseUrl}/catering/pipeline`;
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
  const href = `${c.baseUrl}/ordering?${q(c.locationId)}`;
  const poHref = (id: string) => `${href}&po=${encodeURIComponent(id)}`;
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
  for (const m of day.late) lines.push({ label: m.vendorName, href, tone: "info", text: c.t("digest.v2.ordering.ordered_late", { time: cutoffLabel(c, m.cutoffTime), code: m.displayCode }) });
  for (const m of day.unverified) lines.push({ label: m.vendorName, href, tone: "info", text: c.t("digest.v2.ordering.cutoff_unverified", { time: cutoffLabel(c, m.cutoffTime) }) });
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
  const href = `${c.baseUrl}/operations/receiving?${q(c.locationId)}`;
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
      label: d.vendorName, href: `${c.baseUrl}/operations/receiving/${encodeURIComponent(d.id)}`,
      tone: problems.length > 0 ? "issue" : "ok",
      text: [d.cents === null ? c.t("digest.v2.receiving.no_total") : money(c, d.cents), d.poDisplayCode, ...problems].filter(Boolean).join(" · "),
    });
  }
  const credits = sumKnown(r.credits.map((x) => x.amountCents));
  lines.push(r.credits.length === 0
    ? { label: c.t("digest.v2.receiving.credits_label"), text: c.t("digest.v2.receiving.no_credits"), tone: "ok", href }
    : {
      label: c.t("digest.v2.receiving.credits_label"), tone: "issue", href,
      // An unknown credit amount is never $0 (Astra r2 P2).
      text: [
        plural(c.t, r.credits.length, "digest.v2.receiving.credits_one", "digest.v2.receiving.credits_other"),
        credits.unknown === r.credits.length ? c.t("digest.v2.receiving.credit_amount_unknown") : money(c, credits.cents),
        credits.unknown > 0 && credits.unknown < r.credits.length ? plural(c.t, credits.unknown, "digest.v2.totals.unknown_one", "digest.v2.totals.unknown_other") : null,
      ].filter(Boolean).join(" · "),
    });
  lines.push(r.invoicesPendingReview === 0
    ? { label: c.t("digest.v2.receiving.invoices_label"), text: c.t("digest.v2.receiving.no_invoices"), tone: "ok", href }
    : { label: c.t("digest.v2.receiving.invoices_label"), tone: "issue", href, text: plural(c.t, r.invoicesPendingReview, "digest.v2.receiving.invoices_one", "digest.v2.receiving.invoices_other") });
  return lines;
}

// ── 4. Inventory ─────────────────────────────────────────────────────────────────────────────

const names = (xs: Array<{ name: string }>, max = 5) => xs.slice(0, max).map((x) => x.name).join(", ") + (xs.length > max ? ` +${xs.length - max}` : "");

export function inventoryLines(c: Ctx, v: ShopV2Facts, pendingItems: number): DigestLine[] {
  const countsHref = `${c.baseUrl}/operations/counts?${q(c.locationId)}`;
  const orderingHref = `${c.baseUrl}/ordering?${q(c.locationId)}`;
  const receivingHref = `${c.baseUrl}/operations/receiving?${q(c.locationId)}`;
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

export function salesDetailLines(c: Ctx, v: ShopV2Facts): DigestLine[] {
  const href = `${c.baseUrl}/mid-shift?${q(c.locationId)}`;
  const nl = notLoaded(c, c.t("digest.v2.sales.detail_label"), href, v.sales);
  if (nl) return [nl];
  if (v.sales.kind !== "ok") return [];
  const s = v.sales.value.today;
  const lines: DigestLine[] = [];
  lines.push(s.topItems.length === 0
    ? { label: c.t("digest.v2.sales.top_items_label"), text: c.t("digest.v2.sales.no_items"), tone: "info", href }
    : { label: c.t("digest.v2.sales.top_items_label"), tone: "info", href, text: `${s.topItems.map((i) => `${i.name} ${i.units}`).join(", ")} · ${c.t("digest.v2.sales.item_dollars_unavailable")}` });
  const channel = (ch: string | null) => c.t(`digest.v2.channel.${ch ?? "unmapped"}` as TranslationKey);
  lines.push(s.channels.length === 0
    ? { label: c.t("digest.v2.sales.channels_label"), text: c.t("digest.v2.sales.no_channels"), tone: "info", href }
    : {
      label: c.t("digest.v2.sales.channels_label"), tone: "info", href,
      text: s.channels.map((ch) => `${channel(ch.channel)} ${money(c, ch.netCents)}${s.netCents > 0 ? ` (${Math.round((ch.netCents / s.netCents) * 100)}%)` : ""}`).join(", "),
    });
  lines.push(s.discounts.length === 0
    ? { label: c.t("digest.v2.sales.discounts_label"), text: c.t("digest.v2.sales.no_discounts"), tone: "ok", href }
    : { label: c.t("digest.v2.sales.discounts_label"), tone: "info", href, text: s.discounts.slice(0, 8).map((d) => `${d.name ?? c.t("digest.v2.sales.unnamed_discount")} ×${d.count} ${money(c, d.cents)}`).join(", ") });
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

// ── 8. People ────────────────────────────────────────────────────────────────────────────────

export function peopleLines(c: Ctx, v: ShopV2Facts, who: { openedBy: string | null; closedBy: string | null; openingHref: string; closingHref: string }, pmLine: DigestLine | null): DigestLine[] {
  const lines: DigestLine[] = [
    { label: c.t("digest.v2.people.opened_label"), href: who.openingHref, ...(who.openedBy ? { text: who.openedBy, tone: "info" as const } : { text: c.t("digest.v2.people.no_name"), tone: "info" as const }) },
    { label: c.t("digest.v2.people.closed_label"), href: who.closingHref, ...(who.closedBy ? { text: who.closedBy, tone: "info" as const } : { text: c.t("digest.v2.people.no_name"), tone: "info" as const }) },
  ];
  if (pmLine) lines.push(pmLine);
  const href = `${c.baseUrl}/operations/production/yield?${q(c.locationId)}`;
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
  const ordering = `${c.baseUrl}/ordering?${q(c.locationId)}`;
  const tomorrowLabel = formatDateLabel(v.lookahead, c.language);
  const lines: DigestLine[] = [];
  const nl = notLoaded(c, c.t("digest.v2.tomorrow.deliveries_label"), ordering, v.ordering);
  if (nl) lines.push(nl);
  else if (v.ordering.kind === "ok") {
    const { deliveries, cutoffsTomorrow } = v.ordering.value;
    const poHref = (id: string) => `${ordering}&po=${encodeURIComponent(id)}`;
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
      label: x.vendorName, href: ordering, tone: x.ordered || x.hasDraft ? "info" : "issue",
      text: `${c.t("digest.v2.tomorrow.cutoff_at", { time: cutoffLabel({ ...c, day: v.lookahead }, x.cutoffTime) })} · ${c.t(x.ordered ? "digest.v2.tomorrow.already_ordered" : x.hasDraft ? "digest.v2.tomorrow.draft_ready" : "digest.v2.tomorrow.no_draft")}`,
    });
  }
  const catHref = `${c.baseUrl}/catering/pipeline`;
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

// ── Assembly ─────────────────────────────────────────────────────────────────────────────────

export interface V2Extras {
  /** The Operations lines (report families + cash + tasks) from composeShopLines. */
  operations: DigestLine[];
  pmLine: DigestLine | null;
  pendingItems: number;
  who: { openedBy: string | null; closedBy: string | null; openingHref: string; closingHref: string };
}

export function composeV2Sections(args: { shopName: string; locationId: string; day: string; v: ShopV2Facts; extras: V2Extras; prefix: boolean }, language: Language, baseUrl: string): DigestSection[] {
  const c: Ctx = { t: translator(language), language, baseUrl, locationId: args.locationId, day: args.day };
  const title = (key: TranslationKey, params?: Params) => (args.prefix ? `${args.shopName} · ` : "") + c.t(key, params);
  return [
    { title: title("digest.v2.section.headline"), lines: headlineLines(c, args.v) },
    { title: title("digest.v2.section.ordering"), lines: orderingLines(c, args.v) },
    { title: title("digest.v2.section.receiving"), lines: receivingLines(c, args.v) },
    { title: title("digest.v2.section.inventory"), lines: inventoryLines(c, args.v, args.extras.pendingItems) },
    { title: title("digest.v2.section.operations"), lines: args.extras.operations },
    { title: title("digest.v2.section.sales"), lines: salesDetailLines(c, args.v) },
    { title: title("digest.v2.section.people"), lines: peopleLines(c, args.v, args.extras.who, args.extras.pmLine) },
    { title: title("digest.v2.section.tomorrow", { date: formatDateLabel(args.v.lookahead, language) }), lines: tomorrowLines(c, args.v) },
  ];
}

/** The level-8+ all-shop totals section: "not available" / "partial (n of m shops)", never a false 0. */
export function allShopsSection(shops: ReadonlyArray<{ v2?: ShopV2Facts }>, language: Language, baseUrl: string): DigestSection {
  const t = translator(language);
  const m = (cents: number) => formatCents(cents, language);
  const tot = allShopTotals(shops.map((s) => s.v2));
  const href = `${baseUrl}/reports`;
  const lines: DigestLine[] = [];
  /** null = nothing covered; else the parts plus a "partial" note when some shops are missing. */
  const covered = (cov: Coverage, parts: Array<string | null>): string | null => cov.covered === 0 ? null
    : [...parts, cov.covered < cov.total ? t("digest.v2.totals.partial", { n: cov.covered, total: cov.total }) : null].filter((x): x is string => x !== null).join(" · ");
  const unknown = (n: number) => n > 0 ? plural(t, n, "digest.v2.totals.unknown_one", "digest.v2.totals.unknown_other") : null;
  const push = (label: string, text: string | null, tone: DigestTone, link = href) =>
    lines.push(text === null ? { label, text: t("digest.v2.not_available"), tone: "info", href: link } : { label, text, tone, href: link });

  const s = tot.sales;
  const delta = s.lastWeekCents !== null && s.lastWeekCents > 0 ? Math.round(((s.netCents - s.lastWeekCents) / s.lastWeekCents) * 100) : null;
  push(t("digest.v2.sales.net_label"), covered(s, [
    m(s.netCents),
    delta === null ? t("digest.v2.sales.vs_unavailable") : t("digest.v2.totals.vs_last_week", { pct: `${delta > 0 ? "+" : ""}${delta}%` }),
    plural(t, s.checks, "digest.v2.sales.checks_one", "digest.v2.sales.checks_other"),
    s.checks > 0 ? t("digest.v2.sales.avg_check", { money: m(Math.round(s.netCents / s.checks)) }) : null,
    s.netCents > 0 ? t("digest.v2.sales.third_party", { pct: `${Math.round((s.thirdPartyCents / s.netCents) * 100)}%` }) : null,
  ]), "info");
  push(t("digest.v2.catering.revenue_label"), covered(tot.catering, [
    t("digest.v2.catering.split", { completed: m(tot.catering.completedCents), confirmed: m(tot.catering.confirmedCents) }), t("digest.v2.catering.not_in_pos"),
  ]), "info", `${baseUrl}/catering/pipeline`);
  const o = tot.ordering;
  push(t("digest.v2.ordering.placed_label"), covered(o, [
    plural(t, o.placed, "digest.v2.ordering.placed_one", "digest.v2.ordering.placed_other"), m(o.placedCents), unknown(o.unpriced),
    plural(t, o.missed, "digest.v2.totals.missed_one", "digest.v2.totals.missed_other"),
  ]), o.missed > 0 ? "issue" : "info");
  const r = tot.receiving;
  push(t("digest.family.receiving"), covered(r, [
    plural(t, r.deliveries, "digest.v2.totals.deliveries_one", "digest.v2.totals.deliveries_other"), m(r.cents), unknown(r.unknownCents),
  ]), "info");
  push(t("digest.v2.tomorrow.deliveries_label"), covered(o, [plural(t, o.dueTomorrow, "digest.v2.totals.due_one", "digest.v2.totals.due_other")]), "info");
  return { title: t("digest.v2.section.all_shops"), lines };
}

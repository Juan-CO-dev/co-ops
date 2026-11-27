/**
 * Digest deep links — the ONE place that turns "this section / this line is about X" into the exact
 * screen in the app (Juan 2026-11-23: "instead of a single open reports button, each section would
 * take you to the part of the reports that it's actually talking about"). Pure, zero I/O.
 *
 * Three rules:
 *   1. ABSOLUTE, from the engine's base URL (DigestIO.baseUrl → Envelope.baseUrl); never a hardcoded domain.
 *   2. IDS ONLY in the URL — shop, report, order, delivery, quote and lead ids and the business day.
 *      Never a name, a phone, an email or any free text (the catering lead link used to search by the
 *      contact's name; it now opens the lead's own card by id).
 *   3. A LINK THE RECIPIENT CAN OPEN. Each target mirrors the gate of the page it opens (the same pure
 *      predicates the pages call). A target the recipient cannot open is replaced by the next one in its
 *      fallback chain, or the link is omitted (null) — a GM is never sent to a page that bounces them.
 *      `viewer` undefined = unscoped (fixtures and callers that compose for no one in particular); the
 *      engine always passes the recipient's viewer, and an unknown recipient is a viewer with no access.
 */
import { isRoleCode, ROLES, type RoleCode } from "@/lib/roles";
import { canReadReportLocation, lockLocationContext, REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { canReadScopedReport } from "@/lib/report-scope";
import { reportsRoleAllowed } from "@/lib/reports-access-shared";
import { canOpenPeopleViews, canViewPeople } from "@/lib/people/access-shared";
import { vendorMailRoleAllowed } from "@/lib/vendor-mail-shared";
import type { ReportTypeKey } from "@/lib/reports-hub";
import { SALES_CHANNELS, SALES_EMPTY_KEY, type SalesChannel, type SalesView } from "@/lib/sales-reports-shared";
import { DIGEST_ANCHORS } from "@/lib/report-digests-anchors-shared";
import { isCalendarDay, isPipelineShopParam, PIPELINE_NO_SHOP, pipelineShopInScope } from "@/lib/catering/pipeline-shared";

/** Who will open the link: the recipient's real role, its level and their ACTIVE shop memberships. */
export interface LinkViewer { role: string; level: number; locations: readonly string[] }

/** A viewer that can open nothing (an unresolvable recipient): every gated link is omitted. */
export const NO_ACCESS_VIEWER: LinkViewer = { role: "", level: -1, locations: [] };

export interface LinkCtx { baseUrl: string; viewer?: LinkViewer | null }

export { DIGEST_ANCHORS };

export type DigestTarget =
  /** The reports hub for one shop (or "all") on the business day. */
  | { to: "reports_hub"; location: string; day: string }
  /** The operations report list for the day, optionally one family and one signal filter (sf_*). */
  | { to: "reports_list"; location: string; day: string; type?: ReportTypeKey; filter?: string }
  /** One report's detail page. */
  | { to: "report"; type: ReportTypeKey; id: string; location: string; day: string }
  /** Sales for the business day, optionally one view (items, channels, discounts…). */
  | { to: "sales"; location: string; day: string; view?: SalesView }
  /** The catering slice of Sales for the business day (ezCater ↔ Toast cross-check, pipeline split). */
  | { to: "sales_catering"; location: string; day: string }
  /**
   * The checks behind a Sales number for the business day (app/(authed)/reports/sales/checks/page.tsx, which
   * parses these with parseSalesCheckFilters). Enum- and id-shaped filters only: `channel` from the reviewed
   * channel list, `provider` id-shaped or the empty-key sentinel, `hour` -1 (no opened time) to 23. A value of
   * any other shape is no link (rule 2), so a free-text provider name never rides in a URL.
   */
  | { to: "sales_checks"; location: string; day: string; channel?: SalesChannel; provider?: string; hour?: number }
  /** The live mid-shift pulse (today only): the fallback below the Sales floor. */
  | { to: "mid_shift"; location: string }
  /** /ordering; `po` opens that PO's panel (dated), `anchor` scrolls to a part of the live page. */
  | { to: "ordering"; location: string; po?: string; anchor?: OrderingAnchor }
  | { to: "receiving"; location: string; anchor?: "recent" | "credits" }
  | { to: "delivery"; location: string; id: string }
  | { to: "counts"; location: string; anchor?: "on_hand" }
  | { to: "vendor_mail"; location: string }
  /** The Team roster; with `day` it opens on that one business day (range=custom&from=D&to=D). */
  | { to: "team"; location: string; day?: string }
  | { to: "yield"; location: string }
  /**
   * One lead's card on the catering pipeline board (`?lead=<id>#lead-<id>`). `leadShop` is the lead's OWN shop (its
   * `location_id`; null = no shop set) and goes into the gate: the board shows the card only to a reader whose
   * pipeline scope holds that shop, so anyone else gets the chain's next target (fix round 1, A2). Required, so no
   * caller can build a lead link without saying whose lead it is.
   */
  | { to: "pipeline"; lead: string; leadShop: string | null }
  /**
   * The catering pipeline board; `anchor` a part of the board (the Toast to-ring list, the follow-ups due, the
   * stage board). `day` + `location` (a shop id or `none`) + `view: "booked"` = the board's server-side day filter
   * (lib/catering/pipeline.ts): only the booked orders of that shop on that day. All three or none.
   */
  | { to: "pipeline"; lead?: undefined; anchor?: PipelineAnchor; day?: string; location?: string; view?: "booked" }
  | { to: "quotes"; quote?: string }
  /** Catering prep demand; `location` its shop, `tab` the first tab, `day` that need date's section (Prep tab). */
  | { to: "prep_demand"; location?: string; tab?: "prep" | "sku"; day?: string }
  | { to: "stations"; location: string };

export type OrderingAnchor = "today" | "missed" | "cutoffs" | "walk";
export type PipelineAnchor = "to_ring" | "follow_ups" | "stages";
const ORDERING_ANCHOR: Record<OrderingAnchor, string> = {
  today: DIGEST_ANCHORS.orderingToday, missed: DIGEST_ANCHORS.orderingMissed, cutoffs: DIGEST_ANCHORS.orderingCutoffs, walk: DIGEST_ANCHORS.orderingWalk,
};
const PIPELINE_ANCHOR: Record<PipelineAnchor, string> = {
  to_ring: DIGEST_ANCHORS.pipelineToRing, follow_ups: DIGEST_ANCHORS.pipelineFollowUps, stages: DIGEST_ANCHORS.pipelineStages,
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The range query every day-scoped report page reads (range=custom&from=D&to=D). */
function dayParams(location: string, day: string, extra: Record<string, string> = {}): string {
  return new URLSearchParams({ location, range: "custom", from: day, to: day, ...extra }).toString();
}
const loc = (location: string) => `location=${encodeURIComponent(location)}`;

/** The path + query (+ fragment) of a target, ungated. Exported for the tests' link map. */
export function targetPath(t: DigestTarget): string {
  switch (t.to) {
    case "reports_hub": return `/reports?${dayParams(t.location, t.day)}`;
    case "reports_list": return `/reports/operations?${dayParams(t.location, t.day, { ...(t.type ? { type: t.type } : {}), ...(t.filter ? { [t.filter]: "true" } : {}) })}`;
    case "report": return `/reports/${t.type}/${encodeURIComponent(t.id)}?${dayParams(t.location, t.day)}`;
    case "sales": return `/reports/sales?${dayParams(t.location, t.day, t.view && t.view !== "summary" ? { view: t.view } : {})}`;
    case "sales_catering": return `/reports/sales/catering?${dayParams(t.location, t.day)}`;
    case "sales_checks": return `/reports/sales/checks?${dayParams(t.location, t.day, {
      ...(t.channel !== undefined ? { channel: t.channel } : {}),
      ...(t.provider !== undefined ? { provider: t.provider } : {}),
      ...(t.hour !== undefined ? { hour: String(t.hour) } : {}),
    })}`;
    case "mid_shift": return `/mid-shift?${loc(t.location)}`;
    // A PO's panel is the dated destination; an anchor is a part of the live page (never both).
    case "ordering": return `/ordering?${loc(t.location)}${t.po ? `&po=${encodeURIComponent(t.po)}` : t.anchor ? `#${ORDERING_ANCHOR[t.anchor]}` : ""}`;
    case "receiving": return `/operations/receiving?${loc(t.location)}${t.anchor === "recent" ? `#${DIGEST_ANCHORS.receivingRecent}` : t.anchor === "credits" ? `#${DIGEST_ANCHORS.receivingCredits}` : ""}`;
    case "delivery": return `/operations/receiving/${encodeURIComponent(t.id)}`;
    case "counts": return `/operations/counts?${loc(t.location)}${t.anchor === "on_hand" ? `#${DIGEST_ANCHORS.countsOnHand}` : ""}`;
    case "vendor_mail": return `/operations/vendor-mail?${loc(t.location)}`;
    // The page reads location + range/from/to through resolveTrendRange (granularity `g` defaults to day).
    case "team": return `/reports/trends/team?${t.day !== undefined ? dayParams(t.location, t.day) : loc(t.location)}`;
    case "yield": return `/operations/production/yield?${loc(t.location)}`;
    // `?lead=` makes the board load that lead even past its row cap; `#lead-<id>` opens and scrolls to its card.
    case "pipeline": {
      if (t.lead !== undefined) return `/catering/pipeline?lead=${encodeURIComponent(t.lead)}#${DIGEST_ANCHORS.lead(t.lead)}`;
      const filter = t.day && t.location ? `?${new URLSearchParams({ day: t.day, location: t.location, view: "booked" })}` : "";
      return `/catering/pipeline${filter}${t.anchor ? `#${PIPELINE_ANCHOR[t.anchor]}` : ""}`;
    }
    case "quotes": return `/catering/quotes${t.quote ? `?quote=${encodeURIComponent(t.quote)}` : ""}`;
    case "prep_demand": {
      if (!t.location) return "/admin/catering/prep-demand";
      const query = new URLSearchParams({ location: t.location, ...(t.tab ? { tab: t.tab } : {}) });
      // The day sections live on the Prep tab (the page's first tab unless ?tab= says otherwise).
      return `/admin/catering/prep-demand?${query}${t.day && (t.tab ?? "prep") === "prep" ? `#${DIGEST_ANCHORS.prepDay(t.day)}` : ""}`;
    }
    // The stations page reads its shop as ?loc= (lib/shop-context-shared.ts), not ?location=.
    case "stations": return `/stations?loc=${encodeURIComponent(t.location)}`;
  }
}

/** Ids and days that ride in a URL must look like ids and days (rule 2): anything else is no link. */
function wellFormed(t: DigestTarget): boolean {
  const ids: Array<string | undefined> = [];
  if ("location" in t) ids.push(t.location);
  if ("id" in t) ids.push(t.id);
  if (t.to === "ordering") ids.push(t.po);
  if (t.to === "pipeline") ids.push(t.lead);
  if (t.to === "quotes") ids.push(t.quote);
  // A day is a real calendar day (2026-02-31 is no link).
  if ("day" in t && t.day !== undefined && !isCalendarDay(t.day)) return false;
  // (A lead's `leadShop` never rides in the URL: it is only the gate's input, checked by scope in canOpen.)
  if (t.to === "pipeline" && t.lead === undefined) {
    if (t.day !== undefined || t.location !== undefined || t.view !== undefined) {
      // The pipeline day filter is all three params or none, and its shop is one the PAGE accepts: the page's own
      // validator (a shop UUID or `none`), so no link carries a shop id the page would discard (fix round 1, A6).
      if (t.day === undefined || t.location === undefined || t.view !== "booked" || !isPipelineShopParam(t.location)) return false;
    }
  }
  if (t.to === "sales_checks") {
    if (t.channel !== undefined && !(SALES_CHANNELS as readonly string[]).includes(t.channel)) return false;
    if (t.provider !== undefined && t.provider !== SALES_EMPTY_KEY) ids.push(t.provider);
    if (t.hour !== undefined && !(Number.isInteger(t.hour) && t.hour >= -1 && t.hour <= 23)) return false;
  }
  return ids.every((x) => x === undefined || ID.test(x));
}

interface Who { role: RoleCode | null; level: number; locations: string[] }
function who(v: LinkViewer): Who {
  const role = isRoleCode(v.role) ? v.role : null;
  return { role, level: role ? ROLES[role].level : -1, locations: [...v.locations] };
}

/** Each page's own gate, from the same pure predicates the page calls (see each page.tsx). */
export function canOpen(viewer: LinkViewer | null | undefined, t: DigestTarget): boolean {
  if (viewer === undefined) return true;
  if (viewer === null) return false;
  const w = who(viewer);
  if (!w.role) return false;
  const actor = { role: w.role, locations: w.locations };
  const reports = (location: string) => reportsRoleAllowed(w.role!) && w.level >= 2
    && (location === "all" ? w.level >= REPORT_ALL_LOCATIONS_LEVEL : canReadReportLocation(actor, location));
  // Sales (and its catering slice): SALES_READ_MIN = 7, own shop below level 8 (app/(authed)/reports/sales/page.tsx).
  const sales = (location: string) => reportsRoleAllowed(w.role!) && w.level >= 7
    && (location === "all" ? w.level >= REPORT_ALL_LOCATIONS_LEVEL : canReadScopedReport({ userId: "", level: w.level, locations: w.locations }, location));
  // Ordering / receiving / mid-shift: KH+ and the shop context lock (membership, or level 9+); the task gate
  // (hasTaskAccess) admits every level 4+ at a shop they may work.
  const floor = (location: string) => w.level >= 4 && location !== "all" && lockLocationContext(actor, location);
  switch (t.to) {
    case "reports_hub": case "reports_list": return reports(t.location);
    // A cash report's detail is KH+ (REPORTS_HUB_CASH_LEVEL = 4).
    case "report": return reports(t.location) && t.location !== "all" && (t.type !== "cash" || w.level >= 4);
    // The checks list runs the same gate as Sales (app/(authed)/reports/sales/checks/page.tsx).
    case "sales": case "sales_catering": case "sales_checks": return sales(t.location);
    case "mid_shift": case "ordering": case "receiving": case "delivery": return floor(t.location);
    // Counts: the history read is AGM+ (COUNT_READ_MIN = 6) when today's count is someone else's task.
    case "counts": return floor(t.location) && w.level >= 6;
    case "vendor_mail": return vendorMailRoleAllowed(w.role) && (w.level >= 8 || w.locations.includes(t.location));
    case "team": {
      const people = { userId: "", role: w.role, level: w.level, locations: w.locations };
      return reportsRoleAllowed(w.role) && w.level >= 6 && canOpenPeopleViews(people) && t.location !== "all" && canViewPeople(people, t.location);
    }
    // YIELD_STATS_READ_MIN = 5, report-bound shop read.
    case "yield": return w.level >= 5 && t.location !== "all" && canReadReportLocation(actor, t.location);
    // PIPELINE_READ_MIN = QUOTE_READ_MIN = 5. A day filter for one shop, and one lead's card, also need that shop
    // (the filter's, or the lead's own) in the board's read scope (pipelineShopInScope = readScopeOr in
    // lib/catering/pipeline.ts): a shop outside it is no link. A lead with no shop set is in every reader's scope.
    case "pipeline": {
      if (w.level < 5) return false;
      if (t.lead !== undefined) return pipelineShopInScope(actor, t.leadShop ?? PIPELINE_NO_SHOP);
      return t.location === undefined || pipelineShopInScope(actor, t.location);
    }
    case "quotes": return w.level >= 5;
    // The admin shell (level 6) and PREP_DEMAND_READ_MIN = 6. A shop must be one the page would list
    // (loadPackageLocations: every active shop at level 9+, else the reader's own): the page silently shows
    // another shop for an unknown ?location=, so an unlisted shop is no link.
    case "prep_demand": return w.level >= 6 && (t.location === undefined || w.level >= 9 || w.locations.includes(t.location));
    // Stations: level 8 any shop, else a shop they belong to (an unknown ?loc= silently shows another shop).
    case "stations": return w.level >= 8 || w.locations.includes(t.location);
  }
}

/**
 * LIVE vs DATED (plan §3.3): a dated screen shows the digest's day whenever it is opened (a report or
 * Sales for the day, a PO, a delivery, a lead, the pipeline filtered to a day); a live screen shows the
 * CURRENT day (Ordering's walk and today's orders, counts on hand, prep demand, stations, the mid-shift
 * pulse). A live section link is labelled so in the email.
 */
export function isLiveTarget(t: DigestTarget): boolean {
  switch (t.to) {
    case "ordering": return !t.po;
    case "counts": case "prep_demand": case "stations": case "mid_shift": return true;
    default: return false;
  }
}

/** The first target in the chain the viewer can open, with its absolute URL; null = none. */
export function digestLinkTarget(ctx: LinkCtx, ...chain: DigestTarget[]): { href: string; target: DigestTarget } | null {
  for (const t of chain) {
    if (!wellFormed(t)) continue;
    if (canOpen(ctx.viewer, t)) return { href: `${ctx.baseUrl.replace(/\/+$/, "")}${targetPath(t)}`, target: t };
  }
  return null;
}

/**
 * The first target in the chain the viewer can open, as an absolute URL; null = no link. The chain is
 * how a section degrades: Sales for the day → the live pulse → nothing.
 */
export function digestLink(ctx: LinkCtx, ...chain: DigestTarget[]): string | null {
  return digestLinkTarget(ctx, ...chain)?.href ?? null;
}

/** A section's link and whether the screen it opens is live (the email then says so). */
export function sectionLink(ctx: LinkCtx, ...chain: DigestTarget[]): { href: string | null; live: boolean } {
  const hit = digestLinkTarget(ctx, ...chain);
  return { href: hit?.href ?? null, live: hit ? isLiveTarget(hit.target) : false };
}

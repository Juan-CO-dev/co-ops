/**
 * Nav PR 8: the Dashboard's role blocks, the reading half (plan r2 2.2; spec r5 3.6). Server-only.
 *
 * Every cell runs through the page's `settle` (lib/dashboard-day.ts): bounded by the ONE page deadline, aborted at it AND
 * when a sibling read of the same cell rejects (E5), never rejecting, failing only its own cell. Every reader gets
 * `withAbortStrict(sb, signal)` (or the signal itself, which it wraps) for EVERY read, its authorization reads included
 * (A3). Nothing here throws, nothing here formats a number, and nothing reads "works as" (tests/dashboard-works-as.test.ts).
 *
 * What leaves this module is already shaped for the screen: the sales totals, a labor VIEW (figures, never raw cents),
 * the catering cell (counts and a pipeline-only value), counts for "Needs you" and the block. No name, contact, order
 * number or address.
 *
 * Q11: the strip's catering read is its own snapshot, independent of the engine's catering lane, so the strip and the
 * catering row can differ by a booking made between the two reads.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBusinessLaborDays } from "@/lib/business-report";
import { businessLaborView } from "@/lib/business-view-shared";
import { loadShopNotices } from "@/lib/catalog/shop-changes";
import { loadBookedCateringEvents } from "@/lib/catering/booked-events";
import { countCateringInboxWaiting } from "@/lib/catering/inbox";
import { canReadCateringInbox } from "@/lib/catering/inbox-shared";
import { readNotInToastScoped } from "@/lib/catering/not-in-toast";
import type { HouseReconciliationState } from "@/lib/catering/catering-toast";
import { cateringStripCell, type CateringStripCell, type LaborStripDay } from "@/lib/dashboard-blocks-shared";
import type { Settle, Settled } from "@/lib/dashboard-day";
import type { Switches } from "@/lib/nav/types";
import { withAbortStrict } from "@/lib/pulse/abort";
import { loadPulseSalesToday, type PulseSalesToday } from "@/lib/pulse/sales";
import { recipeVersionWriteGate } from "@/lib/recipe-versions-shared";
import { shiftReportDate } from "@/lib/report-range";
import { loadEzcater } from "@/lib/scheduling/inputs";
import type { AuthContext } from "@/lib/session";
import { catalogShopAllowed } from "@/lib/sku-versions-shared";
import { staleVendorMailCount } from "@/lib/vendor-mail";
import { vendorMailRoleAllowed } from "@/lib/vendor-mail-shared";

type Sb = SupabaseClient;

/** The strip's labor window: the 3 days before the plan date (Q2). Yesterday is pending until about noon the next day. */
export const STRIP_LABOR_DAYS = 3;

export interface StripShop {
  readonly shop: { readonly id: string; readonly code: string; readonly name: string };
  readonly sales: Settled<PulseSalesToday>;
  /** "off" = the business report's switches are not all on: no read, no cell. */
  readonly labor: Settled<readonly LaborStripDay[]> | "off";
  readonly catering: Settled<CateringStripCell>;
}

/**
 * The numbers strip: one row per shop the page can open, three cells each, every cell its own bounded read. The caller
 * starts it only for MoO / Owner / CGS (`numbersStripFor`, by real role); the readers' own gates still run first.
 */
export function loadStrip(sb: Sb, auth: AuthContext, shops: ReadonlyArray<StripShop["shop"]>, planDate: string, switches: Switches, settle: Settle): Promise<StripShop[]> {
  const salesViewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const businessViewer = { ...salesViewer, role: auth.role };
  const laborDays = Array.from({ length: STRIP_LABOR_DAYS }, (_, i) => shiftReportDate(planDate, i - STRIP_LABOR_DAYS));
  return Promise.all(shops.map(async (shop): Promise<StripShop> => {
    const [sales, labor, catering] = await Promise.all([
      settle("dashboard.strip.sales", (s) => loadPulseSalesToday(withAbortStrict(sb, s), { viewer: salesViewer, locationId: shop.id, date: planDate })),
      switches.businessReport
        ? settle("dashboard.strip.labor", async (s): Promise<readonly LaborStripDay[]> => {
          const r = await loadBusinessLaborDays(businessViewer, { locationId: shop.id, days: laborDays }, { client: withAbortStrict(sb, s) });
          return r.days.map((d) => ({ date: d.date, view: businessLaborView(d.labor, r.access) }));
        })
        : Promise.resolve("off" as const),
      // ONE cell, two reads under one signal: a rejected sibling aborts the other (E5).
      settle("dashboard.strip.catering", async (s) => {
        const c = withAbortStrict(sb, s);
        const [booked, ezcater] = await Promise.all([loadBookedCateringEvents(c, { locationId: shop.id, dates: [planDate] }), loadEzcater(c, shop.id, [planDate])]);
        return cateringStripCell(booked, ezcater, planDate);
      }),
    ]);
    return { shop, sales, labor, catering };
  }));
}

export interface InboxWaiting { readonly shop: number; readonly unplaced: number | null }
/** null = the source does not apply to this viewer here (its reader would refuse): no row, and not a failure. */
export interface NeedsYouCells {
  readonly vendorMail: Settled<number> | null;
  readonly recipes: Settled<number> | null;
  readonly inbox: Settled<InboxWaiting> | null;
}

/** "Needs you" for the selected shop: three reads, each its own cell, each only where its own gate admits the viewer. */
export async function loadNeedsYou(auth: AuthContext, shopId: string, settle: Settle): Promise<NeedsYouCells> {
  const inboxActor = { role: auth.role, active: auth.user.active !== false, locations: auth.locations };
  const recipesAllowed = recipeVersionWriteGate({ role: auth.role, level: auth.level, scope: shopId, scopeAllowed: catalogShopAllowed(auth, shopId) }).ok;
  const [vendorMail, recipes, inbox] = await Promise.all([
    vendorMailRoleAllowed(auth.role) ? settle("dashboard.needs_you.vendor_mail", (signal) => staleVendorMailCount(auth, { locationId: shopId }, { signal })) : null,
    recipesAllowed ? settle("dashboard.needs_you.recipes", async (signal) => (await loadShopNotices(auth, shopId, { signal })).length) : null,
    canReadCateringInbox(inboxActor, shopId) ? settle("dashboard.needs_you.inbox", (signal) => countCateringInboxWaiting(auth, shopId, { signal })) : null,
  ]);
  return { vendorMail, recipes, inbox };
}

/** The not-rung line's facts: how many are listed, and whether house orders are checked at all (A6). No order data. */
export interface NotRungScoped { readonly count: number; readonly house: HouseReconciliationState }

/** The catering block's two reads (the catering manager holding `catering`; the caller decides). */
export async function loadCateringBlockExtras(sb: Sb, auth: AuthContext, shopId: string, planDate: string, settle: Settle):
  Promise<{ inbox: Settled<InboxWaiting>; notRung: Settled<NotRungScoped> }> {
  const [inbox, notRung] = await Promise.all([
    settle("dashboard.catering_block.inbox", (signal) => countCateringInboxWaiting(auth, shopId, { signal })),
    settle("dashboard.catering_block.not_rung", async (s): Promise<NotRungScoped> => {
      const r = await readNotInToastScoped(withAbortStrict(sb, s), shopId, { through: planDate });
      return { count: r.rows.length, house: r.house };
    }),
  ]);
  return { inbox, notRung };
}

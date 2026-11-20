/**
 * Demand signals (item 4 PR 6, first half): THE ORDER WALK'S LOADER. It reads no table: it asks the signals
 * page's own loader (the gated readers at the `render` use point, under ONE deadline) and keeps the days AFTER
 * the walk date that carry an event. So the walk and the page can never disagree about what a signal is.
 *
 * REVOCATION STOPS USE: rows come through `loadSignalsPage` (gated at render), and the nudge decision asks
 * `orderNudgeFor`, which ends in `usableNow`. With no approval writer yet, `approved` is null on every call and
 * every day is `named_only: no_approved_signal`. This module has no way to construct an approval or a term.
 * FAILURE NEVER REACHES THE WALK: any miss is a state (`unavailable` renders nothing, `unreadable` renders one
 * line); the caller wraps the call as well.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canViewDemandSignals, demandSignalShops } from "./access-shared";
import type { SourceState } from "./sources-shared";
import { ORDER_SIGNALS_HORIZON_DAYS, buildOrderSignals, orderNudgeFor, type OrderSignalsView } from "./order-signals-shared";
import { loadSignalsPage } from "./signals-page";
import type { RunState } from "./signals-view-shared";

/** The panel's whole budget. The walk's own reads run beside it; a signal read past this is "could not be read". */
export const ORDER_SIGNALS_DEADLINE_MS = 2_500;

export type OrderSignalsData =
  | { state: "unavailable" }
  | { state: "unreadable" }
  | { state: "ok"; today: string; horizonDays: number; view: OrderSignalsView; weatherFeeds: Record<string, RunState | "unreadable">; canOpenPage: boolean };

const NO_STATES: ReadonlyArray<SourceState> = [];

export async function loadOrderSignals(sb: SupabaseClient, args: {
  actor: { role: string; locations: ReadonlyArray<string> }; shop: { id: string; name: string }; nowIso: string; signal: AbortSignal;
}): Promise<OrderSignalsData> {
  const page = await loadSignalsPage(sb, { actor: args.actor, shop: args.shop, nowIso: args.nowIso, horizonDays: ORDER_SIGNALS_HORIZON_DAYS + 1, signal: args.signal });
  if (page.state !== "ok") return { state: page.state };
  // "None coming up" is a claim: it needs the event read to have finished whole.
  if (page.events === null || args.signal.aborted) return { state: "unreadable" };
  const days = page.days.filter((d) => d.date > page.today);
  const view = buildOrderSignals({ days, events: page.events,
    // No approval and no term exist yet (their writers are a later PR), so the gate answers no_approved_signal.
    nudgeFor: (date) => orderNudgeFor({ approved: null, term: null, shopId: args.shop.id, validDate: date, leadDays: 0, states: NO_STATES, velocityRatio: 1 }) });
  return { state: "ok", today: page.today, horizonDays: ORDER_SIGNALS_HORIZON_DAYS, view, weatherFeeds: page.weatherFeeds,
    canOpenPage: canViewDemandSignals(args.actor.role) && demandSignalShops(args.actor.role, args.actor.locations, [args.shop]).length === 1 };
}

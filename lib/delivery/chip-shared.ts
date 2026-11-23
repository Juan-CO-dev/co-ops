/**
 * Catering delivery D3 — the pipeline card's chip and the lead's Delivery panel always agree (review rounds 5 and 6).
 * Zero I/O. Client-safe.
 *
 * The chip reads a map the SERVER built once for the board (`loadPipelineDeliveryStates`). The panel in the same card
 * records a courier, a status, a kept pickup — and then reloads its own GET, which carries the lead's state derived by
 * the ONE rule (`deliveryStateOf`, on the server). Without an update path the card kept saying "To book" beside a panel
 * that said "Booked". So the panel PUBLISHES the OUTCOME of every completed load of its GET, and the chip shows what was
 * published over the server's map.
 *
 * EVERY COMPLETED LOAD HAS AN OUTCOME, AND EACH ONE OVERRIDES THE SERVER MAP FOR THAT LEAD (round 6):
 *   - a lead view            → its state (the server's; reshaped by `rowStateFor`, the function the server's own row uses);
 *   - a FAILED load          → `unknown`: the chip reads "Couldn't load delivery". A failed read is never read as a state:
 *                              after a courier was recorded and the reload failed, the card must not go on saying
 *                              "To book" (someone would book twice);
 *   - an authoritative "nothing to show here" (off, not installed, the lead's SHOP turned off — a lead view with
 *     `enabled: false` —, no access / nothing to see, the pickup shop's history-only view)
 *                            → SUPPRESSED: the chip renders nothing. Off renders nothing.
 * THE RULE, for every answer the GET can give (the table is tests/delivery-chip-get-audit.test.ts): whatever makes the
 * panel render nothing for an AUTHORITATIVE reason suppresses; a FAILURE TO KNOW is `unknown`; only an ABORTED request
 * publishes nothing. A lead view of a shop that is ON always publishes its state — `none` included, which shows no chip.
 * Unknown and suppressed are ENTRIES in the published store (a suppression is a `null` tombstone), never a deleted entry:
 * a deleted entry would let the stale server value show through again.
 *
 *  - NOTHING IS DERIVED HERE. `publishedOutcomeOf` only reshapes what the load answered.
 *  - STATUS ONLY. A published row is exactly `{ state, at, status }`: no money, courier, reference or note crosses,
 *    whatever the GET carried for a manager.
 *  - ONLY LOAD OUTCOMES PUBLISH. A write that failed and was followed by no load publishes nothing (nothing is known to
 *    have changed); an aborted load (the panel closed) publishes nothing either.
 *  - A FRESH SERVER MAP SUPERSEDES everything published before it (`adoptServer`), tombstones included: after a real
 *    reload or a `router.refresh()` the server's answer is newer than any earlier panel read.
 */
import { DELIVERY_UNKNOWN, rowStateFor, type DeliveryRowState } from "./day-shared";
import type { DeliveryState, DeliveryStatus } from "./types-shared";

export type ChipStates = Readonly<Record<string, DeliveryRowState>>;
/** What one load published for a lead: a row (a state, or `unknown`), or `null` = suppressed (render nothing). */
export type PublishedChip = DeliveryRowState | null;
export interface ChipStore {
  /** The map the server rendered the board with; null = no chip anywhere (off, or the states read failed). */
  readonly server: ChipStates | null;
  /** The outcome of a panel's own load since that map arrived, by lead id. A `null` value is a tombstone, not "absent". */
  readonly published: Readonly<Record<string, PublishedChip>>;
}
export const chipStore = (server: ChipStates | null): ChipStore => ({ server, published: {} });

/** A new server map (a different object) drops everything published before it; the same map changes nothing. */
export function adoptServer(store: ChipStore, server: ChipStates | null): ChipStore {
  return server === store.server ? store : chipStore(server);
}

const has = (store: ChipStore, leadId: string): boolean => Object.prototype.hasOwnProperty.call(store.published, leadId);
const sameOutcome = (a: PublishedChip, b: PublishedChip): boolean =>
  a === b || (a !== null && b !== null && a.state === b.state && a.at === b.at && a.status === b.status);

/** One lead's published outcome. The same store when nothing changed (no re-render for a reload that found the same). */
export function publishState(store: ChipStore, leadId: string, outcome: PublishedChip): ChipStore {
  if (has(store, leadId) && sameOutcome(store.published[leadId]!, outcome)) return store;
  return { server: store.server, published: { ...store.published, [leadId]: outcome } };
}

/** What the chip of this lead shows: the published outcome when there is one (a tombstone = nothing), else the server's. */
export function chipStateOf(store: ChipStore, leadId: string): DeliveryRowState | undefined {
  if (has(store, leadId)) return store.published[leadId] ?? undefined;
  return store.server?.[leadId];
}

/** The part of the panel's GET this reads. Deliberately narrow: nothing else of the response is touched. */
export type PanelViewForChip =
  // `enabled` = the lead's shop has delivery ON (`delivery_settings.enabled`). With the global switch on and the shop
  // off the GET still answers a lead view, with `enabled: false`: the panel renders nothing, and so does the chip.
  | { view: "lead"; enabled: boolean; state: DeliveryState; status: { status: DeliveryStatus; statusAt: string; pickupAt: string | null } | null }
  | { view: "off" | "not_installed" | "history" }
  | null | undefined;
/** One COMPLETED load of the panel's GET: what it answered, or that it failed (network, 5xx, still busy after its retry). */
export type PanelLoadOutcome = { loaded: PanelViewForChip } | { failed: true };

/**
 * What a completed load publishes for the lead — always something:
 * a lead view of a shop that is ON → its row (the SERVER's state, status-only); a failed load → `unknown`; anything else
 * (off, not installed, the shop off, history-only, nothing to see) → `null` (suppress).
 */
export function publishedOutcomeOf(outcome: PanelLoadOutcome): PublishedChip {
  if ("failed" in outcome) return DELIVERY_UNKNOWN;
  const view = outcome.loaded;
  // `enabled !== true`: a shop that is off, and any answer that does not SAY the shop is on, shows nothing.
  if (!view || view.view !== "lead" || view.enabled !== true) return null;
  const row = rowStateFor(view.state, view.status ? { status: view.status.status, at: view.status.statusAt, pickupAt: view.status.pickupAt } : null);
  return { state: row.state, at: row.at, status: row.status };
}

/**
 * Catering delivery D3 — the pipeline card's chip and the lead's Delivery panel always agree (review round 5).
 * Zero I/O. Client-safe.
 *
 * The chip reads a map the SERVER built once for the board (`loadPipelineDeliveryStates`). The panel in the same card
 * records a courier, a status, a kept pickup — and then reloads its own GET, which carries the lead's state derived by
 * the ONE rule (`deliveryStateOf`, on the server). Without an update path the card kept saying "To book" beside a panel
 * that said "Booked". So the panel PUBLISHES what its GET answered, and the chip shows a published state over the server's.
 *
 *  - NOTHING IS DERIVED HERE. `publishedRowOf` only reshapes the GET's `{ state, status }` into the chip's row through
 *    `rowStateFor` — the same reshaping the server's own row uses (`deliveryRowStateOf`), so both paths give one row.
 *  - STATUS ONLY. The published row is exactly `{ state, at, status }`: no money, courier, reference or note crosses,
 *    whatever the GET carried for a manager.
 *  - A response that says nothing about the lead's state (off, not installed, the pickup shop's history view, nothing
 *    to see, a failed load) publishes NOTHING: the chip stays as it was.
 *  - A FRESH SERVER MAP SUPERSEDES what was published before it (`adoptServer`): after a real reload or a
 *    `router.refresh()` the server's answer is newer than any earlier panel read.
 */
import { rowStateFor, type DeliveryRowState } from "./day-shared";
import type { DeliveryState, DeliveryStatus } from "./types-shared";

export type ChipStates = Readonly<Record<string, DeliveryRowState>>;
export interface ChipStore {
  /** The map the server rendered the board with; null = no chip anywhere (off, or the states read failed). */
  readonly server: ChipStates | null;
  /** What a panel's own GET answered since that map arrived, by lead id. */
  readonly published: ChipStates;
}
export const chipStore = (server: ChipStates | null): ChipStore => ({ server, published: {} });

/** A new server map (a different object) drops everything published before it; the same map changes nothing. */
export function adoptServer(store: ChipStore, server: ChipStates | null): ChipStore {
  return server === store.server ? store : chipStore(server);
}

const sameRow = (a: DeliveryRowState | undefined, b: DeliveryRowState): boolean => !!a && a.state === b.state && a.at === b.at && a.status === b.status;

/** One lead's published state. The same store when nothing changed (no re-render for a reload that found the same). */
export function publishState(store: ChipStore, leadId: string, row: DeliveryRowState): ChipStore {
  if (sameRow(store.published[leadId], row)) return store;
  return { server: store.server, published: { ...store.published, [leadId]: row } };
}

/** What the chip of this lead shows: the published state when there is one, else the server's. */
export function chipStateOf(store: ChipStore, leadId: string): DeliveryRowState | undefined {
  return store.published[leadId] ?? store.server?.[leadId];
}

/** The part of the panel's GET this reads. Deliberately narrow: nothing else of the response is touched. */
export type PanelViewForChip =
  | { view: "lead"; state: DeliveryState; status: { status: DeliveryStatus; statusAt: string; pickupAt: string | null } | null }
  | { view: "off" | "not_installed" | "history" }
  | null | undefined;

/**
 * The chip's row from the panel's GET, or undefined = "this answer says nothing about the lead's state: publish nothing".
 * The state is the SERVER's (`deliveryStateOf`); only the three status-only fields are kept.
 */
export function publishedRowOf(view: PanelViewForChip): DeliveryRowState | undefined {
  if (!view || view.view !== "lead") return undefined;
  const row = rowStateFor(view.state, view.status ? { status: view.status.status, at: view.status.statusAt, pickupAt: view.status.pickupAt } : null);
  return { state: row.state, at: row.at, status: row.status };
}
